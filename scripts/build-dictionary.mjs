import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { loadTypescript } from '../tests/loadTypescript.mjs';

const { readYomitanZip } = loadTypescript('../app/utils/yomitanFormat.ts');

const SHARD_SIZE = 20_000;

async function main() {
  const zipPath = path.resolve(process.argv[2] || 'tools/dict-src/wty-ja-zh.zip');
  const outDir = path.resolve(process.argv[3] || 'public/lookup/ja-zh');

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
    id: 'wty-ja-zh',
    title: '日中词典（维基词典）',
    titleEn: 'Japanese–Chinese (Wiktionary)',
    revision: revision || String(rawIndex.revision || ''),
    attribution: 'Wiktionary contributors via kaikki.org / wty, CC BY-SA 4.0',
    license: 'CC BY-SA 4.0',
    url: typeof rawIndex.url === 'string' && rawIndex.url
      ? rawIndex.url
      : 'https://github.com/yomidevs/wiktionary-to-yomitan',
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
