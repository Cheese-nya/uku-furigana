// Copies runtime files that live in node_modules into public/vendor/ (gitignored), so the
// static export serves them: the pdf.js worker and the CMaps it needs for Japanese PDFs.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjs = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'public', 'vendor', 'pdfjs');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// Saved as .js: a server without an .mjs MIME type (nginx's default list) plus nosniff would refuse the module worker.
// Expose /ActualText from PDF Marked Content (/Span <</ActualText (...)>> BDC) on beginMarkedContentProps items so
// vertical/Type3 PDFs that store Unicode in /ActualText instead of /ToUnicode CMaps retain their text.
const workerSrc = readFileSync(join(pdfjs, 'legacy', 'build', 'pdf.worker.min.mjs'), 'utf8');
if (!/\bclass Dict\b/.test(workerSrc) || !/\bfunction stringToPDFString\b/.test(workerSrc)) {
  throw new Error('Expected Dict and stringToPDFString in pdf.worker.min.mjs');
}
const patchedWorker = workerSrc.replace(
  /(type:"beginMarkedContentProps",id:[^,]+,tag:([A-Za-z0-9_$]+)\[0\]instanceof Name\?\2\[0\]\.name:null)/,
  '$1,actualText:$2[1]instanceof Dict&&"string"==typeof $2[1].get("ActualText")?stringToPDFString($2[1].get("ActualText")):null',
);
if (patchedWorker === workerSrc) {
  throw new Error('Failed to patch beginMarkedContentProps in pdf.worker.min.mjs');
}
writeFileSync(join(target, 'pdf.worker.min.js'), patchedWorker);
cpSync(join(pdfjs, 'cmaps'), join(target, 'cmaps'), { recursive: true });
cpSync(join(pdfjs, 'standard_fonts'), join(target, 'standard_fonts'), { recursive: true });
console.log('==> pdf.js runtime copied to public/vendor/pdfjs');
