import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  countCachedExportTranslations,
  DEFAULT_EXPORT_TRANSLATION_PREFS,
  extractLineSentences,
  isExportSkippableLine,
  loadExportTranslationPrefs,
  resolveExportTranslations,
  saveExportTranslationPrefs,
  validateExportTranslationPrefs,
} = loadTypescript('../app/utils/exportTranslations.ts');
const { DEFAULT_TRANSLATION_SETTINGS, TranslationError, translationCacheKey } = loadTypescript('../app/utils/translation.ts');
const { MemoryTranslationStore } = loadTypescript('../app/utils/translationStore.ts');

function line(id, rawText, speaker) {
  return {
    id,
    speaker,
    rawText,
    cleanText: rawText,
    tokens: [{ surface: rawText, hasKanji: false }],
  };
}

test('export translation prefs validate, persist, and recover from malformed data', () => {
  const originalStorage = globalThis.localStorage;
  const backing = new Map();
  globalThis.localStorage = {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, String(value)); },
  };
  try {
    assert.deepEqual(loadExportTranslationPrefs(), DEFAULT_EXPORT_TRANSLATION_PREFS);
    saveExportTranslationPrefs({ enabled: true, missingPolicy: 'cached-only' });
    assert.deepEqual(loadExportTranslationPrefs(), { enabled: true, missingPolicy: 'cached-only' });
    backing.set('uku-export-translation-prefs-v1', '{bad-json');
    assert.deepEqual(loadExportTranslationPrefs(), DEFAULT_EXPORT_TRANSLATION_PREFS);
    assert.deepEqual(validateExportTranslationPrefs({ enabled: 'yes', missingPolicy: 'other' }), DEFAULT_EXPORT_TRANSLATION_PREFS);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test('extractLineSentences skips blanks, dividers, images, and punctuation-only lines', () => {
  assert.equal(isExportSkippableLine('   '), true);
  assert.equal(isExportSkippableLine('---'), true);
  assert.equal(isExportSkippableLine('￼img-1'), true);
  assert.equal(isExportSkippableLine('「……！」'), true);
  assert.deepEqual(extractLineSentences(line('div', '———')), []);
  assert.deepEqual(extractLineSentences(line('img', '￼img-2')), []);
  assert.deepEqual(extractLineSentences(line('multi', 'おはよう。今日もいい天気！')), ['おはよう。', '今日もいい天気！']);
});

test('resolveExportTranslations reuses Reader cache, translates missing sentences, writes back, and honours cached-only', async () => {
  const store = new MemoryTranslationStore();
  const settings = { ...DEFAULT_TRANSLATION_SETTINGS, engine: 'microsoft', target: 'zh-Hans' };
  const slot = translationCacheKey(settings);
  await store.put('book-1', slot, 'microsoft', [['おはよう。', '早上好。']]);

  const lines = [
    line('1', 'おはよう。今日もいい天気！'),
    line('blank', ''),
    line('div', '---'),
    line('2', '学校へ行く。'),
  ];

  const summary = await countCachedExportTranslations(lines, { bookId: 'book-1', settings, store });
  assert.deepEqual(summary, { totalSentences: 3, cachedSentences: 1, missingSentences: 2 });

  // cached-only must make zero network calls
  const cachedOnly = await resolveExportTranslations(lines, {
    bookId: 'book-1',
    missingPolicy: 'cached-only',
    settings,
    store,
    fetchImpl: async () => { throw new Error('network should not be called in cached-only'); },
  });
  assert.equal(cachedOnly.cachedCount, 1);
  assert.equal(cachedOnly.translatedCount, 0);
  assert.equal(cachedOnly.missingCount, 2);
  assert.deepEqual(cachedOnly.translations, ['早上好。', undefined, undefined, undefined]);

  // translate-missing translates only uncached sentences and writes back to TranslationStore
  const sentToApi = [];
  const progressEvents = [];
  const dict = {
    '今日もいい天気！': '今天天气也真好！',
    '学校へ行く。': '去学校。',
  };
  const auto = await resolveExportTranslations(lines, {
    bookId: 'book-1',
    missingPolicy: 'translate-missing',
    settings,
    store,
    onProgress: p => progressEvents.push(p),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      sentToApi.push(...body);
      return new Response(JSON.stringify(body.map(item => ({ translations: [{ text: dict[item] || `TR:${item}` }] }))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.deepEqual(sentToApi, ['今日もいい天気！', '学校へ行く。']);
  assert.equal(auto.cachedCount, 1);
  assert.equal(auto.translatedCount, 2);
  assert.equal(auto.missingCount, 0);
  assert.deepEqual(auto.translations, ['早上好。今天天气也真好！', undefined, undefined, '去学校。']);
  assert.ok(progressEvents.length >= 2);
  assert.equal(progressEvents[progressEvents.length - 1].done, 3);

  // Confirm newly translated pairs were cached under the exact Reader key
  const persisted = await store.get('book-1', slot, ['今日もいい天気！', '学校へ行く。']);
  assert.equal(persisted.get('今日もいい天気！'), '今天天气也真好！');
  assert.equal(persisted.get('学校へ行く。'), '去学校。');
});

test('resolveExportTranslations joins English sentence translations with spaces', async () => {
  const store = new MemoryTranslationStore();
  const settings = { ...DEFAULT_TRANSLATION_SETTINGS, engine: 'microsoft', target: 'en' };
  const slot = translationCacheKey(settings);
  await store.put('b-en', slot, 'microsoft', [
    ['第一句。', 'First line.'],
    ['第二句。', 'Second line.'],
  ]);
  const res = await resolveExportTranslations([line('1', '第一句。第二句。')], {
    bookId: 'b-en',
    missingPolicy: 'cached-only',
    settings,
    store,
  });
  assert.deepEqual(res.translations, ['First line. Second line.']);
});

test('resolveExportTranslations supports AbortSignal cancellation and surfaces missing LLM API key', async () => {
  const store = new MemoryTranslationStore();
  const msSettings = { ...DEFAULT_TRANSLATION_SETTINGS, engine: 'microsoft', target: 'zh-Hans' };
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => resolveExportTranslations([line('1', 'テスト')], {
      bookId: 'b-abort',
      missingPolicy: 'translate-missing',
      settings: msSettings,
      store,
      signal: ac.signal,
    }),
    err => err instanceof Error && err.name === 'AbortError',
  );

  const llmSettings = {
    ...DEFAULT_TRANSLATION_SETTINGS,
    engine: 'llm',
    llm: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', provider: 'deepseek' },
  };
  await assert.rejects(
    () => resolveExportTranslations([line('1', 'テスト')], {
      bookId: 'b-nokey',
      missingPolicy: 'translate-missing',
      settings: llmSettings,
      store,
    }),
    err => err instanceof TranslationError && /API Key/.test(err.message),
  );
});

test('resolveExportTranslations preserves cached lines when a later chunk fails, unless nothing at all resolved', async () => {
  const store = new MemoryTranslationStore();
  const settings = { ...DEFAULT_TRANSLATION_SETTINGS, engine: 'microsoft', target: 'zh-Hans' };
  await store.put('b-partial', translationCacheKey(settings), 'microsoft', [['既訳。', '已译。']]);

  const partial = await resolveExportTranslations([line('1', '既訳。'), line('2', '未訳。')], {
    bookId: 'b-partial',
    missingPolicy: 'translate-missing',
    settings,
    store,
    fetchImpl: async () => new Response('down', { status: 400 }),
  });
  assert.equal(partial.cachedCount, 1);
  assert.equal(partial.missingCount, 1);
  assert.ok(partial.failedError);
  assert.deepEqual(partial.translations, ['已译。', undefined]);
});
