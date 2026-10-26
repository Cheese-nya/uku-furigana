import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Builds public/dict/readings.json.gz: every kanji-containing term of the bundled Jitendex shards
// mapped to the readings the dictionary knows, best score first. The tokenizer's own reading is then
// cross-checked against this table, so a wrong (or merely ambiguous) reading can be flagged for review.
//
//   node tools/build-reading-table.mjs
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'public', 'lookup', 'ja-en');
const outFile = path.join(root, 'public', 'dict', 'readings.json.gz');

// CJK Ext. A + the BMP kanji block, the same range the app uses for "has kanji".
const KANJI = /[㐀-䶿一-鿿]/;
// A reading is kana only; anything else in that field is a placeholder, not a reading.
const KANA = /^[\u3040-\u309F\u30A0-\u30FF]+$/;
const katakanaToHiragana = text => text.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const shards = fs.readdirSync(sourceDir).filter(name => /^terms-\d+\.json\.gz$/.test(name)).sort();
if (!shards.length) throw new Error(`no terms-*.json.gz shards in ${sourceDir}`);

/** term → reading → highest score seen, in first-seen order. */
const readings = new Map();
let examined = 0;

for (const shard of shards) {
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(sourceDir, shard))).toString('utf8'));
  if (!Array.isArray(rows)) throw new Error(`${shard} is not an array of entries`);
  for (const row of rows) {
    examined++;
    if (!Array.isArray(row)) continue;
    const [term, reading, , , , score] = row;
    if (typeof term !== 'string' || !KANJI.test(term)) continue;
    if (typeof reading !== 'string') continue;
    const hiragana = katakanaToHiragana(reading.normalize('NFKC').trim());
    if (!KANA.test(hiragana)) continue;
    const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
    let entries = readings.get(term);
    if (!entries) readings.set(term, (entries = new Map()));
    entries.set(hiragana, Math.max(entries.get(hiragana) ?? -Infinity, value));
  }
}

/** Same reading list the app reads: deduped, commonest reading first. */
const table = {};
for (const [term, entries] of readings) {
  table[term] = [...entries].sort((a, b) => b[1] - a[1]).map(([reading]) => reading);
}

const json = JSON.stringify(table);
const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, gz);

const mb = (gz.byteLength / (1024 * 1024)).toFixed(2);
const ambiguous = Object.values(table).filter(list => list.length > 1).length;
console.log(
  `Built ${Object.keys(table).length} readings (${ambiguous} with alternatives) from ${examined} entries in ${shards.length} shards — ` +
    `${outFile}: ${gz.byteLength} bytes (${mb} MB)`,
);
