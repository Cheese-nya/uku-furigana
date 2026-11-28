import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { loadTypescript } from './loadTypescript.mjs';

const { buildDocxBlob } = loadTypescript('../app/utils/docxExporter.ts');
const { importDocx } = loadTypescript('../app/utils/docxImporter.ts');
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const elements = (node, name) => Array.from(node.getElementsByTagNameNS(namespace, name));

for (const options of [undefined, { baseFontSize: 24, rubyFontSize: 14, lineSpacing: 2.4 }]) {
  test(`Word export retains annotated Japanese text with valid run nesting (${JSON.stringify(options)})`, async () => {
    const tokens = [
      { surface: '私', ruby: 'わたし', hasKanji: true },
      { surface: 'はペッパピッグ。', hasKanji: false },
      { surface: '二人', ruby: 'ふたり', hasKanji: true },
      { surface: 'で', hasKanji: false },
      { surface: '行', ruby: 'い', hasKanji: true },
      { surface: 'っておいで', hasKanji: false },
    ];
    const line = { id: 'example', rawText: '', cleanText: '', tokens };
    const blob = await buildDocxBlob([line, { ...line, id: 'blank', tokens: [] }], options);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'text/xml');
    const rubies = elements(xml, 'ruby');
    assert.equal(rubies.length, 3);
    for (const ruby of rubies) {
      assert.equal(ruby.parentNode.localName, 'r', 'ruby must be run content for WPS');
      assert.equal(ruby.parentNode.parentNode.localName, 'p');
      assert.equal(elements(ruby, 'rubyAlign')[0].getAttributeNS(namespace, 'val'), 'center');
      assert.equal(elements(ruby, 'hpsBaseText')[0].getAttributeNS(namespace, 'val'), String(Math.round((options?.baseFontSize || 16) * 1.5)));
      assert.equal(elements(ruby, 'hps')[0].getAttributeNS(namespace, 'val'), String(Math.round((options?.rubyFontSize || 10) * 1.5)));
      assert.equal(elements(ruby, 'rubyBase').length, 1);
      assert.equal(elements(ruby, 'rt').length, 1);
    }
    const paragraph = rubies[0].parentNode.parentNode;
    const bodyText = elements(paragraph, 't').filter(node => {
      for (let parent = node.parentNode; parent !== paragraph; parent = parent.parentNode) {
        if (parent.localName === 'rt') return false;
      }
      return true;
    }).map(node => node.textContent).join('');
    assert.equal(bodyText, tokens.map(token => token.surface).join(''));
    assert.equal(elements(rubies[1], 'rubyBase')[0].textContent, '二人');
    assert.equal(elements(rubies[1], 'rt')[0].textContent, 'ふたり');
    assert.equal(elements(paragraph, 'spacing')[0].getAttributeNS(namespace, 'line'), String(Math.round((options?.lineSpacing || 1.8) * 240)));
    const documentText = elements(xml, 't').map(node => node.textContent).join('\n');
    assert.equal(documentText.includes('Furigana Dubbing Studio 自动注音导出'), false);
    assert.equal(documentText.includes('由 Furigana Dubbing Studio 自动生成'), false);
    assert.equal(documentText.includes('チーズ@beimisama'), false);
  });
}

test('Word export title drops a trailing _dubbing suffix and has no footer rule', async () => {
  const line = { id: 'example', rawText: '', cleanText: '', tokens: [{ surface: '本文', hasKanji: false }] };
  const blob = await buildDocxBlob([line], { title: '放課後_dubbing_dubbing.docx' });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'text/xml');
  const text = elements(xml, 't').map(node => node.textContent).join('\n');
  assert.match(text, /放課後/);
  assert.equal(text.includes('_dubbing'), false);
  assert.equal(text.includes('自动注音导出'), false);
  assert.equal(text.includes('自动生成'), false);
  assert.equal(elements(xml, 'pBdr').length, 0);
});

test('Word export omits suppressed ruby and strips XML-illegal control characters', async () => {
  const line = {
    id: 'suppressed',
    speaker: '佐藤\u0000',
    rawText: '',
    cleanText: '',
    tokens: [
      { surface: '私', ruby: 'わたし', hasKanji: true, annotationSuppressed: true },
      { surface: '\u0007漢字\uD800', ruby: 'かん\u0000じ', hasKanji: true },
    ],
  };
  const blob = await buildDocxBlob([line], { title: '題名\u0000' });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const rawXml = await zip.file('word/document.xml').async('string');
  const xml = new DOMParser().parseFromString(rawXml, 'text/xml');
  assert.equal(xml.getElementsByTagName('parsererror').length, 0);
  const rubies = elements(xml, 'ruby');
  assert.equal(rubies.length, 1);
  assert.equal(elements(rubies[0], 'rubyBase')[0].textContent, '漢字');
  assert.equal(elements(rubies[0], 'rt')[0].textContent, 'かんじ');
  assert.equal(rawXml.includes('\u0000'), false);
  assert.equal(rawXml.includes('\u0007'), false);
});

test('Word export appends bilingual translation paragraph with keepNext and sanitized text', async () => {
  const lines = [
    {
      id: 'b1',
      speaker: '佐藤',
      rawText: '学校へ行く',
      cleanText: '学校へ行く',
      tokens: [
        { surface: '学校', ruby: 'がっこう', hasKanji: true },
        { surface: 'へ', hasKanji: false },
        { surface: '行', ruby: 'い', hasKanji: true },
        { surface: 'く', hasKanji: false },
      ],
    },
    { id: 'blank', rawText: '', cleanText: '', tokens: [] },
  ];
  const blob = await buildDocxBlob(lines, {
    title: '双语台本',
    translations: ['佐藤：去学校\u0007测试', undefined],
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const rawXml = await zip.file('word/document.xml').async('string');
  const xml = new DOMParser().parseFromString(rawXml, 'text/xml');
  assert.equal(xml.getElementsByTagName('parsererror').length, 0);
  const paragraphs = elements(xml, 'p');
  // Title paragraph + line 1 source + line 1 translation + blank paragraph = 4
  assert.equal(paragraphs.length, 4);
  assert.ok(elements(paragraphs[1], 'keepNext').length >= 1, 'source paragraph keeps next translation paragraph attached');
  const transText = elements(paragraphs[2], 't').map(n => n.textContent).join('');
  assert.equal(transText, '佐藤：去学校测试');
  assert.equal(rawXml.includes('\u0007'), false);
});

test('Word export embeds cover image cleanly and round-trips body text via importDocx', async () => {
  const line = {
    id: 'cover-body',
    rawText: '未来',
    cleanText: '未来',
    tokens: [{ surface: '未来', ruby: 'みらい', hasKanji: true }],
  };
  const blob = await buildDocxBlob([line], { title: '封面测试', cover: TINY_PNG_DATA_URL });
  const bytes = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  const mediaFiles = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !zip.files[name].dir);
  assert.equal(mediaFiles.length, 1, 'cover image should be embedded in word/media/');

  const originalDomParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  try {
    const imported = await importDocx(bytes);
    assert.equal(imported.text, '未来');
    assert.equal(imported.overrides.length, 1);
    assert.equal(imported.overrides[0].reading, 'みらい');
  } finally {
    globalThis.DOMParser = originalDomParser;
  }
});
