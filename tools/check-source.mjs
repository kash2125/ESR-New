import fs from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../public/', import.meta.url);
for (const name of await fs.readdir(root)) {
  if (!/\.(html|js)$/.test(name)) continue;
  const text = await fs.readFile(new URL(name, root), 'utf8');
  if (/supabase|mckmcozsmbmbrybxydfq|sb_publishable|kayleem@/i.test(text)) throw new Error('Legacy dependency in ' + name);
  if (name.endsWith('.html')) {
    for (const [index, match] of [...text.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].entries()) new vm.Script(match[1], { filename: `${name}:inline-${index}` });
    for (const match of text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const value = match[1].split('?')[0];
      if (/^(https?:|mailto:|\/|blob:|data:)/.test(value)) continue;
      await fs.access(new URL(value, root));
    }
  } else new vm.Script(text, { filename: name });
}
console.log('Frontend scripts parse, local assets exist, and no legacy Supabase account references remain.');
