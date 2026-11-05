/* JO parsing runs locally. Uploaded documents are never sent to a server.
 * Rules adapted from the original Flask parser (commit c42a342).
 */
(function (root) {
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phonePattern = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const labelPattern = /^[A-Za-z0-9 ./'&#-]+:\s*$/;
  const first = (text, pattern) => (text.match(pattern) || [""])[0];
  function parseText(raw) {
    const text = raw.replace(/\r/g, "").replace(/\u00a0/g, " ");
    const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
    const quote = /quotation number/i.test(text) && /prepared for/i.test(text) && /order contract/i.test(text);
    function after(label, pattern, limit = 25) {
      for (let i = 0; i < lines.length; i++) {
        if (!label.test(lines[i])) continue;
        const tail = lines[i].replace(label, "").replace(/^\s*:\s*/, "").trim();
        for (const value of [tail, ...lines.slice(i + 1, i + limit + 1)]) {
          if (!value || labelPattern.test(value)) continue;
          if (pattern) {
            const match = value.match(pattern);
            if (match) return match[1] || match[0];
          } else {
            // Stop at another field rather than treating its value as this field.
            if (/^[A-Za-z][A-Za-z /#&.-]*:/.test(value)) return "";
            return value;
          }
        }
      }
      return "";
    }
    function closest(label, pattern, window = 30) {
      const index = lines.findIndex(line => label.test(line));
      if (index < 0) return "";
      for (let distance = 0; distance <= window; distance++) {
        for (const j of [index + distance, index - distance]) {
          const match = (lines[j] || "").match(pattern);
          if (match) return match[0];
        }
      }
      return "";
    }
    const data = {
      pdf_type: quote ? "Quote/Contract" : "Release",
      job_number: "", job_name: "", voltage: "", contact_name: "",
      contact_email: "", contact_phone: "", project_site_address: ""
    };
    const header = text.split(/\bDescription\b/i)[0];
    const voltage = after(/\bVoltage\s*(?:Available)?\s*:?/i, /(\d{3,4}\s*(?:VOLTS?|VAC|V)\b)/i)
      || first(header, /\b(?:208|240|460|480)\s*(?:VOLTS?|VAC|V)\b/i)
      || first(header, /\b(?:208|240|460|480)\s*(?:3\s*PH(?:ASE)?|THREE\s*PHASE)\b/i);
    const supported = voltage.match(/\b(208|240|460|480)\b/);
    data.voltage = supported ? `${supported[1]}V - 3 Phase` : voltage.toUpperCase();
    if (quote) {
      data.job_number = after(/Quotation\s+Number\s*:?/i, /([0-9][0-9_\-/]+)/, 12);
      const shipIndex = lines.findIndex(line => /\bShip\s*To\s*:/i.test(line));
      if (shipIndex >= 0) {
        const tail = lines[shipIndex].split(/Ship\s*To\s*:/i)[1].trim();
        const block = tail ? [tail] : [];
        for (const line of lines.slice(shipIndex + 1)) {
          if (/^(Description|Delivery Date|Revision|Model Number)\b/i.test(line)) break;
          if (!/^Sold\s*To\b/i.test(line)) block.push(line);
        }
        data.job_name = block.shift() || "";
        data.project_site_address = block.join("\n");
      }
      const contact = text.match(/Prepared\s+for([\s\S]*?)(?:Model\s+Number|$)/i);
      const block = contact ? contact[1].replace(/^\s*:\s*/, "").trim() : "";
      data.contact_name = (block.split("\n")[0] || "").trim();
      data.contact_email = first(block, emailPattern);
      data.contact_phone = first(block, phonePattern);
    } else {
      data.job_number = after(/Job\s*Order\s*#\s*:?/i, /(\d+\s*[_-]\s*\d+)/).replace(/\s/g, "")
        || (text.match(/Job\s*Order\s*Requirements\s+([0-9][0-9_\-/]+)/i) || ["", ""])[1];
      data.job_name = after(/Ship\s*To\s*Name\s*:?/i) || after(/Customer\s*Name\s*:?/i);
      const block = text.match(/Ship\s*To\s*Name:\s*([\s\S]*?)(?:\n\s*Job\s*Order\s*#|\n\s*Order\s*Date|$)/i);
      if (block) data.project_site_address = block[1].split("\n").map(s => s.trim()).filter(Boolean).slice(0, 4).join("\n");
      data.contact_email = first(text, emailPattern);
      const contacts = [...text.matchAll(/\bContact:\s*([^\n]+)/gi)].map(m => m[1].trim())
        .filter(value => value && !/^RELEASED$/i.test(value) && !labelPattern.test(value));
      data.contact_name = contacts.pop() || "";
      if (!data.contact_name && data.contact_email) {
        const index = lines.findIndex(line => line.includes(data.contact_email));
        for (const offset of [1, -1, 2, -2, 3, -3]) {
          const value = lines[index + offset] || "";
          if (/^[A-Z][A-Z .'-]{1,59}$/.test(value) && value.split(/\s+/).length >= 2
            && !/\b(RELEASED|PREPAID|TERMS|CONFIRMED|SCOPE|PRINT|REQUESTED|BUY|AMERICA|ORDER|CONTRACT|JOB|REQUIREMENTS)\b/.test(value)) {
            data.contact_name = value;
            break;
          }
        }
      }
      data.contact_phone = closest(/\b(?:Phone|Telephone)\s*:?/i, phonePattern)
        || after(/\bComment\s*:?/i, phonePattern, 10)
        || (data.contact_email ? closest(emailPattern, phonePattern) : "");
    }
    const digits = data.contact_phone.replace(/\D/g, "");
    if (digits.length === 10) data.contact_phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (!data.job_number && !data.job_name) {
      throw new Error("No recognizable JO fields found. Use a Release or Quote/Contract PDF, or enter the details manually.");
    }
    return data;
  }
  async function parseFile(file) {
    const pdfjs = root.pdfjsLib || await import('./vendor/pdf.mjs');
    root.pdfjsLib = pdfjs;
    if (root.document) pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', root.document.baseURI).href;
    const assets = root.document ? {
      standardFontDataUrl: new URL('./vendor/standard_fonts/', root.document.baseURI).href,
      cMapUrl: new URL('./vendor/cmaps/', root.document.baseURI).href,
      cMapPacked: true,
      wasmUrl: new URL('./vendor/wasm/', root.document.baseURI).href
    } : {};
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, ...assets });
    try {
      const pdf = await task.promise;
      // Match the original parser: first page only, avoiding equipment voltages on later pages.
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      let text = "";
      let previous = null;
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        if (previous && (Math.abs(item.transform[5] - previous.transform[5]) > 3 || item.transform[4] < previous.transform[4] - 3)) text += "\n";
        text += item.str + (item.hasEOL ? "\n" : " ");
        previous = item.hasEOL ? null : item;
      }
      if (!text.trim()) throw new Error("This PDF has no readable text. Scanned PDFs require manual entry.");
      return parseText(text);
    } finally {
      await task.destroy();
    }
  }
  root.JOParser = { parseText, parseFile };
  if (typeof module !== "undefined") module.exports = root.JOParser;
})(typeof window !== "undefined" ? window : globalThis);
