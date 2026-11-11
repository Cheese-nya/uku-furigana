import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const source = new URL('../extensions/pixiv-helper/', import.meta.url);
const zip = new JSZip();
for (const name of readdirSync(source).sort()) {
  zip.file(`uku-pixiv-helper/${name}`, readFileSync(new URL(name, source)), { date: new Date('2000-01-01T00:00:00Z') });
}
writeFileSync(fileURLToPath(new URL('../public/uku-pixiv-helper.zip', import.meta.url)), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
