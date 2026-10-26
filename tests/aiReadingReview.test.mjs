import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { reviewReadings } = loadTypescript('../app/utils/aiReadingReview.ts');

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
