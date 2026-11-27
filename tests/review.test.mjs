import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { readingContext, normalizeReading, uniqueReadings, selectReviewWord, collectReviewGroups, makeLearnedReading, learnedOverrides } = loadTypescript('../app/utils/review.ts');
const { annotateLine } = loadTypescript('../app/utils/furigana.ts');
const { initKuromoji } = loadTypescript('../app/utils/kuromojiEngine.ts');

await initKuromoji('./public/dict');

test('readingContext extracts clause boundary around target', () => {
  const text = '失恋は辛いですが、カレーは辛い。';
  const c1 = readingContext(text, 3, 2); // 辛い after 失恋は
  assert.equal(c1.before, '失恋は');
  assert.equal(c1.after, 'ですが、カレーは辛い');

  const c2 = readingContext(text, 13, 2); // 辛い before 。
  assert.equal(c2.before, '失恋は辛いですが、カレーは');
  assert.equal(c2.after, '');
});

test('normalizeReading and uniqueReadings normalize and deduplicate kana', () => {
  assert.equal(normalizeReading('カライ'), 'からい');
  assert.equal(normalizeReading(' からい '), 'からい');
  assert.deepEqual(uniqueReadings(['からい', 'カライ', 'つらい', 'ツライ']), ['からい', 'つらい']);
});

test('selectReviewWord recovers intact word across okurigana and kanji tokens', () => {
  const line = annotateLine('辛いラーメン', 'hiragana');
  const selection = selectReviewWord(line, 0);
  assert.equal(selection.surface, '辛い');
  assert.ok(selection.alternatives.includes('からい'));
  assert.ok(selection.alternatives.includes('つらい'));
});

test('collectReviewGroups groups reviewable occurrences with same context and alternatives', () => {
  const line1 = annotateLine('辛いラーメン', 'hiragana');
  const line2 = annotateLine('辛いラーメン', 'hiragana');
  line1.id = '0';
  line2.id = '1';
  const groups = collectReviewGroups([line1, line2]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences.length, 2);
});

test('learnedOverrides produces overrides for matching context only', () => {
  const line1 = annotateLine('辛いラーメン', 'hiragana');
  line1.id = '0';
  const sel1 = selectReviewWord(line1, 0);
  const learned = makeLearnedReading(sel1, 'からい', 'hiragana');

  // Match line with same context
  const targetLine1 = annotateLine('辛いラーメン', 'hiragana');
  targetLine1.id = '1';
  const overrides1 = learnedOverrides(targetLine1, [learned], 'hiragana');
  assert.equal(overrides1.length, 1);
  assert.equal(overrides1[0].reading, 'からい');

  // Do not match line with different context
  const targetLine2 = annotateLine('失恋は辛い', 'hiragana');
  targetLine2.id = '2';
  const overrides2 = learnedOverrides(targetLine2, [learned], 'hiragana');
  assert.equal(overrides2.length, 0);
});

test('needsReview excludes ai-reviewed tokens', () => {
  const { needsReview } = loadTypescript('../app/utils/review.ts');
  assert.equal(needsReview({ surface: '辛い', ruby: 'からい', hasKanji: true, readingSource: 'ai', alternatives: ['からい', 'つらい'], needsReview: true }), false);
});
