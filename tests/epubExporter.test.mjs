import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { loadTypescript } from './loadTypescript.mjs';

const { buildEpubBlob } = loadTypescript('../app/utils/epubExporter.ts');

function parseStrictXml(source, label) {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${label} must be well-formed XML`);
  return doc;
}

test('buildEpubBlob emits valid EPUB 3 archive with stored mimetype first, ruby, suppressed ruby, blank lines, and sanitized XML', async () => {
  const lines = [
    {
      id: '1',
      speaker: '佐藤\u0000',
      rawText: '私と漢字',
      cleanText: '私と漢字',
      tokens: [
        { surface: '私', ruby: 'わたし', hasKanji: true },
        { surface: 'と\u0007', hasKanji: false },
        { surface: '漢字\uD800', ruby: 'かんじ', hasKanji: true, annotationSuppressed: true },
      ],
    },
    { id: 'blank', rawText: '', cleanText: '', tokens: [] },
    {
      id: '2',
      rawText: '未来',
      cleanText: '未来',
      tokens: [{ surface: '未来', ruby: 'みらい', hasKanji: true }],
    },
  ];

  const blob = await buildEpubBlob(lines, { title: '放課後\u0000_dubbing' });
  assert.equal(blob.type, 'application/epub+zip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Local file header starts with 'mimetype' + 'application/epub+zip' uncompressed
  const headerAscii = new TextDecoder('latin1').decode(bytes.slice(0, 80));
  assert.ok(headerAscii.includes('mimetypeapplication/epub+zip'), 'mimetype must be first and uncompressed');

  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');

  const containerXml = await zip.file('META-INF/container.xml').async('string');
  const opfXml = await zip.file('OEBPS/content.opf').async('string');
  const navXml = await zip.file('OEBPS/nav.xhtml').async('string');
  const chXml = await zip.file('OEBPS/chapter-001.xhtml').async('string');

  parseStrictXml(containerXml, 'container.xml');
  const opfDoc = parseStrictXml(opfXml, 'content.opf');
  parseStrictXml(navXml, 'nav.xhtml');
  const chDoc = parseStrictXml(chXml, 'chapter-001.xhtml');

  assert.match(opfXml, /<dc:title>放課後<\/dc:title>/);
  assert.equal(opfDoc.getElementsByTagName('itemref').length, 1);

  assert.match(chXml, /<span class="speaker">佐藤：<\/span>/);
  assert.match(chXml, /<ruby>私<rt>わたし<\/rt><\/ruby>/);
  assert.equal(chXml.includes('<rt>かんじ</rt>'), false, 'suppressed annotation must not emit <rt>');
  assert.equal(chXml.includes('\u0000'), false);
  assert.equal(chXml.includes('\u0007'), false);
  assert.match(chXml, /<p>&#160;<\/p>/, 'blank lines must stay non-collapsed');
  assert.equal(chDoc.getElementsByTagName('ruby').length, 2);
});

test('buildEpubBlob emits well-formed bilingual markup and translation styles when translations provided', async () => {
  const lines = [
    {
      id: '1',
      speaker: '佐藤',
      rawText: '私が行く',
      cleanText: '私が行く',
      tokens: [
        { surface: '私', ruby: 'わたし', hasKanji: true },
        { surface: 'が行く', hasKanji: false },
      ],
    },
    { id: 'blank', rawText: '', cleanText: '', tokens: [] },
    {
      id: '2',
      rawText: '未来',
      cleanText: '未来',
      tokens: [{ surface: '未来', ruby: 'みらい', hasKanji: true }],
    },
  ];

  const blob = await buildEpubBlob(lines, {
    title: '双语书籍',
    translations: ['我去 & 测试 <OK>', undefined, undefined],
    translationLang: 'zh-Hans',
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const css = await zip.file('OEBPS/style.css').async('string');
  const chXml = await zip.file('OEBPS/chapter-001.xhtml').async('string');
  parseStrictXml(chXml, 'bilingual chapter-001.xhtml');

  assert.match(css, /\.bilingual\s*\{/);
  assert.match(css, /\.translation\s*\{/);
  assert.match(chXml, /<div class="bilingual"><p class="line">[\s\S]*?<p class="translation" xml:lang="zh-Hans" lang="zh-Hans">我去 &amp; 测试 &lt;OK&gt;<\/p><\/div>/);
  assert.match(chXml, /<p>&#160;<\/p>/);
  assert.match(chXml, /<p><ruby>未来<rt>みらい<\/rt><\/ruby><\/p>/);
});
