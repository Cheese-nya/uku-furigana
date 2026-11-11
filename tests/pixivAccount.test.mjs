import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { getPixivAccountStatus, loginPixivAccount, logoutPixivAccount } = loadTypescript('../app/utils/pixivAccount.ts');
const { isPixivLoginRequired, PIXIV_LOGIN_REQUIRED } = loadTypescript('../app/utils/pixivErrors.ts');

function installWindow(value) {
  const previous = globalThis.window;
  globalThis.window = value;
  return () => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; };
}

test('web and older shells report unsupported instead of pretending an external browser login is usable', async () => {
  for (const window of [{}, { AndroidBridge: {} }, { furiganaPixiv: { novel() {} } }]) {
    const restore = installWindow(window);
    try { assert.deepEqual(await getPixivAccountStatus(), { supported: false, loggedIn: false }); }
    finally { restore(); }
  }
});

test('Android account actions preserve method binding and return only session presence', async () => {
  const bridge = {
    saved: false,
    getPixivAccountStatus() { return JSON.stringify({ supported: true, loggedIn: this.saved, cookie: 'not-for-the-ui' }); },
    openPixivLogin() { this.saved = true; return this.getPixivAccountStatus(); },
    logoutPixiv() { this.saved = false; return this.getPixivAccountStatus(); },
  };
  const restore = installWindow({ AndroidBridge: bridge });
  try {
    assert.deepEqual(await getPixivAccountStatus(), { supported: true, loggedIn: false });
    assert.deepEqual(await loginPixivAccount(), { supported: true, loggedIn: true });
    assert.deepEqual(await logoutPixivAccount(), { supported: true, loggedIn: false });
  } finally { restore(); }
});

test('iOS and desktop use native account actions and propagate failures', async () => {
  for (const platform of ['ios', 'desktop']) {
    const calls = [];
    const reply = action => { calls.push(action); return { supported: true, loggedIn: action !== 'logout' }; };
    const restore = installWindow(platform === 'ios'
      ? { furiganaPixiv: { novel() {}, account: async action => reply(action) } }
      : { pywebview: { api: {
        pixiv_account_status: async () => reply('status'),
        pixiv_account_login: async () => reply('login'),
        pixiv_account_logout: async () => ({ error: 'unavailable' }),
      } } });
    try {
      assert.equal((await getPixivAccountStatus()).loggedIn, true);
      assert.equal((await loginPixivAccount()).supported, true);
      if (platform === 'ios') assert.equal((await logoutPixivAccount()).loggedIn, false);
      else await assert.rejects(logoutPixivAccount, /unavailable/);
      assert.deepEqual(calls.slice(0, 2), ['status', 'login']);
    } finally { restore(); }
  }
});

test('login errors from old relays and native shells all offer the settings recovery path', () => {
  for (const message of [PIXIV_LOGIN_REQUIRED, '这篇 Pixiv 小说需要登录后才能阅读，当前导入通道未登录。', new Error('PIXIV_LOGIN_REQUIRED')]) {
    assert.equal(isPixivLoginRequired(message), true);
  }
  assert.equal(isPixivLoginRequired('Pixiv 请求超时'), false);
});

test('an unresponsive account bridge produces a retryable failure instead of checking forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = installWindow({ furiganaPixiv: { novel() {}, account: () => new Promise(() => {}) } });
  try {
    const pending = assert.rejects(getPixivAccountStatus, /timed out/);
    t.mock.timers.tick(10_000);
    await pending;
  } finally { restore(); }
});
