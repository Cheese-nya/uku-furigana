import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { glossaryOverrides, applyGlossary } = loadTypescript('../app/utils/glossary.ts');

const entry = (surface, reading, type = 'hiragana') => ({ surface, reading, type, createdAt: 1 });
const line = (cleanText, surfaces, extra = {}) => ({
  id: 'line-1',
  rawText: cleanText,
  cleanText,
  tokens: surfaces.map(surface => ({ surface, hasKanji: /[\u4E00-\u9FFF]/.test(surface) })),
  ...extra,
});

test('glossaryOverrides returns nothing for empty input', () => {
  assert.deepEqual(glossaryOverrides('', [entry('東京', 'とうきょう')]), []);
  assert.deepEqual(glossaryOverrides('本文', []), []);
  assert.deepEqual(glossaryOverrides('', []), []);
});

test('glossaryOverrides records line, offset, surface, reading and type', () => {
  assert.deepEqual(glossaryOverrides('東京に行く', [entry('東京', 'とうきょう')]), [
    { line: '東京に行く', start: 0, surface: '東京', reading: 'とうきょう', type: 'hiragana' },
  ]);
  assert.deepEqual(glossaryOverrides('私は東京に行く', [entry('東京', 'とうきょう', 'katakana')]), [
    { line: '私は東京に行く', start: 2, surface: '東京', reading: 'とうきょう', type: 'katakana' },
  ]);
});

test('glossaryOverrides reports every non-overlapping occurrence', () => {
  const result = glossaryOverrides('東京と東京', [entry('東京', 'とうきょう')]);
  assert.deepEqual(result.map(({ start, surface }) => [start, surface]), [[0, '東京'], [3, '東京']]);
});

test('glossaryOverrides prefers the longest surface at the same offset', () => {
  const entries = [entry('東京都', 'とうきょうと'), entry('東京', 'とうきょう')];
  assert.deepEqual(glossaryOverrides('東京都に住む', entries).map(({ surface, start }) => [surface, start]), [['東京都', 0]]);

  // Sorting must not depend on the caller's array order.
  const reversed = [...entries].reverse();
  assert.deepEqual(glossaryOverrides('東京都に住む', reversed).map(({ surface }) => surface), ['東京都']);
  // The caller's array is left untouched.
  assert.deepEqual(reversed.map(({ surface }) => surface), ['東京', '東京都']);
});

test('glossaryOverrides consumes a match instead of overlapping it', () => {
  // 'ああ' at 0 wins; the second 'あ' at 1 is inside the consumed range.
  assert.deepEqual(glossaryOverrides('あああ', [entry('ああ', 'ああ')]).map(({ start }) => start), [0]);
  assert.deepEqual(glossaryOverrides('ABC', [entry('AB', 'ab'), entry('BC', 'bc')]).map(({ surface }) => surface), ['AB']);
  assert.deepEqual(glossaryOverrides('ABC', [entry('BC', 'bc')]).map(({ start }) => start), [1]);
});

test('glossaryOverrides skips entries with an empty surface or no match', () => {
  assert.deepEqual(glossaryOverrides('東京', [entry('', 'とうきょう')]), []);
  assert.deepEqual(glossaryOverrides('東京', [entry('大阪', 'おおさか')]), []);
  assert.deepEqual(glossaryOverrides('東京', [entry('東京', 'とうきょう'), entry('', 'から')]), [
    { line: '東京', start: 0, surface: '東京', reading: 'とうきょう', type: 'hiragana' },
  ]);
});

test('glossaryOverrides counts offsets in UTF-16 code units', () => {
  // U+20BB7 is a surrogate pair, so the CJK extension character costs two offsets.
  const text = '𠮷東京';
  assert.equal(text.length, 4);
  assert.deepEqual(glossaryOverrides(text, [entry('東京', 'とうきょう')]).map(({ start }) => start), [2]);
});

test('applyGlossary leaves an unlisted line untouched', () => {
  const input = line('東京に行く', ['東京', 'に', '行', 'く']);
  const result = applyGlossary(input, [], 'hiragana');
  assert.notEqual(result, input);
  assert.equal(result.cleanText, '東京に行く');
  assert.deepEqual(result.tokens, input.tokens);
  assert.equal(result.id, 'line-1');
});

test('applyGlossary annotates a whole-token match as a glossary reading', () => {
  const result = applyGlossary(line('東京に行く', ['東京', 'に', '行', 'く']), [entry('東京', 'とうきょう')], 'hiragana');
  assert.deepEqual(result.tokens.map(({ surface, ruby }) => [surface, ruby]), [
    ['東京', 'とうきょう'], ['に', undefined], ['行', undefined], ['く', undefined],
  ]);
  assert.equal(result.tokens[0].readingSource, 'glossary');
  assert.equal(result.tokens[0].needsReview, false);
  assert.equal(result.tokens[0].hasKanji, true);
});

