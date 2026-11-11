import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { loadTypescript } from './loadTypescript.mjs';

const { buildEpubBlob } = loadTypescript('../app/utils/epubExporter.ts');
const { buildBatchSaveOutput } = loadTypescript('../app/utils/fileSave.ts');

function localHeader(buffer) {
  const bytes = new Uint8Array(buffer);
  const signature = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const method = bytes[8] | (bytes[9] << 8);
  const nameLength = bytes[26] | (bytes[27] << 8);
  const decoded = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
  return { signature, method, decoded };
}

test('EPUB export writes native top ruby, valid XHTML, and an EPUB ZIP container', async () => {
  const lines = [
    {
      id: '1',
      rawText: '号哭',
      cleanText: '号哭',
      tokens: [{ surface: '号哭', ruby: 'ごうこく', hasKanji: true }],
    },
    {
      id: '2',
      rawText: '号哭',
      cleanText: '号哭',
      tokens: [{ surface: '号哭', ruby: 'ごうこく', hasKanji: true, annotationSuppressed: true }],
    },
  ];
  const blob = await buildEpubBlob(lines, { title: '号哭' });
  assert.equal(blob.type, 'application/epub+zip');

  const buffer = await blob.arrayBuffer();
  const header = localHeader(buffer);
  assert.equal(header.signature, true);
  assert.equal(header.decoded, 'mimetype');
  assert.equal(header.method, 0, 'mimetype must be STORE');

  const zip = await JSZip.loadAsync(buffer);
  assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
  assert.equal(zip.files.mimetype._data.compression.magic, '\x00\x00');
  const xhtml = await zip.file('OEBPS/chapter-001.xhtml').async('string');
  assert.match(xhtml, /<ruby>号哭<rt>ごうこく<\/rt><\/ruby>/);
  assert.doesNotMatch(xhtml, /<rp>|\(ごうこく\)|（ごうこく）/);
  assert.match(xhtml, /<p>号哭<\/p>/, 'suppressed annotations export as plain text');
  const parserErrors = [];
  const doc = new DOMParser({ onError: (level, message) => parserErrors.push(`${level}: ${message}`) })
    .parseFromString(xhtml, 'application/xhtml+xml');
  assert.deepEqual(parserErrors, []);
  assert.equal(doc.getElementsByTagName('parsererror').length, 0);
  assert.equal(doc.getElementsByTagName('rt')[0].textContent, 'ごうこく');

  for (const xmlPath of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml']) {
    const xml = await zip.file(xmlPath).async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${xmlPath} must be valid XML`);
  }
  const css = await zip.file('OEBPS/style.css').async('string');
  assert.match(css, /ruby-position:\s*over/);
  assert.match(css, /-webkit-ruby-position:\s*before/);

  // A single output is saved as a real .epub, not wrapped in the old 台本批量导出.zip.
  const saved = await buildBatchSaveOutput([{ filename: '号哭.epub', blob }]);
  assert.equal(saved.filename, '号哭.epub');
  assert.equal(saved.blob, blob);
});

test('batch export uses a direct Safari-safe save and offers a fresh-gesture retry', () => {
  const hook = readFileSync(fileURLToPath(new URL('../app/hooks/useBatchProcessing.ts', import.meta.url)), 'utf8');
  assert.match(hook, /skipFilePicker: true, skipShare: true/);
  assert.match(hook, /buildBatchSaveOutput\(zipOutputs\)/);
  assert.match(hook, /pendingSaveOutputRef\.current = finalSaveOutput/);
  const done = readFileSync(fileURLToPath(new URL('../app/components/BatchDoneModal.tsx', import.meta.url)), 'utf8');
  assert.match(done, /t\.batchSaveAgain/);
});
