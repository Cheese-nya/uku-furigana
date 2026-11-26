import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { reviewReadings, applyReadingReviewResults } = loadTypescript('../app/utils/aiReadingReview.ts');
const { checkLine } = loadTypescript('../app/utils/readingCheck.ts');
const { parseCompoundToTokens } = loadTypescript('../app/utils/furigana.ts');

const llm = {
  baseUrl: 'https://api.example.com/v1/',
  model: 'test-model',
  apiKey: 'sk-test',
  provider: 'custom',
};

function llmReply(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withFakeFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), init, body });
    return handler({ url: String(url), init, body }, calls.length);
  };
  fakeFetch.calls = calls;
  globalThis.fetch = fakeFetch;
  return Promise.resolve()
    .then(() => fn(fakeFetch))
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test('reviewReadings applies valid choice, ignores invalid choice, and strips think tags and fences', async () => {
  const lines = [
    {
      id: 'line-0',
      rawText: 'このカレーは辛い。',
      cleanText: 'このカレーは辛い。',
      isAction: false,
      tokens: [
        { surface: 'このカレーは', hasKanji: false },
        {
          surface: '辛い',
          ruby: 'つらい',
          hasKanji: true,
          needsReview: true,
          readingSource: 'automatic',
          alternatives: ['ツライ', 'カライ'],
        },
        { surface: '。', hasKanji: false },
      ],
    },
    {
      id: 'line-1',
      rawText: '明日行く。',
      cleanText: '明日行く。',
      isAction: false,
      tokens: [
        {
          surface: '明日',
          ruby: 'あした',
          hasKanji: true,
          needsReview: true,
          readingSource: 'automatic',
          alternatives: ['アシタ', 'アス', 'ミョウニチ'],
        },
        {
          // Not eligible: needsReview is false
          surface: '行く',
          ruby: 'いく',
          hasKanji: true,
          needsReview: false,
          readingSource: 'automatic',
          alternatives: ['イク', 'ユク'],
        },
        {
          // Not eligible: readingSource is not 'automatic'
          surface: '方',
          ruby: 'かた',
          hasKanji: true,
          needsReview: true,
          readingSource: 'glossary',
          alternatives: ['カタ', 'ホウ'],
        },
      ],
    },
  ];

  await withFakeFetch(
    () =>
      llmReply(
        '<think>\nContext 0 is curry, so からい.\n</think>\n```json\n{"0": "からい", "1": "きのう"}\n```',
      ),
    async fakeFetch => {
      const results = await reviewReadings(lines, llm);

      assert.equal(fakeFetch.calls.length, 1);
      assert.equal(fakeFetch.calls[0].url, 'https://api.example.com/v1/chat/completions');

      const userPayload = JSON.parse(fakeFetch.calls[0].body.messages[1].content);
      assert.deepEqual(userPayload, [
        {
          id: '0',
          sentence: 'このカレーは辛い。',
          word: '辛い',
          options: ['つらい', 'からい'],
        },
        {
          id: '1',
          sentence: '明日行く。',
          word: '明日',
          options: ['あした', 'あす', 'みょうにち'],
        },
      ]);

      // Valid choice ("からい") is returned; invalid choice ("きのう" not in options) is ignored.
      assert.deepEqual(results, [
        {
          lineIndex: 0,
          tokenIndex: 1,
          reading: 'からい',
        },
      ]);
    },
  );
});

test('reviewReadings handles checkLine-split okurigana words, deduplicates identical sentences, and applies word-level updates', async () => {
  const splitLine = (id, text, surface, reading, tableEntries) => {
    const tokens = parseCompoundToTokens(surface, reading);
    return checkLine({ id, rawText: text, cleanText: text, tokens }, new Map(Object.entries(tableEntries)));
  };
  const lines = [
    splitLine('0', '食べる', '食べる', 'たべる', { 食べる: ['くべる'] }),
    splitLine('1', '食べる', '食べる', 'たべる', { 食べる: ['くべる'] }),
    splitLine('2', '取り戻す', '取り戻す', 'とりもどす', { 取り戻す: ['とりかえす'] }),
  ];

  await withFakeFetch(
    () => llmReply(JSON.stringify({ '0': 'くべる', '1': 'とりかえす' })),
    async fakeFetch => {
      const results = await reviewReadings(lines, llm);
      assert.equal(fakeFetch.calls.length, 1);
      const sent = JSON.parse(fakeFetch.calls[0].body.messages[1].content);
      // Duplicate identical line ('食べる') is deduplicated into one candidate, and multi-kanji '取り戻す' is sent once as the full word.
      assert.deepEqual(sent, [
        { id: '0', sentence: '食べる', word: '食べる', options: ['たべる', 'くべる'] },
        { id: '1', sentence: '取り戻す', word: '取り戻す', options: ['とりもどす', 'とりかえす'] },
      ]);
      assert.deepEqual(results, [
        { lineIndex: 0, tokenIndex: 0, reading: 'くべる' },
        { lineIndex: 1, tokenIndex: 0, reading: 'くべる' },
        { lineIndex: 2, tokenIndex: 0, reading: 'とりかえす' },
      ]);

      const updated = applyReadingReviewResults(lines, results, 'hiragana');
      assert.deepEqual(updated[0].tokens.map(t => [t.surface, t.ruby, Boolean(t.needsReview)]), [['食', 'く', false], ['べる', undefined, false]]);
      assert.equal(updated[0].tokens[0].word.reading, 'くべる');
      assert.deepEqual(updated[2].tokens.map(t => [t.surface, t.ruby, Boolean(t.needsReview)]), [['取', 'と', false], ['り', undefined, false], ['戻', 'かえ', false], ['す', undefined, false]]);
      assert.equal(updated[2].tokens[0].word.reading, 'とりかえす');
    },
  );
});

test('reviewReadings supports romaji options without mangling ASCII and preserves earlier batches if a later batch fails', async () => {
  const mkLine = (id, surface, reading, alternatives) => ({
    id,
    rawText: surface,
    cleanText: surface,
    tokens: [{
      surface,
      ruby: reading,
      hasKanji: true,
      needsReview: true,
      readingSource: 'automatic',
      alternatives,
      word: { surface, reading, alternatives, offset: 0 },
    }],
  });
  const lines = Array.from({ length: 31 }, (_, i) =>
    mkLine(String(i), `今日${i}`, 'kyou', ['kyou', 'konnichi']),
  );

  await withFakeFetch(
    (_req, callNumber) => {
      if (callNumber === 1) {
        const reply = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), 'konnichi']));
        return llmReply(JSON.stringify(reply));
      }
      return new Response('rate limited', { status: 429 });
    },
    async () => {
      const results = await reviewReadings(lines, llm);
      assert.equal(results.length, 30);
      const updated = applyReadingReviewResults(lines, results, 'romaji');
      assert.equal(updated[0].tokens[0].ruby, 'konnichi');
      assert.equal(updated[0].tokens[0].word.reading, 'konnichi');
      assert.equal(updated[0].tokens[0].needsReview, false);
    },
  );
});
