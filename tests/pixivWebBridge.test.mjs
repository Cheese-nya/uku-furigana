import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { requestPixivWeb, hasPixivWebHelper } = loadTypescript('../app/utils/pixivWebBridge.ts');
const { fetchPixivNovel } = loadTypescript('../app/utils/pixivImporter.ts');

function bridge(reply) {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  const listeners = new Set(), sent = [];
  const window = {
    location: { origin: 'http://localhost:3010' },
    addEventListener: (type, callback) => { if (type === 'message') listeners.add(callback); },
    removeEventListener: (type, callback) => { if (type === 'message') listeners.delete(callback); },
    postMessage(request) {
      sent.push(request);
      const respond = (result, overrides = {}) => {
        const event = { source: window, origin: window.location.origin, data: { channel: request.channel, direction: 'response', id: request.id, result }, ...overrides };
        for (const listener of listeners) listener(event);
      };
      queueMicrotask(() => reply?.(request, respond));
    },
  };
  globalThis.window = window;
  globalThis.document = { querySelector: () => ({}) };
  return { sent, listeners, restore() {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  } };
}

test('web messaging validates origin and source, and removes listeners on completion', async () => {
  const f = bridge((_request, respond) => {
    respond({ ok: true, data: 'forged' }, { origin: 'https://evil.test' });
    respond({ ok: true, data: 'forged' }, { source: {} });
    respond({ ok: true, data: { supported: true, loggedIn: true } });
  });
  try {
    assert.equal(hasPixivWebHelper(), true);
    assert.deepEqual(await requestPixivWeb('status'), { supported: true, loggedIn: true });
    assert.equal(f.listeners.size, 0);
  } finally { f.restore(); }
});

test('the web importer uses authenticated helper content and preserves Pixiv ruby without calling a server', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('server must not be called'); };
  const f = bridge((request, respond) => {
    assert.equal(request.action, 'novel');
    assert.equal(request.novelId, '14910277');
    respond({ ok: true, data: { title: ' T ', userName: ' A ', description: '<b>D</b>', content: '[[rb:漢字 > かんじ]]本文', coverUrl: '', isLoginOnly: true } });
  });
  try {
    const result = await fetchPixivNovel('14910277');
    assert.equal(result.title, 'T');
    assert.equal(result.author, 'A');
    assert.equal(result.description, 'D');
    assert.equal(result.content, '漢字(かんじ)本文');
    assert.deepEqual(result.rubyOverrides, { 漢字: 'かんじ' });
  } finally { f.restore(); globalThis.fetch = originalFetch; }
});

test('login restrictions from the helper point to settings and do not fall back to anonymous import', async () => {
  const f = bridge((_request, respond) => respond({ ok: false, error: 'PIXIV_LOGIN_REQUIRED' }));
  try { await assert.rejects(() => fetchPixivNovel('14910277'), /设置 → Pixiv 账号/); }
  finally { f.restore(); }
});

test('an unresponsive helper times out and releases its message listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = bridge();
  try {
    const pending = assert.rejects(requestPixivWeb('status'), /请求超时/);
    t.mock.timers.tick(5_000);
    await pending;
    assert.equal(f.listeners.size, 0);
  } finally { f.restore(); }
});
