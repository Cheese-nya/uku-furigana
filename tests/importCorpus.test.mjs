import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { loadTypescript } from './loadTypescript.mjs';

globalThis.DOMParser = DOMParser;

const { importEpub } = loadTypescript('../app/utils/epubImporter.ts');
const { importPdf } = loadTypescript('../app/utils/pdfImporter.ts');
const { IMAGE_LINE } = loadTypescript('../app/utils/bookAssets.ts');

const ROOT = fileURLToPath(new URL('./fixtures/import', import.meta.url));

const KNOWN_WARNINGS = new Set([
  'auto-chapters', 'running-heads-removed', 'footnotes-inline', 'fixed-layout',
  'missing-cover', 'images-skipped', 'low-text', 'unknown-image-format',
]);

function corpusFiles(dir = ROOT) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Unsupported samples (scanned, encrypted) live here by convention and are not imported.
      if (entry.name !== 'unsupported') found.push(...corpusFiles(path));
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (extension !== '.pdf' && extension !== '.epub') continue;
    if (/\.encrypted\.[^.]+$/i.test(entry.name)) continue;
    found.push(path);
  }
  return found;
}

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function readableChars(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => !IMAGE_LINE.test(line))
    .join('')
    .replace(/\s/g, '').length;
}

function validateBook(file, book) {
  const label = relative(ROOT, file);
  assert.ok(book.title.trim(), `${label}: title is empty`);
  assert.ok(!book.text.includes('\u0000'), `${label}: text contains NUL`);
  const chars = readableChars(book.text);
  assert.ok(chars >= 100, `${label}: only ${chars} readable characters`);

  const lineCount = book.text.replace(/\r\n?/g, '\n').split('\n').length;
  let lastStart = -1;
  let lastPage = 0;
  for (const chapter of book.chapters) {
    assert.ok(Number.isInteger(chapter.startLine) && chapter.startLine >= lastStart, `${label}: chapter ${JSON.stringify(chapter.title)} startLine out of order`);
    assert.ok(chapter.startLine < lineCount, `${label}: chapter ${JSON.stringify(chapter.title)} starts past the text`);
    lastStart = chapter.startLine;
    if (chapter.level !== undefined) {
      assert.ok(chapter.level >= 0 && chapter.level <= 2, `${label}: chapter level ${chapter.level} out of range`);
    }
    if (chapter.page !== undefined) {
      assert.ok(Number.isInteger(chapter.page) && chapter.page >= 1, `${label}: chapter page ${chapter.page} invalid`);
      assert.ok(chapter.page >= lastPage, `${label}: chapter page ${chapter.page} goes backwards`);
      lastPage = chapter.page;
    }
  }

  if (book.pageStarts) {
    assert.ok(book.pageStarts.length > 0, `${label}: empty pageStarts`);
    let previous = -1;
    for (const start of book.pageStarts) {
      assert.ok(start >= -1 && start < lineCount, `${label}: pageStarts value ${start} out of range`);
      if (start >= 0) {
        assert.ok(start >= previous, `${label}: pageStarts goes backwards`);
        previous = start;
      }
    }
    if (book.pageLabels) {
      assert.equal(book.pageLabels.length, book.pageStarts.length, `${label}: pageLabels length mismatch`);
    }
  }

  for (const warning of book.warnings) {
    assert.ok(KNOWN_WARNINGS.has(warning.code), `${label}: unknown warning ${warning.code}`);
  }

  console.log(
    `[corpus] ${label}: ${chars} 字 · ${book.chapters.length} 章 · ${book.chapters.filter(c => (c.level ?? 0) > 0).length} 子级 · `
    + `${book.images.length} 图 · ${book.pageStarts?.length ?? 0} 页 · ${book.warnings.length} 告警`,
  );
}

const files = (() => {
  try {
    return corpusFiles();
  } catch {
    return [];
  }
})();

test('real PDF/EPUB corpus imports with sane structure', {
  skip: files.length ? false : 'no real samples in tests/fixtures/import (see README.md)',
}, async t => {
  for (const file of files) {
    const name = relative(ROOT, file);
    await t.test(name, async () => {
      const bytes = new Uint8Array(readFileSync(file));
      const data = asArrayBuffer(bytes);
      let book;
      if (extname(file).toLowerCase() === '.epub') {
        book = await importEpub(data, name, new DOMParser());
      } else {
        // pdf.js works in Node for text extraction, but there is no canvas: the cover renderer and
        // image encoder are stubbed out here. Browser smoke tests still cover those two paths.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
        const doc = await task.promise;
        try {
          book = await importPdf(asArrayBuffer(bytes), name, doc, {
            renderCover: async () => null,
            encodeImage: async () => null,
          });
        } finally {
          await task.destroy();
        }
      }
      validateBook(file, book);
    });
  }
});
