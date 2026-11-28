import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  detectPageWritingMode,
  filterRubyBoxes,
  orderReadingBoxes,
  reconstructOcrDocument,
} = loadTypescript('../app/utils/ocrLayout.ts');

test('detectPageWritingMode distinguishes tategaki vs horizontal pages', () => {
  const verticalBoxes = [
    { x: 400, y: 50, width: 32, height: 320, text: '今日は良い天気ですね。', confidence: 0.95, role: 'main', vertical: true },
    { x: 350, y: 50, width: 32, height: 300, text: '散歩に出かけましょう。', confidence: 0.95, role: 'main', vertical: true },
  ];
  const horizontalBoxes = [
    { x: 40, y: 80, width: 420, height: 28, text: '今日は良い天気ですね。', confidence: 0.95, role: 'main', vertical: false },
    { x: 40, y: 120, width: 400, height: 28, text: '散歩に出かけましょう。', confidence: 0.95, role: 'main', vertical: false },
  ];
  assert.equal(detectPageWritingMode(verticalBoxes), true);
  assert.equal(detectPageWritingMode(horizontalBoxes), false);
});

test('filterRubyBoxes strips semantic block_rubi and geometric furigana while keeping kana body lines', () => {
  // Vertical body columns at x=400 (width 36) and x=340 (width 36), plus geometric ruby right of x=400 (x=440, width 14)
  // and a normal kana body column at x=280 (width 36) which MUST be kept!
  const boxes = [
    { x: 400, y: 80, width: 36, height: 360, text: '漢字の読み方を学ぶ。', confidence: 0.96, role: 'main', vertical: true },
    { x: 440, y: 90, width: 14, height: 60, text: 'かんじ', confidence: 0.92, role: 'unknown', vertical: true },
    { x: 380, y: 90, width: 12, height: 48, text: 'よみかた', confidence: 0.91, role: 'ruby', vertical: true },
    { x: 280, y: 80, width: 36, height: 320, text: 'とてもたのしかったです。', confidence: 0.96, role: 'main', vertical: true },
    { x: 50, y: 760, width: 80, height: 20, text: 'イラスト', confidence: 0.9, role: 'figure', vertical: false },
  ];

  const filtered = filterRubyBoxes(boxes, true, true);
  assert.deepEqual(filtered.map(b => b.text), ['漢字の読み方を学ぶ。', 'とてもたのしかったです。']);

  // With filterRuby=false, semantic ruby & small geometric ruby stay, though figures still stay omitted
  const unfiltered = filterRubyBoxes(boxes, true, false);
  assert.equal(unfiltered.some(b => b.text === 'かんじ'), true);
  assert.equal(unfiltered.some(b => b.text === 'よみかた'), true);
  assert.equal(unfiltered.some(b => b.text === 'イラスト'), false);
});

test('orderReadingBoxes orders vertical columns right-to-left top-to-bottom via XY-Cut', () => {
  const boxes = [
    // Left column (lower right-to-left)
    { x: 100, y: 80, width: 34, height: 300, text: '三番目', confidence: 0.95, role: 'main', vertical: true },
    // Right column top-band & bottom-band split cleanly by XY-Cut
    { x: 500, y: 60, width: 34, height: 200, text: '一番目', confidence: 0.95, role: 'main', vertical: true },
    { x: 300, y: 60, width: 34, height: 200, text: '二番目', confidence: 0.95, role: 'main', vertical: true },
  ];
  const ordered = orderReadingBoxes(boxes, true);
  assert.deepEqual(ordered.map(b => b.text), ['一番目', '二番目', '三番目']);
});

test('reconstructOcrDocument merges lines, detects chapters, strips running heads, and computes pageStarts', () => {
  const makePage = (pageNum, boxes) => ({
    pageIndex: pageNum - 1,
    pageWidth: 1000,
    pageHeight: 1400,
    boxes,
    engineUsed: 'ndlocr-lite',
    elapsedMs: 120,
    warnings: [],
  });

  const pages = [
    makePage(1, [
      { x: 400, y: 30, width: 180, height: 18, text: '吾輩は猫である', confidence: 0.95, role: 'main', vertical: false }, // top running head
      { x: 80, y: 120, width: 400, height: 42, text: '第一章　はじまり', confidence: 0.96, role: 'title', vertical: false },
      { x: 80, y: 200, width: 700, height: 26, text: '吾輩は猫である。名前はまだ無い', confidence: 0.96, role: 'main', vertical: false },
      { x: 80, y: 240, width: 680, height: 26, text: 'どこで生れたかとんと見当がつかぬ。', confidence: 0.96, role: 'main', vertical: false },
      { x: 480, y: 1340, width: 40, height: 18, text: '1', confidence: 0.95, role: 'main', vertical: false }, // outer folio
    ]),
    makePage(2, [
      { x: 400, y: 30, width: 180, height: 18, text: '吾輩は猫である', confidence: 0.95, role: 'main', vertical: false },
      { x: 80, y: 200, width: 700, height: 26, text: '何でも薄暗いじめじめした所で', confidence: 0.95, role: 'main', vertical: false },
      { x: 80, y: 240, width: 600, height: 26, text: 'ニャーニャー泣いていた。', confidence: 0.95, role: 'main', vertical: false },
    ]),
    makePage(3, [
      { x: 400, y: 30, width: 180, height: 18, text: '吾輩は猫である', confidence: 0.95, role: 'main', vertical: false },
      { x: 80, y: 120, width: 400, height: 42, text: '第二章　主人', confidence: 0.96, role: 'title', vertical: false },
      { x: 80, y: 200, width: 700, height: 26, text: '主人はあまり口をきかない。', confidence: 0.96, role: 'main', vertical: false },
    ]),
  ];

  const doc = reconstructOcrDocument(pages, { filterRuby: true });
  const paras = doc.text.split('\n');
  assert.deepEqual(paras, [
    '第一章　はじまり',
    '吾輩は猫である。名前はまだ無いどこで生れたかとんと見当がつかぬ。',
    '何でも薄暗いじめじめした所でニャーニャー泣いていた。',
    '第二章　主人',
    '主人はあまり口をきかない。',
  ]);
  assert.equal(doc.defaultWritingMode, 'horizontal');
  assert.deepEqual(doc.pageStarts, [0, 2, 3]);
  assert.deepEqual(doc.chapters.map(c => [c.title, c.startLine]), [
    ['第一章　はじまり', 0],
    ['第二章　主人', 3],
  ]);
  assert.equal(doc.warnings.some(w => w.code === 'running-heads-removed' && w.count === 3), true);
  assert.equal(doc.warnings.some(w => w.code === 'ocr-recognized'), true);
});
