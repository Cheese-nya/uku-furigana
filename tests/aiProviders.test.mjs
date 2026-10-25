import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { AI_PROVIDERS, providerById, listModels, testConnection, modelPrice, probeModels } = loadTypescript('../app/utils/aiProviders.ts');

const json = body => ({ ok: true, status: 200, json: async () => body });

test('presets: every platform has an https endpoint, a model and a key page; unknown ids fall back to custom', () => {
  for (const provider of AI_PROVIDERS.filter(item => item.id !== 'custom')) {
    assert.match(provider.baseUrl, /^https:\/\//, provider.id);
    assert.ok(provider.model, provider.id);
    assert.match(provider.keyUrl, /^https:\/\//, provider.id);
  }
  assert.ok(!AI_PROVIDERS.some(item => /bigmodel/.test(item.baseUrl)), 'Zhipu blocks browser requests');
  assert.equal(providerById('nope').id, 'custom');
  assert.equal(AI_PROVIDERS.filter(item => item.login).map(item => item.id).join(), 'openrouter');
});

test('listModels sends the key to /models, drops non-chat models and lists free ones first', async () => {
  const seen = [];
  const models = await listModels({ provider: 'openrouter', baseUrl: 'https://x/v1/', model: '', apiKey: 'k' }, async (url, init) => {
    seen.push([url, init.headers.Authorization]);
    return json({ data: [
      { id: 'paid-b', pricing: { prompt: '0.1', completion: '0.2' } },
      { id: 'a:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'google/lyria-3-pro-preview', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['audio'] } },
      { id: 'text-embedding-3' }, { id: 7 },
    ] });
  });
  assert.deepEqual(seen, [['https://x/v1/models', 'Bearer k']]);
  assert.deepEqual(models, [{ id: 'a:free', price: 'free' }, { id: 'paid-b', price: 'paid' }]);
  const gemini = await listModels({ provider: 'gemini', baseUrl: 'https://g', model: '', apiKey: 'k' }, async () => json({ data: [{ id: 'models/gemini-2.5-pro' }, { id: 'models/gemini-2.5-flash' }] }));
  assert.deepEqual(gemini, [{ id: 'gemini-2.5-flash', price: 'quota' }, { id: 'gemini-2.5-pro', price: 'paid' }]);
  await assert.rejects(listModels({ baseUrl: 'https://x/v1', model: '', apiKey: '' }, async () => ({ ok: false, status: 401 })), /401/);
});

test('modelPrice follows each platform: price lists, published free models, free tiers', () => {
  assert.equal(modelPrice('siliconflow', 'tencent/Hunyuan-MT-7B'), 'free');
  assert.equal(modelPrice('siliconflow', 'XingChenAGI/Xing4.0-29B'), 'free');
  assert.equal(modelPrice('siliconflow', 'Qwen/Qwen3-8B'), 'unknown', 'no longer on the free list');
  assert.equal(modelPrice('siliconflow', 'Pro/Qwen/Qwen3-8B'), 'paid');
  assert.equal(modelPrice('siliconflow', 'LoRA/Qwen/Qwen2.5-7B-Instruct'), 'paid');
  assert.equal(modelPrice('siliconflow', 'deepseek-ai/DeepSeek-V4'), 'unknown');
  assert.equal(modelPrice('groq', 'llama-3.3-70b-versatile'), 'quota');
  assert.equal(modelPrice('deepseek', 'deepseek-chat'), 'paid');
  assert.equal(modelPrice('dashscope', 'qwen-turbo'), 'unknown');
  assert.equal(modelPrice('custom', 'x:free'), 'free');
});

test('probeModels tries each model with one sentence and names the reason when one fails', async () => {
  const results = {};
  const fetchImpl = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    if (model === 'ok') return json({ choices: [{ message: { content: '["你好。"]' } }] });
    return { ok: false, status: model === 'busy' ? 429 : model === 'gone' ? 404 : 401, json: async () => ({}) };
  };
  await probeModels({ baseUrl: 'https://x/v1', model: '', apiKey: 'k' }, ['ok', 'busy', 'gone', 'nokey'], 'zh-Hans', (id, result) => { results[id] = result.state === 'ok' ? 'ok' : result.reason; }, new AbortController().signal, fetchImpl);
  assert.deepEqual(results, { ok: 'ok', busy: 'limit', gone: 'missing', nokey: 'key' });
});

test('testConnection translates one sentence through the chat endpoint', async () => {
  const text = await testConnection({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, 'zh-Hans', async (url, init) => {
    assert.equal(url, 'https://x/v1/chat/completions');
    assert.equal(JSON.parse(init.body).model, 'm');
    return json({ choices: [{ message: { content: '["你好。"]' } }] });
  });
  assert.equal(text, '你好。');
});
