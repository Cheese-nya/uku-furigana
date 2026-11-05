import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeKuromojiCompressedAssets, writeLookupCompressedAssets } from './dictionary-compression.mjs';

// Regenerates the committed Brotli assets after dictionaries change:
//   npm run compress:dict
// The build-dictionary and reading-table scripts call the same helpers themselves.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lookupRoot = path.join(root, 'public', 'lookup');
const dictRoot = path.join(root, 'public', 'dict');

const results = [];
for (const name of fs.existsSync(lookupRoot) ? fs.readdirSync(lookupRoot).sort() : []) {
  const directory = path.join(lookupRoot, name);
  if (!fs.statSync(directory).isDirectory()) continue;
  const result = writeLookupCompressedAssets(directory);
  if (result) results.push(`${name}: ${result.shards} shards, ${(result.bytes / (1024 * 1024)).toFixed(2)} MiB Brotli`);
}
const dict = writeKuromojiCompressedAssets(dictRoot);
if (dict) results.push(`dict: ${dict.files} files, ${(dict.bytes / (1024 * 1024)).toFixed(2)} MiB Brotli`);

if (!results.length) throw new Error('no dictionary assets found');
console.log(results.join('\n'));
