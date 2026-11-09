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
// pdf.js 6 needs APIs newer than HarmonyOS 4's Chrome 99: Promise.withResolvers (Chrome 119+),
// async iteration over native ReadableStreams (Chrome 124+), and ArrayBuffer.transferToFixedLength
// (Chrome 114+). The main thread installs its shims in app/utils/pdfjsCompat.ts; the worker cannot
// import that module, so prepend all three here. The transfer shim copies instead of detaching;
// pdf.js only needs the resized copy.
const chrome99Polyfills = [
  'if(typeof Promise.withResolvers!=="function"){Promise.withResolvers=function(){var resolve,reject;var promise=new Promise(function(res,rej){resolve=res;reject=rej});return{promise:promise,resolve:resolve,reject:reject}};}',
  'if(typeof ReadableStream!=="undefined"&&typeof ReadableStream.prototype[Symbol.asyncIterator]!=="function"){ReadableStream.prototype[Symbol.asyncIterator]=function(){var reader=this.getReader();return{next:function(){return reader.read().then(function(result){if(result.done){reader.releaseLock()}return result})},return:function(value){return reader.cancel().catch(function(){}).then(function(){reader.releaseLock();return{done:true,value:value}})},throw:function(error){reader.releaseLock();return Promise.reject(error)},[Symbol.asyncIterator]:function(){return this}}}}',
  'if(typeof ArrayBuffer!=="undefined"&&typeof ArrayBuffer.prototype.transferToFixedLength!=="function"){ArrayBuffer.prototype.transferToFixedLength=function(newLength){var source=new Uint8Array(this);var length=newLength===undefined?source.length:newLength;var target=new ArrayBuffer(length);new Uint8Array(target).set(source.subarray(0,Math.min(source.length,length)));return target;};}',
].join('');
writeFileSync(join(target, 'pdf.worker.min.js'), chrome99Polyfills + patchedWorker);
cpSync(join(pdfjs, 'cmaps'), join(target, 'cmaps'), { recursive: true });
cpSync(join(pdfjs, 'standard_fonts'), join(target, 'standard_fonts'), { recursive: true });
console.log('==> pdf.js runtime copied to public/vendor/pdfjs');
await import('./build-pixiv-browser-helper.mjs');
