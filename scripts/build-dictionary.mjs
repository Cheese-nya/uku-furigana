import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { loadTypescript } from '../tests/loadTypescript.mjs';

// Bundled dictionaries (sources are downloaded into tools/dict-src/, which is not committed):
//   node scripts/build-dictionary.mjs ja-zh   wty-ja-zh.zip from https://huggingface.co/datasets/daxida/wty-release (latest/dict/ja/zh)
//   node scripts/build-dictionary.mjs ja-en   jitendex-yomitan.zip from https://jitendex.org/pages/downloads.html
const BUILTINS = {
  'ja-zh': {
    source: 'tools/dict-src/wty-ja-zh.zip',
    id: 'wty-ja-zh',
    title: '日中词典（维基词典）',
    titleEn: 'Japanese–Chinese (Wiktionary)',
    attribution: 'Wiktionary contributors via kaikki.org / wty, CC BY-SA 4.0',
    license: 'CC BY-SA 4.0',
    url: 'https://github.com/yomidevs/wiktionary-to-yomitan',
  },
  'ja-en': {
    source: 'tools/dict-src/jitendex-yomitan.zip',
    id: 'jitendex',
    title: '日英词典（Jitendex）',
    titleEn: 'Japanese–English (Jitendex)',
    attribution: 'Jitendex © Stephen Kraus, built on JMdict (EDRDG) and Tatoeba, CC BY-SA 4.0',
    license: 'CC BY-SA 4.0',
    url: 'https://jitendex.org',
  },
};

const { readYomitanZip } = loadTypescript('../app/utils/yomitanFormat.ts');

const SHARD_SIZE = 20_000;

async function main() {
  const key = process.argv[2] || 'ja-zh';
  const meta = BUILTINS[key];
  if (!meta) throw new Error(`unknown dictionary ${key}; one of ${Object.keys(BUILTINS).join(', ')}`);
  const zipPath = path.resolve(process.argv[3] || meta.source);
  const outDir = path.resolve(process.argv[4] || `public/lookup/${key}`);

  const rawBuf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(rawBuf);
  const rawIndexFile = zip.file('index.json') ?? zip.file(/(?:^|\/)index\.json$/)[0];
  const rawIndex = rawIndexFile ? JSON.parse(await rawIndexFile.async('string')) : {};

  const { revision, entries } = await readYomitanZip(rawBuf);

  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return b[5] - a[5];
  });

  fs.mkdirSync(outDir, { recursive: true });
  for (const existing of fs.readdirSync(outDir)) {
    if (/^terms-\d+\.json\.gz$/.test(existing)) {
      fs.unlinkSync(path.join(outDir, existing));
    }
  }

  const shards = [];
  let totalBytes = 0;

  for (let i = 0, shardIdx = 0; i < entries.length; i += SHARD_SIZE, shardIdx++) {
    const chunk = entries.slice(i, i + SHARD_SIZE);
    const shardName = `terms-${String(shardIdx).padStart(2, '0')}.json.gz`;
    const json = JSON.stringify(chunk);
    const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
    fs.writeFileSync(path.join(outDir, shardName), gz);
    shards.push(shardName);
    totalBytes += gz.byteLength;
  }

  const indexData = {
    id: meta.id,
    title: meta.title,
    titleEn: meta.titleEn,
    revision: revision || String(rawIndex.revision || rawIndex.title || ''),
    attribution: meta.attribution,
    license: meta.license,
    url: meta.url,
    count: entries.length,
    shards,
  };

  const indexJson = `${JSON.stringify(indexData, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, 'index.json'), indexJson, 'utf8');
  totalBytes += Buffer.byteLength(indexJson, 'utf8');

  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(
    `Built ${entries.length} entries across ${shards.length} shards in ${outDir} — total size: ${totalBytes} bytes (${mb} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
