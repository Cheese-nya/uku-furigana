import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { detectBookFormat, isImportableFile, parseBookFile } = loadTypescript('../app/utils/bookImport.ts');

const bytes = text => Array.from(new TextEncoder().encode(text));
const PDF_HEAD = new Uint8Array(bytes('%PDF-1.7\n1 0 obj\n'));

// A ZIP that opens with a stored `mimetype` entry, exactly as EPUB requires (local file
// header: signature, version, flags, method=store, time, date, crc, sizes, name/extra lengths).
const EPUB_HEAD = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00,
  0x08, 0x00, 0x00, 0x00,
  ...bytes('mimetype'), ...bytes('application/epub+zip'),
]);
const DOCX_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, ...bytes('word/')]);

test('detectBookFormat：扩展名 → MIME → 文件头，Android content:// 无扩展名也能认出 PDF', async () => {
  assert.equal(await detectBookFormat(new File([new Uint8Array([1, 2, 3])], 'a.pdf')), 'pdf');
  assert.equal(await detectBookFormat(new File([new Uint8Array([1, 2, 3])], 'document:1234', { type: 'application/pdf' })), 'pdf');
  assert.equal(await detectBookFormat(new File([PDF_HEAD], 'msf:42')), 'pdf');
  assert.equal(await detectBookFormat(new File([EPUB_HEAD], 'document:7')), 'epub');
  assert.equal(await detectBookFormat(new File([EPUB_HEAD], 'document:7', { type: 'application/epub+zip' })), 'epub');
  assert.equal(await detectBookFormat(new File([DOCX_HEAD], 'document:9')), 'docx');
  assert.equal(await detectBookFormat(new File([bytes('ただのテキスト')], 'document:5')), null);
});

test('isImportableFile：无扩展名的 content:// 文件靠 MIME 进批处理队列', () => {
  assert.equal(isImportableFile(new File([PDF_HEAD], 'document:1234', { type: 'application/pdf' })), true);
  assert.equal(isImportableFile(new File([DOCX_HEAD], 'document:1234', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })), true);
  assert.equal(isImportableFile(new File(['台本'], 'script.txt')), true);
  assert.equal(isImportableFile(new File(['台本'], 'document:5', { type: 'text/plain' })), true);
  assert.equal(isImportableFile(new File([PDF_HEAD], 'document:1234', { type: 'image/png' })), false);
});

test('parseBookFile：无扩展名的纯文本仍按文本导入', async () => {
  const parsed = await parseBookFile(new File(['吾輩は猫である。'], 'document:5', { type: 'text/plain' }));
  assert.equal(parsed.format, 'txt');
  assert.equal(parsed.content, '吾輩は猫である。');
});
