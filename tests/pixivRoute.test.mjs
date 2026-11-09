import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { GET } = loadTypescript('../app/api/pixiv/route.ts');

test('Pixiv route rejects login-only and blank metadata before downloading a cover', async () => {
  const original = globalThis.fetch;
  try {
    for (const [body, status, message] of [
      [{ content: '', isLoginOnly: true }, 403, /需要登录/],
      [{ content: ' \n' }, 502, /正文为空/],
      [{ content: '[uploadedimage:1]' }, 502, /正文为空/],
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json({ error: false, body: { title: 'T', coverUrl: 'https://i.pximg.net/cover.jpg', ...body } });
      };
      const res = await GET(new Request('http://localhost/api/pixiv?id=14910277'));
      assert.equal(res.status, status);
      assert.match((await res.json()).error, message);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('Pixiv route still returns full public content and ruby', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: false, body: { title: 'T', content: '[[rb:漢字 > かんじ]]です' } });
  try {
    const res = await GET(new Request('http://localhost/api/pixiv?id=123456'));
    assert.equal(res.status, 200);
    const novel = await res.json();
    assert.equal(novel.content, '漢字(かんじ)です');
    assert.deepEqual(novel.rubyOverrides, { 漢字: 'かんじ' });
  } finally { globalThis.fetch = original; }
});
