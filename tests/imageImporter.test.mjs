import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { sortImageFilesNaturally, recognizeImageToText, importImagesAsBook } = loadTypescript('../app/utils/imageImporter.ts');
const { detectBookFormat } = loadTypescript('../app/utils/bookImport.ts');

test('sortImageFilesNaturally orders numbered pages numerically regardless of zero padding', () => {
  const names = ['page_10.png', 'page_2.png', 'page_1.png', 'page_20.png'];
  const files = names.map(name => new File(['x'], name, { type: 'image/png' }));
  const sorted = sortImageFilesNaturally(files);
  assert.deepEqual(sorted.map(f => f.name), ['page_1.png', 'page_2.png', 'page_10.png', 'page_20.png']);
});

test('detectBookFormat detects PNG, JPEG, WEBP, GIF, and BMP by MIME and magic bytes', async () => {
  const samples = [
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
    ['jpg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
    ['gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]],
    ['bmp', [0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ];
  for (const [label, bytes] of samples) {
    // No extension and generic MIME simulates Android content:// URIs
    const blobless = new File([new Uint8Array(bytes)], 'content:1234', { type: '' });
    assert.equal(await detectBookFormat(blobless), 'image', `magic detection failed for ${label}`);
  }
  const byExt = new File(['abc'], 'scan.PNG', { type: '' });
  assert.equal(await detectBookFormat(byExt), 'image');
});

test('recognizeImageToText & importImagesAsBook reconstruct ordered pages, pageStarts, and chapters via recognizePage seam', async () => {
  const f2 = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'novel_page2.png', { type: 'image/png' });
  const f1 = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'novel_page1.png', { type: 'image/png' });

  const single = await recognizeImageToText(f1, {
    recognizePage: async () => ({
      pageIndex: 0,
      pageWidth: 800,
      pageHeight: 1200,
      engineUsed: 'ndlocr-lite',
      elapsedMs: 12,
      warnings: [],
      boxes: [
        { x: 600, y: 100, width: 30, height: 300, text: 'これはテストです。', confidence: 0.95, role: 'main', vertical: true },
      ],
    }),
  });
  assert.equal(single.text, 'これはテストです。');
  assert.equal(single.defaultWritingMode, 'vertical');

  const progressLog = [];
  const book = await importImagesAsBook([f2, f1], {
    onProgress: p => progressLog.push(p),
    recognizePage: async ({ pageIndex }) => ({
      pageIndex,
      pageWidth: 800,
      pageHeight: 1200,
      engineUsed: 'ndlocr-lite',
      elapsedMs: 15,
      warnings: [],
      boxes: pageIndex === 0
        ? [
            { x: 100, y: 100, width: 300, height: 40, text: '第一章　朝', confidence: 0.96, role: 'title', vertical: false },
            { x: 100, y: 200, width: 500, height: 24, text: '朝日が昇る。', confidence: 0.95, role: 'main', vertical: false },
          ]
        : [
            { x: 100, y: 100, width: 300, height: 40, text: '第二章　夜', confidence: 0.96, role: 'title', vertical: false },
            { x: 100, y: 200, width: 500, height: 24, text: '月が輝く。', confidence: 0.95, role: 'main', vertical: false },
          ],
    }),
  });

  assert.equal(book.title, 'novel_page1');
  assert.deepEqual(book.text.split('\n'), ['第一章　朝', '朝日が昇る。', '第二章　夜', '月が輝く。']);
  assert.deepEqual(book.pageStarts, [0, 2]);
  assert.deepEqual(book.chapters.map(c => c.title), ['第一章　朝', '第二章　夜']);
  assert.ok(progressLog.some(p => p.stage === 'ocr' && p.current === 1 && p.total === 2));
});
