// Copies runtime files that live in node_modules into public/vendor/ (gitignored), so the
// static export serves them: the pdf.js worker and the CMaps it needs for Japanese PDFs.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjs = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'public', 'vendor', 'pdfjs');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(pdfjs, 'legacy', 'build', 'pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
cpSync(join(pdfjs, 'cmaps'), join(target, 'cmaps'), { recursive: true });
cpSync(join(pdfjs, 'standard_fonts'), join(target, 'standard_fonts'), { recursive: true });
console.log('==> pdf.js runtime copied to public/vendor/pdfjs');
