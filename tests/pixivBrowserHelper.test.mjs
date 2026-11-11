import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { createPixivHandler, novelPayload, trustedSender } from '../extensions/pixiv-helper/core.mjs';

const sender = { frameId: 0, url: 'https://uku.saiaino.xyz/' };
const payload = { status: 200, data: { error: false, body: { content: '本文', title: 'T', userName: 'A', isLoginOnly: true, cookie: 'must-not-leak', bookmarkData: { private: true } } } };
function fixture() {
  let cookie = { value: '12345_private-session', domain: '.pixiv.net', path: '/', name: 'PHPSESSID', storeId: '0' };
  const opened = [], removed = [];
  const api = {
    cookies: { get: async () => cookie, getAll: async () => cookie ? [cookie] : [], remove: async () => { cookie = null; } },
    tabs: {
      create: async options => { opened.push(options); return { id: 7 }; },
      query: async () => [], get: async () => ({ status: 'complete' }), remove: async id => { removed.push(id); },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    scripting: { executeScript: async () => [{ result: payload }] },
  };
  return { api, opened, removed };
}

test('only the Uku top-level page and local development origins can use the helper', () => {
  assert.equal(trustedSender(sender), true);
  assert.equal(trustedSender({ frameId: 0, url: 'http://localhost:3010/' }), true);
  for (const bad of [{ ...sender, frameId: 2 }, { ...sender, url: 'https://uku.saiaino.xyz.evil.test/' }, { ...sender, url: 'http://uku.saiaino.xyz/' }, { ...sender, url: 'https://uku.saiaino.xyz:444/' }]) assert.equal(trustedSender(bad), false);
});

test('account status, official login and logout never send cookies to the web page', async () => {
  const f = fixture(), handle = createPixivHandler(f.api);
  assert.deepEqual(await handle({ action: 'status' }, sender), { ok: true, data: { supported: true, loggedIn: true } });
  assert.equal((await handle({ action: 'login' }, sender)).ok, true);
  assert.match(f.opened[0].url, /^https:\/\/accounts\.pixiv\.net\/login\?/);
  assert.deepEqual(await handle({ action: 'logout' }, sender), { ok: true, data: { supported: true, loggedIn: false } });
});

test('novel reads use a fixed endpoint and return only import fields', async () => {
  const f = fixture(), calls = [];
  const handle = createPixivHandler(f.api, async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => payload.data }; });
  const result = await handle({ action: 'novel', novelId: '14910277' }, sender);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://www.pixiv.net/ajax/novel/14910277');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(result.data.content, '本文');
  assert.equal(JSON.stringify(result).includes('private-session'), false);
  assert.equal('cookie' in result.data, false);
  assert.equal('bookmarkData' in result.data, false);
  assert.equal((await handle({ action: 'novel', novelId: 'https://evil.test' }, sender)).ok, false);
  assert.equal(calls.length, 1);
});

test('blocked extension cookies fall back to a real Pixiv tab and clean up only that helper tab', async () => {
  const f = fixture();
  const handle = createPixivHandler(f.api, async () => ({ status: 200, json: async () => ({ error: false, body: { content: '', isLoginOnly: true } }) }));
  assert.equal((await handle({ action: 'novel', novelId: '14910277' }, sender)).data.content, '本文');
  assert.deepEqual(f.opened, [{ url: 'https://www.pixiv.net/', active: false }]);
  assert.deepEqual(f.removed, [7]);
  assert.throws(() => novelPayload({ status: 200, data: { error: false, body: { content: '', isLoginOnly: true } } }), /PIXIV_LOGIN_REQUIRED/);
});

test('downloaded helper archive contains the exact reviewable sources and manifest', async () => {
  const zip = await JSZip.loadAsync(readFileSync(new URL('../public/uku-pixiv-helper.zip', import.meta.url)));
  for (const name of ['manifest.json', 'background.js', 'core.mjs', 'content.js', 'README.md']) {
    assert.equal(await zip.file(`uku-pixiv-helper/${name}`).async('string'), readFileSync(new URL(`../extensions/pixiv-helper/${name}`, import.meta.url), 'utf8'));
  }
});
