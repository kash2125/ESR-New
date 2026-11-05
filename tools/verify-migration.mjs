import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const input = process.argv[2];
if (!input) throw new Error('Usage: node tools/verify-migration.mjs <original-backup.json>');
const source = JSON.parse(await fs.readFile(input,'utf8'));
const folder = '.wrangler/state/v3/d1';
const entries = await fs.readdir(folder,{recursive:true});
let compared = false;
for (const entry of entries.filter(name => name.endsWith('.sqlite'))) {
  const db = new DatabaseSync(path.join(folder,entry),{readOnly:true});
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get()) continue;
    const imported = db.prepare('SELECT data FROM projects').all().map(row => JSON.parse(row.data));
    assert.equal(imported.length,source.length);
    const records = new Map(imported.map(row => [row.project_number,row]));
    for (const original of source) assert.deepEqual(records.get(original.project_number),original);
    console.log(`Migration verified: all ${source.length} local D1 records match the original export, including every historical note and field.`);
    compared = true;
  } finally { db.close(); }
}
if (!compared) throw new Error('No local projects database found.');