test('applyGlossary formats the reading with the requested ruby type', () => {
  const katakana = applyGlossary(line('東京', ['東京']), [entry('東京', 'とうきょう')], 'katakana');
  assert.equal(katakana.tokens[0].ruby, 'トウキョウ');
  const romaji = applyGlossary(line('東京', ['東京']), [entry('東京', 'とうきょう')], 'romaji');
  assert.equal(romaji.tokens[0].ruby, 'toukyou');
  // Katakana readings are normalized to hiragana first.
  const fromKatakana = applyGlossary(line('東京', ['東京']), [entry('東京', 'トウキョウ')], 'hiragana');
  assert.equal(fromKatakana.tokens[0].ruby, 'とうきょう');
});

test('applyGlossary passes a romaji-typed reading through unformatted', () => {
  const result = applyGlossary(line('東京', ['東京']), [entry('東京', 'toukyou', 'romaji')], 'katakana');
  assert.equal(result.tokens[0].ruby, 'toukyou');
  assert.equal(result.tokens[0].readingSource, 'glossary');
});

test('applyGlossary splits a match that spans several tokens', () => {
  const result = applyGlossary(line('東京都', ['東京', '都']), [entry('東京都', 'とうきょうと')], 'hiragana');
  assert.deepEqual(result.tokens.map(({ surface, ruby }) => [surface, ruby]), [['東京都', 'とうきょうと']]);
});

test('applyGlossary splits the tokens around a partial match', () => {
  const result = applyGlossary(line('東京都に行く', ['東京都', 'に', '行', 'く']), [entry('京都', 'きょうと')], 'hiragana');
  assert.deepEqual(result.tokens.map(({ surface, ruby }) => [surface, ruby]), [
    ['東', undefined], ['京都', 'きょうと'], ['に', undefined], ['行', undefined], ['く', undefined],
  ]);
  assert.equal(result.tokens[0].hasKanji, true);
  assert.equal(result.tokens[2].readingSource, undefined);
});

test('applyGlossary splits a single token into head, match and tail', () => {
  const result = applyGlossary(line('お東京さん', ['お東京さん']), [entry('東京', 'とうきょう')], 'hiragana');
  assert.deepEqual(result.tokens.map(({ surface, ruby }) => [surface, ruby]), [
    ['お', undefined], ['東京', 'とうきょう'], ['さん', undefined],
  ]);
  assert.equal(result.tokens[0].hasKanji, false);
  assert.equal(result.tokens[2].hasKanji, false);
});

test('applyGlossary suppresses annotation for an empty reading', () => {
  const result = applyGlossary(line('東京', ['東京']), [entry('東京', '')], 'hiragana');
  assert.equal(result.tokens.length, 1);
  assert.equal(result.tokens[0].surface, '東京');
  assert.equal(result.tokens[0].ruby, undefined);
  assert.equal(result.tokens[0].annotationSuppressed, true);
});

test('applyGlossary ignores a glossary entry that does not match the line text', () => {
  // glossaryOverrides builds offsets from the same cleanText, so this only guards
  // the defensive slice check inside applyRubyOverrides.
  const input = line('東京', ['東京']);
  const result = applyGlossary(input, [entry('大阪', 'おおさか')], 'hiragana');
  assert.deepEqual(result.tokens, input.tokens);
});

test('applyGlossary applies several glossary entries in one pass', () => {
  const result = applyGlossary(
    line('東京で大阪に行く', ['東京', 'で', '大阪', 'に', '行', 'く']),
    [entry('東京', 'とうきょう'), entry('大阪', 'おおさか')],
    'hiragana',
  );
  assert.deepEqual(result.tokens.map(({ surface, ruby }) => [surface, ruby]), [
    ['東京', 'とうきょう'], ['で', undefined], ['大阪', 'おおさか'], ['に', undefined], ['行', undefined], ['く', undefined],
  ]);
});

test('applyGlossary keeps the original line object intact', () => {
  const input = line('東京', ['東京']);
  const snapshot = JSON.parse(JSON.stringify(input));
  applyGlossary(input, [entry('東京', 'とうきょう')], 'hiragana');
  assert.deepEqual(input, snapshot);
});

// Reviewed: no word-boundary check by design - Japanese has no delimiter between words,
// so literal longest-match against the line text is the agreed rule.
// Reviewed: a romaji-typed entry passes through verbatim by design - there is no
// romaji-to-kana conversion, so the requested ruby type cannot be applied to it.

test('glossaryOverrides handles large multi-bucket glossaries with shared prefixes deterministically', () => {
  const entries = [
    ...Array.from({ length: 120 }, (_, i) => entry(`固有名詞${i}`, `こゆうめいし${i}`)),
    entry('東京', 'とうきょう'),
    entry('東京都', 'とうきょうと'),
    entry('東京都庁', 'とうきょうとちょう'),
  ];
  const result = glossaryOverrides('東京都庁と東京と固有名詞42', entries);
  assert.deepEqual(
    result.map(({ surface, start }) => [surface, start]),
    [['東京都庁', 0], ['東京', 5], ['固有名詞42', 8]],
  );
});
