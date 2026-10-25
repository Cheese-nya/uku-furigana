import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const {
  DEFAULT_TRANSLATION_SETTINGS, Translator, TranslationError,
  loadTranslationSettings, saveTranslationSettings, translateLlm, translateMicrosoft, validateTranslationSettings,
} = loadTypescript('../app/utils/translation.ts');
const { MemoryTranslationStore, TranslationStore, defaultTranslationStore } = loadTypescript('../app/utils/translationStore.ts');

const settings = (overrides = {}) => ({ ...DEFAULT_TRANSLATION_SETTINGS, ...overrides });

function microsoftReply(texts, prefix = 'zh:') {
  return new Response(JSON.stringify(texts.map(text => ({ translations: [{ text: `${prefix}${text}`, to: 'zh-Hans' }] }))), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function llmReply(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function recordingFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), init, body });
    return handler({ url: String(url), init, body }, calls.length);
  };
  impl.calls = calls;
  return impl;
}

test('stores key rows by book, target and text', async () => {
  // The factory returning nothing makes the IndexedDB class use its in-memory floor, which is
  // also the fallback path a browser takes when the database cannot be opened.
  const noDatabase = new TranslationStore(() => undefined);
  for (const store of [new MemoryTranslationStore(), noDatabase, defaultTranslationStore()]) {
    await store.put('b1', 'zh-Hans', 'microsoft', [['文一。', 'zh1'], ['文二。', 'zh2']]);
    await store.put('b1', 'en', 'llm', [['文一。', 'en1']]);
    await store.put('b2', 'zh-Hans', 'microsoft', [['文一。', 'other book']]);
    // The same sentence overwrites its row instead of duplicating it.
    await store.put('b1', 'zh-Hans', 'microsoft', [['文一。', 'zh1 v2']]);
    assert.deepEqual(await store.get('b1', 'zh-Hans', ['文一。', '文二。', '文三。']), new Map([['文一。', 'zh1 v2'], ['文二。', 'zh2']]));
    assert.equal(await store.count('b1', 'zh-Hans', ['文一。', '文二。', '文三。']), 2);
    assert.equal(await store.count('b1', 'en', ['文一。']), 1);
    assert.deepEqual(await store.get('b1', 'zh-Hant', ['文一。']), new Map());
    assert.deepEqual(await store.get('b1', 'zh-Hans', []), new Map());
    await store.clearBook('b1');
    assert.equal(await store.count('b1', 'zh-Hans', ['文一。', '文二。']), 0);
    assert.equal(await store.count('b2', 'zh-Hans', ['文一。']), 1);
  }
});

test('Microsoft request shape and response mapping', async () => {
  const fetchImpl = recordingFetch(({ body }) => microsoftReply(body));
  const result = await translateMicrosoft(['おはよう。', 'こんばんは。'], 'zh-Hant', fetchImpl);
  assert.deepEqual(result, ['zh:おはよう。', 'zh:こんばんは。']);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://edge.microsoft.com/translate/translatetext?from=ja&to=zh-Hant&isEnterpriseClient=false');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(call.body, ['おはよう。', 'こんばんは。']);
  assert.deepEqual(await translateMicrosoft([], 'zh-Hans', fetchImpl), []);
});

test('Microsoft errors: 429/5xx retryable, 4xx not, malformed payload rejected', async () => {
  const rejecting = status => async () => new Response('nope', { status });
  await assert.rejects(translateMicrosoft(['文。'], 'zh-Hans', rejecting(429)), (error) => error instanceof TranslationError && error.retryable);
  await assert.rejects(translateMicrosoft(['文。'], 'zh-Hans', rejecting(503)), (error) => error instanceof TranslationError && error.retryable);
  await assert.rejects(translateMicrosoft(['文。'], 'zh-Hans', rejecting(400)), (error) => error instanceof TranslationError && !error.retryable);
  await assert.rejects(translateMicrosoft(['文。'], 'zh-Hans', async () => new Response('{}', { status: 200 })), TranslationError);
  await assert.rejects(translateMicrosoft(['a', 'b'], 'zh-Hans', async () => new Response(JSON.stringify([{ translations: [{ text: 'x' }] }]), { status: 200 })), TranslationError);
});

