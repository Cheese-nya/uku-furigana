import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { AI_PROVIDERS, providerById, listModels, testConnection } = loadTypescript('../app/utils/aiProviders.ts');

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

test('listModels sends the key to /models and lists free models first', async () => {
  const seen = [];
  const models = await listModels({ baseUrl: 'https://x/v1/', model: '', apiKey: 'k' }, async (url, init) => {
    seen.push([url, init.headers.Authorization]);
    return json({ data: [{ id: 'paid-b' }, { id: 'a:free' }, { id: 'zero', pricing: { prompt: '0', completion: '0' } }, { id: 7 }] });
  });
  assert.deepEqual(seen, [['https://x/v1/models', 'Bearer k']]);
  assert.deepEqual(models, [{ id: 'a:free', free: true }, { id: 'zero', free: true }, { id: 'paid-b', free: false }]);
  await assert.rejects(listModels({ baseUrl: 'https://x/v1', model: '', apiKey: '' }, async () => ({ ok: false, status: 401 })), /401/);
});

test('testConnection translates one sentence through the chat endpoint', async () => {
  const text = await testConnection({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, 'zh-Hans', async (url, init) => {
    assert.equal(url, 'https://x/v1/chat/completions');
    assert.equal(JSON.parse(init.body).model, 'm');
    return json({ choices: [{ message: { content: '["你好。"]' } }] });
  });
  assert.equal(text, '你好。');
});
