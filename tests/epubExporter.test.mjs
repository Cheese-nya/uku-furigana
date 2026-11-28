import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { loadTypescript } from './loadTypescript.mjs';

const { buildEpubBlob } = loadTypescript('../app/utils/epubExporter.ts');
const { importEpub } = loadTypescript('../app/utils/epubImporter.ts');
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

test('buildEpubBlob preserves cover image, author, and round-trips through importEpub cleanly', async () => {
  const lines = [
    {
      id: '1',
      rawText: '吾輩は猫である',
      cleanText: '吾輩は猫である',
      tokens: [{ surface: '吾輩', ruby: 'わがはい', hasKanji: true }, { surface: 'は猫である', hasKanji: false }],
    },
  ];
  const blob = await buildEpubBlob(lines, {
    title: '猫の本',
    author: '夏目漱石',
    cover: TINY_PNG_DATA_URL,
  });
  const bytes = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  const opfXml = await zip.file('OEBPS/content.opf').async('string');
  assert.ok(zip.file('OEBPS/images/cover.png'));
  assert.ok(zip.file('OEBPS/cover.xhtml'));
  assert.match(opfXml, /properties="cover-image"/);
  assert.match(opfXml, /<meta name="cover" content="cover-image"\/>/);
  assert.match(opfXml, /<itemref idref="cover"\/>/);
  assert.match(opfXml, /<dc:creator>夏目漱石<\/dc:creator>/);

  const originalDomParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  try {
    const imported = await importEpub(bytes, 'cat.epub');
    assert.ok(imported.cover, 'imported EPUB should recover exported cover');
    assert.equal(imported.cover.mime, 'image/png');
    assert.equal(imported.author, '夏目漱石');
    assert.match(imported.text, /吾輩は猫である/);
  } finally {
    globalThis.DOMParser = originalDomParser;
  }
});
