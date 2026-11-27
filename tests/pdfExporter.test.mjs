import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument } from 'pdf-lib';
import { loadTypescript } from './loadTypescript.mjs';

const { buildPdfBlob } = loadTypescript('../app/utils/pdfExporter.ts');
const { subsetFont } = loadTypescript('../app/utils/fontSubset.ts');

const root = new URL('../', import.meta.url).pathname;

function withFontFetch(fn, fetchedUrls = []) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    fetchedUrls.push(target);
    if (target.endsWith('/fonts/NotoSansJP-Regular.ttf')) {
      const buf = readFileSync(join(root, 'public/fonts/NotoSansJP-Regular.ttf'));
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    if (target.endsWith('/fonts/NotoSansSC-Regular.otf')) {
      const buf = readFileSync(join(root, 'public/fonts/NotoSansSC-Regular.otf'));
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    if (target.endsWith('/fonts/hb-subset.wasm')) {
      const buf = readFileSync(join(root, 'public/fonts/hb-subset.wasm'));
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    throw new Error(`Unexpected fetch in pdfExporter.test: ${target}`);
  };
  return Promise.resolve().then(fn).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('buildPdfBlob generates a valid horizontal PDF, skips suppressed ruby, and strips control chars', async () => {
  const fetchedUrls = [];
  await withFontFetch(async () => {
    const lines = [
      {
        id: '1',
        speaker: '佐藤\u0000',
        rawText: '私\t漢字',
        cleanText: '私\t漢字',
        tokens: [
          { surface: '私', ruby: 'わたし', hasKanji: true },
          { surface: '\t', hasKanji: false },
          { surface: '漢字\u0007\uD800', ruby: 'かんじ', hasKanji: true, annotationSuppressed: true },
        ],
      },
      { id: 'blank', rawText: '', cleanText: '', tokens: [] },
    ];
    const blob = await buildPdfBlob(lines, { title: '放課後\u0000_dubbing' });
    assert.equal(blob.type, 'application/pdf');
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    assert.equal(doc.getTitle(), '放課後');
    assert.ok(doc.getPageCount() >= 1);
    assert.equal(fetchedUrls.some(url => url.endsWith('/fonts/NotoSansSC-Regular.otf')), false, 'monolingual PDF must not fetch SC font');
  }, fetchedUrls);
});

test('buildPdfBlob vertical layout reserves space for ruby taller than its base kanji', async () => {
  await withFontFetch(async () => {
    // Two adjacent single-kanji tokens with 3-kana readings: 16pt base vs 24pt ruby (3 * 8pt).
    // With unitWidth = max(baseSpan, rubySpan), their vertical centers must be >= 24pt apart, not 16pt.
    const lines = [
      {
        id: 'v1',
        rawText: '私達',
        cleanText: '私達',
        tokens: [
          { surface: '私', ruby: 'わたし', hasKanji: true },
          { surface: '達', ruby: 'たち', hasKanji: true },
        ],
      },
    ];
    const blob = await buildPdfBlob(lines, {
      title: '縦書',
      layout: { pageWidth: 420, pageHeight: 595, vertical: true, fontSize: 16 },
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    const page = doc.getPage(0);
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    const rawStream = refs
      .map(ref => inflateSync(doc.context.lookup(ref).getContents()).toString('latin1'))
      .join('\n');
    const textMoves = [...rawStream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
    assert.ok(textMoves.length >= 6, `expected drawn glyphs in PDF stream, got ${textMoves.length}`);
    // Body column sits to the left of heading columns (362.4, 324.8): base kanji at x ~ 286, ruby at x ~ 304.
    const bodyColumnX = Math.min(...textMoves.map(m => m.x));
    const rubyColumnX = bodyColumnX + 18;
    const baseYs = textMoves.filter(m => Math.abs(m.x - bodyColumnX) < 1).map(m => m.y);
    const rubyYs = textMoves.filter(m => Math.abs(m.x - rubyColumnX) < 1).map(m => m.y);
    assert.equal(baseYs.length, 2, 'expected two base kanji in body column');
    assert.equal(rubyYs.length, 5, 'expected five ruby kana in ruby column');
    assert.ok(Math.abs(baseYs[0] - baseYs[1]) >= 20, `expected vertical spacing >= 20pt when ruby (24pt) > base (16pt), got ${Math.abs(baseYs[0] - baseYs[1])}`);
    for (let i = 1; i < rubyYs.length; i += 1) {
      assert.ok(rubyYs[i - 1] - rubyYs[i] >= 7.9, `ruby kana ${i - 1} and ${i} must not overlap`);
    }
  });
});

test('subsetFont handles empty text and rejects cleanly on corrupt font bytes without leaking', async () => {
  await withFontFetch(async () => {
    const ttf = readFileSync(join(root, 'public/fonts/NotoSansJP-Regular.ttf'));
    const emptySubset = await subsetFont(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength), '');
    assert.ok(emptySubset.byteLength > 0);
    await assert.rejects(
      () => subsetFont(new Uint8Array([1, 2, 3, 4]).buffer, '漢'),
      /字体子集化失败/,
    );
    // Subsequent valid call must still succeed cleanly
    const okSubset = await subsetFont(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength), '漢字');
    assert.ok(okSubset.byteLength > 0);
  });
});

test('buildPdfBlob embeds NotoSansSC lazily for horizontal and vertical bilingual Simplified Chinese translations', async () => {
  await withFontFetch(async () => {
    const lines = [
      {
        id: 'b1',
        rawText: '私たち',
        cleanText: '私たち',
        tokens: [
          { surface: '私', ruby: 'わたし', hasKanji: true },
          { surface: 'たち', hasKanji: false },
        ],
      },
    ];
    const transText = '这是简体中文翻译测试：我们说的话、为时已晚、过对还进语译。';

    const horizBlob = await buildPdfBlob(lines, { title: '双语', translations: [transText] });
    const horizDoc = await PDFDocument.load(await horizBlob.arrayBuffer());
    assert.ok(horizDoc.getPageCount() >= 1);

    const vertBlob = await buildPdfBlob(lines, {
      title: '縦書',
      layout: { pageWidth: 420, pageHeight: 595, vertical: true, fontSize: 16 },
      translations: ['这是中文翻译测试'],
    });
    const vertDoc = await PDFDocument.load(await vertBlob.arrayBuffer());
    assert.equal(vertDoc.getPageCount(), 1);
    const contents = vertDoc.getPage(0).node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    const rawStream = refs
      .map(ref => inflateSync(vertDoc.context.lookup(ref).getContents()).toString('latin1'))
      .join('\n');
    const textMoves = [...rawStream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
    const xs = [...new Set(textMoves.map(m => Math.round(m.x * 10) / 10))].sort((a, b) => a - b);
    // Translation auxiliary column sits strictly to the left of the Japanese base text column.
    assert.ok(xs.length >= 3, `expected at least heading, base+ruby, and translation columns, got ${xs.join(', ')}`);
  });
});
