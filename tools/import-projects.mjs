import fs from 'node:fs/promises';
import path from 'node:path';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/import-projects.mjs <backup.json> <output.sql>');
let rows = JSON.parse(await fs.readFile(input, 'utf8'));
if (rows.length === 1 && Array.isArray(rows[0])) rows = rows[0];
if (!Array.isArray(rows) || !rows.length) throw new Error('No records to import.');
const seen = new Set();
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const statements = [];
for (const row of rows) {
  if (!row.project_number || !row.project_name) throw new Error('Invalid record in backup.');
  const key = row.project_number.toLowerCase();
  if (seen.has(key)) throw new Error('Duplicate project number in backup: ' + row.project_number);
  seen.add(key);
  // All original fields and historical note markup are retained, including fields
  // unknown to this version. Existing target records are never overwritten.
  statements.push(`INSERT INTO projects (project_number,data,version,updated_at,updated_by) VALUES (${quote(row.project_number)},${quote(JSON.stringify(row))},1,${quote(row.created_at || new Date().toISOString())},'migration') ON CONFLICT(project_number) DO NOTHING;`);
}
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, statements.join('\n') + '\n');
console.log(`Prepared ${rows.length} records for import (${rows.filter(r => r.project_status === 'Completed').length} completed). No remote database was changed.`);