function installStorage(value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value });
  } catch {
    return undefined;
  }
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  };
}

test('settings validation falls back field by field', () => {
  assert.deepEqual(DEFAULT_TRANSLATION_SETTINGS, {
    engine: 'microsoft', target: 'zh-Hans',
    llm: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', provider: 'deepseek' },
    saved: {},
  });
  assert.deepEqual(validateTranslationSettings(undefined), DEFAULT_TRANSLATION_SETTINGS);
  assert.deepEqual(validateTranslationSettings('nope'), DEFAULT_TRANSLATION_SETTINGS);
  assert.deepEqual(validateTranslationSettings({ engine: 'bogus', target: 7, llm: 'x' }), DEFAULT_TRANSLATION_SETTINGS);
  // One bad field never discards its valid neighbours, and the key may be empty.
  assert.deepEqual(
    validateTranslationSettings({ engine: 'llm', target: 'en', llm: { baseUrl: 'https://x/v1/', model: '', apiKey: '' } }),
    { engine: 'llm', target: 'en', llm: { baseUrl: 'https://x/v1/', model: 'deepseek-chat', apiKey: '', provider: 'custom' }, saved: {} },
  );
  // Each platform keeps its own key and model.
  const withSaved = validateTranslationSettings({ llm: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'a:free', apiKey: 'k1' }, saved: { siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B', apiKey: 'k2' }, broken: 3 } });
  assert.equal(withSaved.llm.provider, 'openrouter');
  assert.deepEqual(Object.keys(withSaved.saved), ['siliconflow']);
  assert.equal(withSaved.saved.siliconflow.apiKey, 'k2');
});

test('settings round-trip through localStorage and survive a broken one', () => {
  const rows = new Map();
  const restore = installStorage({
    getItem: key => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => rows.set(key, String(value)),
  });
  if (!restore) return;
  try {
    assert.deepEqual(loadTranslationSettings(), DEFAULT_TRANSLATION_SETTINGS);
    const custom = { engine: 'llm', target: 'en', llm: { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', provider: 'custom' }, saved: {} };
    saveTranslationSettings(custom);
    assert.deepEqual(loadTranslationSettings(), custom);
    assert.ok(rows.has('uku-translation-settings-v1'));
    rows.set('uku-translation-settings-v1', JSON.stringify({ engine: 'llm', target: 'en', llm: { apiKey: '' } }));
    assert.deepEqual(loadTranslationSettings().llm, { baseUrl: DEFAULT_TRANSLATION_SETTINGS.llm.baseUrl, model: DEFAULT_TRANSLATION_SETTINGS.llm.model, apiKey: '', provider: 'custom' });
    rows.set('uku-translation-settings-v1', 'not json');
    assert.deepEqual(loadTranslationSettings(), DEFAULT_TRANSLATION_SETTINGS);
  } finally {
    restore();
  }
  const restoreThrowing = installStorage({
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  });
  if (!restoreThrowing) return;
  try {
    assert.deepEqual(loadTranslationSettings(), DEFAULT_TRANSLATION_SETTINGS);
    saveTranslationSettings(DEFAULT_TRANSLATION_SETTINGS);
  } finally {
    restoreThrowing();
  }
});

test('translate dedupes, skips cached sentences and batches within the Microsoft limits', async () => {
  const store = new MemoryTranslationStore();
  await store.put('b1', 'zh-Hans', 'microsoft', [['文0。', 'cached 0']]);
  const texts = Array.from({ length: 120 }, (_, index) => `文${index}。`);
  const fetchImpl = recordingFetch(({ body }) => microsoftReply(body));
  const translator = new Translator({ store, settings: () => settings(), fetchImpl });
  const result = await translator.translate('b1', [...texts, '文0。', '文1。']);
  assert.equal(result.get('文0。'), 'cached 0');
  assert.equal(result.get('文119。'), 'zh:文119。');
  assert.equal(result.size, 120);
  assert.equal(fetchImpl.calls.length, 3);
  assert.deepEqual(fetchImpl.calls.map(call => call.body.length).sort((a, b) => b - a), [50, 50, 19]);
  assert.equal(fetchImpl.calls[0].body.includes('文0。'), false);
  assert.equal(await store.count('b1', 'zh-Hans', texts), 120);
});

test('character limits split batches and a cache hit costs no request', async () => {
  const store = new MemoryTranslationStore();
  const long = [0, 1, 2].map(index => `${'あ'.repeat(3000)}${index}`);
  const fetchImpl = recordingFetch(({ body }) => microsoftReply(body, ''));
  await new Translator({ store, settings: () => settings(), fetchImpl }).translate('b1', long);
  // Batches run concurrently, so only their sizes are ordered guarantees.
  assert.deepEqual(fetchImpl.calls.map(call => call.body.length).sort((a, b) => b - a), [2, 1]);

  const again = recordingFetch(({ body }) => microsoftReply(body));
  const result = await new Translator({ store, settings: () => settings(), fetchImpl: again }).translate('b2', ['文A。', '文B。']);
  assert.equal(again.calls.length, 1);
  await new Translator({ store, settings: () => settings(), fetchImpl: again }).translate('b2', ['文A。', '文B。']);
  assert.equal(again.calls.length, 1);
  assert.equal(result.get('文A。'), 'zh:文A。');
});

test('punctuation-only and whitespace texts map to themselves without a request', async () => {
  const store = new MemoryTranslationStore();
  const fetchImpl = recordingFetch(({ body }) => microsoftReply(body));
  const result = await new Translator({ store, settings: () => settings(), fetchImpl }).translate('b1', ['……', '「」', '   ', '文。']);
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(fetchImpl.calls[0].body, ['文。']);
  assert.equal(result.get('……'), '……');
  assert.equal(result.get('「」'), '「」');
  assert.equal(result.get('   '), '   ');
});

test('retryable failures back off and succeed, stored results survive a hard failure', async () => {
  const store = new MemoryTranslationStore();
  let attempts = 0;
  const flaky = recordingFetch(({ body }) => {
    attempts += 1;
    return attempts === 1 ? new Response('slow down', { status: 429 }) : microsoftReply(body);
  });
  const translator = new Translator({ store, settings: () => settings(), fetchImpl: flaky, concurrency: 1 });
  const result = await translator.translate('b1', ['文。']);
  assert.equal(attempts, 2);
  assert.equal(result.get('文。'), 'zh:文。');

  const broken = new Translator({
    store, settings: () => settings(), concurrency: 1,
    fetchImpl: async () => new Response('boom', { status: 403 }),
  });
  await assert.rejects(broken.translate('b1', ['新しい文。']), (error) => error instanceof TranslationError && !error.retryable);
  assert.equal(await store.count('b1', 'zh-Hans', ['文。']), 1);
});

test('LLM requests carry system prompt, context and parse a fenced JSON array', async () => {
  const store = new MemoryTranslationStore();
  const fetchImpl = recordingFetch(() => llmReply('```json\n["一","二","三"]\n```'));
  const translator = new Translator({
    store, fetchImpl,
    settings: () => settings({ engine: 'llm', target: 'en', llm: { baseUrl: 'https://api.deepseek.com/v1/', model: 'deepseek-chat', apiKey: 'sk-test' } }),
  });
  const result = await translator.translate('b1', ['文一。', '文二。', '文三。']);
  assert.deepEqual([...result.values()], ['一', '二', '三']);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(call.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(call.body.model, 'deepseek-chat');
  assert.equal(call.body.temperature, 0.3);
  assert.match(call.body.messages[0].content, /JSON array of strings/);
  assert.deepEqual(JSON.parse(call.body.messages[1].content.split('\n').pop()), ['文一。', '文二。', '文三。']);
  assert.doesNotMatch(call.body.messages[1].content, /Context/);
});

test('a later LLM batch of the same call receives the previous sentences as context', async () => {
  const ctx = recordingFetch(({ body }) => {
    const list = JSON.parse(body.messages[1].content.split('\n').pop());
    return llmReply(JSON.stringify(list.map(value => `en:${value}`)));
  });
  const linked = new Translator({
    store: new MemoryTranslationStore(), fetchImpl: ctx, batchSize: 2,
    settings: () => settings({ engine: 'llm', llm: { baseUrl: 'https://api.deepseek.com/v1', model: 'm', apiKey: 'k' } }),
  });
  const result = await linked.translate('b2', ['文一。', '文二。', '文三。']);
  assert.equal(ctx.calls.length, 2);
  // Two batches of the default concurrency-2 pool may reach the network in either order.
  const withContext = ctx.calls.find(call => /Context/.test(call.body.messages[1].content));
  const withoutContext = ctx.calls.find(call => !/Context/.test(call.body.messages[1].content));
  assert.ok(withContext && withoutContext);
  assert.deepEqual(withoutContext.body.messages[1].content.split('\n').pop(), JSON.stringify(['文一。', '文二。']));
  assert.match(withContext.body.messages[1].content, /Context \(previous lines, do not translate\):\n文一。\n文二。/);
  assert.deepEqual(withContext.body.messages[1].content.split('\n').pop(), JSON.stringify(['文三。']));
  assert.equal(result.get('文三。'), 'en:文三。');
});

test('a wrong count or an unreadable reply is recovered by splitting; a missing key stays a hard error', async () => {
  const store = new MemoryTranslationStore();
  const bodies = [];
  const mismatch = new Translator({
    store, fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return llmReply('["only one"]'); },
    settings: () => settings({ engine: 'llm', llm: { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' } }),
  });
  const result = await mismatch.translate('b1', ['文一。', '文二。']);
  assert.deepEqual([...result.values()], ['only one', 'only one']);
  assert.equal(bodies.length, 3, 'the pair, then each sentence on its own');
  const noKey = new Translator({
    store, fetchImpl: async () => llmReply('[]'),
    settings: () => settings({ engine: 'llm', llm: { baseUrl: 'https://x/v1', model: 'm', apiKey: '' } }),
  });
  await assert.rejects(noKey.translate('b1', ['文三。']), (error) => error instanceof TranslationError && !error.retryable && error.message === '请先在设置里填写 API Key');
  // A single sentence answered without the array is still the answer.
  assert.deepEqual(await translateLlm(['文一。'], 'zh-Hans', { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, async () => llmReply('第一句。')), ['第一句。']);
});

test('reasoning models, broken JSON and plain-text fallback all end in translations', async () => {
  const llm = { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' };
  const think = await translateLlm(['あ。', 'い。'], 'zh-Hans', llm, async () => llmReply('<think>maybe ["x"] or [y]</think>\n["甲。","乙。"]'));
  assert.deepEqual(think, ['甲。', '乙。']);
  const quotes = await translateLlm(['あ。', 'い。'], 'zh-Hans', llm, async () => llmReply('["他说："你好"。", "乙。"]'));
  assert.deepEqual(quotes, ['他说："你好"。', '乙。']);
  // JSON never works for this model: each sentence ends up asked for plain text.
  let calls = 0;
  const plain = await translateLlm(['あ。', 'い。'], 'zh-Hans', llm, async (_url, init) => {
    calls += 1;
    const system = JSON.parse(init.body).messages[0].content;
    return llmReply(system.startsWith('Translate the Japanese text') ? '"译文"' : '{{{ nonsense');
  });
  assert.deepEqual(plain, ['译文', '译文']);
  assert.ok(calls <= 5, `bounded requests (${calls})`);
});

test('a rate limit waits as long as the platform asks (Retry-After)', async () => {
  const { translateLlm: call } = loadTypescript('../app/utils/translation.ts');
  const error = await call(['あ。'], 'zh-Hans', { baseUrl: 'https://x', model: 'm', apiKey: 'k' }, async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '7' }), json: async () => ({}) })).catch(e => e);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 7000);
});

test('pretranslate reports progress in book order and resumes from the cache', async () => {
  const store = new MemoryTranslationStore();
  const texts = Array.from({ length: 250 }, (_, index) => `文${index}。`);
  const fetchImpl = recordingFetch(({ body }) => microsoftReply(body));
  const translator = new Translator({ store, settings: () => settings(), fetchImpl });
  const seen = [];
  await translator.pretranslate('b1', texts, (done, total) => seen.push([done, total]));
  assert.deepEqual(seen, [[0, 250], [200, 250], [250, 250]]);
  assert.equal(await store.count('b1', 'zh-Hans', texts), 250);

  const resumed = [];
  await translator.pretranslate('b1', texts, (done, total) => resumed.push([done, total]));
  // Every sentence is cached now, so the first report already starts at the current share.
  assert.deepEqual(resumed, [[250, 250], [250, 250], [250, 250]]);
  assert.deepEqual(await translator.translate('b1', texts), new Map(texts.map(value => [value, `zh:${value}`])));
});

test('pretranslate rejects with AbortError both before and during the run', async () => {
  const store = new MemoryTranslationStore();
  const texts = Array.from({ length: 250 }, (_, index) => `文${index}。`);
  const translator = new Translator({
    store, settings: () => settings(),
    fetchImpl: async () => { throw new Error('no request expected after abort'); },
  });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(translator.pretranslate('b1', texts, () => {}, aborted.signal), (error) => error.name === 'AbortError');
  assert.equal(await store.count('b1', 'zh-Hans', texts), 0);

  // A cancel that lands after the first chunk was translated stops before the next one.
  const controller = new AbortController();
  const calls = [];
  const cancelling = new Translator({
    store: new MemoryTranslationStore(), settings: () => settings(), concurrency: 1,
    fetchImpl: async (url, init) => { calls.push(init); controller.abort(); return microsoftReply(JSON.parse(init.body)); },
  });
  await assert.rejects(cancelling.pretranslate('b2', texts, () => {}, controller.signal), (error) => error.name === 'AbortError');
  assert.ok(calls.length > 0);
});

test('switching engine or model translates again; switching back reuses what that engine translated', async () => {
  const { Translator, translationCacheKey } = loadTypescript('../app/utils/translation.ts');
  const { MemoryTranslationStore } = loadTypescript('../app/utils/translationStore.ts');
  const store = new MemoryTranslationStore();
  let settings = { engine: 'microsoft', target: 'zh-Hans', llm: { baseUrl: 'https://x/v1', model: 'a', apiKey: 'k' } };
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('edge.microsoft.com')) { calls.push('ms'); return { ok: true, status: 200, json: async () => JSON.parse(init.body).map(() => ({ translations: [{ text: '微软' }] })) }; }
    const model = JSON.parse(init.body).model; calls.push(model);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify([`模型${model}`]) } }] }) };
  };
  const translator = new Translator({ store, settings: () => settings, fetchImpl });
  const get = async () => (await translator.translate('book', ['こんにちは。'])).get('こんにちは。');
  assert.equal(await get(), '微软');
  settings = { ...settings, engine: 'llm' };
  assert.equal(await get(), '模型a', 'a new engine translates again instead of reusing Microsoft');
  settings = { ...settings, llm: { ...settings.llm, model: 'b' } };
  assert.equal(await get(), '模型b', 'a new model translates again');
  settings = { ...settings, engine: 'microsoft' };
  assert.equal(await get(), '微软');
  assert.deepEqual(calls, ['ms', 'a', 'b'], 'switching back to Microsoft needed no request');
  // Microsoft keeps the plain target, so translations cached by earlier versions still count.
  assert.equal(translationCacheKey({ engine: 'microsoft', target: 'en', llm: settings.llm }), 'en');
});

test('an LLM refusal carries the platform explanation, not just the status code', async () => {
  const { translateLlm } = loadTypescript('../app/utils/translation.ts');
  const reply = (status, body) => async () => ({ ok: false, status, json: async () => body });
  await assert.rejects(translateLlm(['あ'], 'zh-Hans', { baseUrl: 'https://x', model: 'm', apiKey: 'k' }, reply(402, { code: 30011, message: 'Account not verified' })), /HTTP 402）：Account not verified/);
  await assert.rejects(translateLlm(['あ'], 'zh-Hans', { baseUrl: 'https://x', model: 'm', apiKey: 'k' }, reply(429, { error: { message: 'Rate limit' } })), /HTTP 429）：Rate limit/);
  await assert.rejects(translateLlm(['あ'], 'zh-Hans', { baseUrl: 'https://x', model: 'm', apiKey: 'k' }, async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } })), /HTTP 500）$/);
});
