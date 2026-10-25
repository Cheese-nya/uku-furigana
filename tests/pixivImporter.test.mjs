import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  extractPixivNovelId,
  cleanPixivDescription,
  cleanPixivContent,
  toPixivMirrorCoverUrl,
  fetchPixivNovel,
  PIXIV_UNREACHABLE,
} = loadTypescript('../app/utils/pixivImporter.ts');

const jsonResponse = (body, { ok = true, status = ok ? 200 : 500 } = {}) => ({ ok, status, json: async () => body });

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const request = String(url);
    calls.push(request);
    return handler(request, init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function withNativeBridge(novel) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const originalWindow = globalThis.window;
  globalThis.window = { furiganaPixiv: { novel } };
  return {
    restore() {
      if (hadWindow) globalThis.window = originalWindow;
      else delete globalThis.window;
    },
  };
}

test('extractPixivNovelId reads bare ids and common URL shapes', () => {
  for (const [input, expected] of [
    ['123456', '123456'],
    ['  123456  ', '123456'],
    ['https://www.pixiv.net/novel/show.php?id=123456', '123456'],
    ['https://www.pixiv.net/novel/show.php?id=123456#comments', '123456'],
    ['https://www.pixiv.net/member_illust.php?mode=novel&id=123456', '123456'],
    ['https://www.pixiv.net/en/novels/98765', '98765'],
    ['www.pixiv.net/novels/98765?p=2', '98765'],
    ['https://www.pixiv.net/novels/98765/', '98765'],
    ['ID=123456', '123456'],
  ]) {
    assert.equal(extractPixivNovelId(input), expected, input);
  }
});

test('extractPixivNovelId returns null for empty input and non-strings', () => {
  for (const input of ['', '   ', '\n\t ', null, undefined, 123456, {}, ['123456']]) {
    assert.equal(extractPixivNovelId(input), null, String(input));
  }
});

test('extractPixivNovelId applies the 4-15 digit rule to bare ids and URL shapes alike', () => {
  assert.equal(extractPixivNovelId('123'), null);
  assert.equal(extractPixivNovelId('1234'), '1234');
  assert.equal(extractPixivNovelId('0000'), '0000');
  assert.equal(extractPixivNovelId('123456789012345'), '123456789012345');
  assert.equal(extractPixivNovelId('1234567890123456'), null);
  assert.equal(extractPixivNovelId('-123456'), null);

  // URL ids must be 4-15 digits too, and a longer digit run is not truncated.
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novel/show.php?id=1234'), '1234');
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novel/show.php?id=1'), null);
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novel/show.php?id=123'), null);
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novel/show.php?id=1234567890123456'), null);
  assert.equal(extractPixivNovelId('https://www.pixiv.net/member_illust.php?mode=novel&id=123'), null);
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novels/1'), null);
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novels/123'), null);
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novels/1234567890123456'), null);
  assert.equal(extractPixivNovelId('id=123'), null);
  assert.equal(extractPixivNovelId('id=1234'), '1234');
});

test('extractPixivNovelId rejects strings without an id or novel path', () => {
  for (const input of [
    'https://www.pixiv.net/novel/show.php?foo=1',
    'https://www.pixiv.net/novel/series/123456',
    'https://www.pixiv.net/artworks/123456',
    'novel_id=123456',
    'id=abc',
  ]) {
    assert.equal(extractPixivNovelId(input), null, input);
  }
});

test('extractPixivNovelId prefers an id= match over the /novels/ path segment', () => {
  // Documented current order: query-ish id= wins, even when it is a fragment.
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novels/11111?foo=id=22222'), '22222');
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novels/11111#id=33333'), '33333');
  // An id= candidate that fails the 4-15 digit rule falls through to the /novels/ path.
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novels/11111?id=1'), '11111');
});

test('cleanPixivDescription converts breaks, strips tags and trims', () => {
  assert.equal(cleanPixivDescription(''), '');
  assert.equal(cleanPixivDescription(null), '');
  assert.equal(cleanPixivDescription(undefined), '');
  assert.equal(cleanPixivDescription('一行目<br>二行目'), '一行目\n二行目');
  assert.equal(cleanPixivDescription('一行目<BR />二行目'), '一行目\n二行目');
  assert.equal(cleanPixivDescription('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(cleanPixivDescription('<p>本文</p><a href="x">リンク</a>'), '本文リンク');
  assert.equal(cleanPixivDescription('  \n 前後の空白 \n  '), '前後の空白');
  // An unclosed angle bracket is text, not a tag.
  assert.equal(cleanPixivDescription('a < b'), 'a < b');
});

test('cleanPixivDescription decodes entities once, in the documented order', () => {
  assert.equal(cleanPixivDescription('&lt;b&gt;'), '<b>');
  assert.equal(cleanPixivDescription('a&nbsp;b'), 'a b');
  assert.equal(cleanPixivDescription('&quot;引用&quot;'), '"引用"');
  assert.equal(cleanPixivDescription('&#39;&apos;&#x27;'), "'''");
  assert.equal(cleanPixivDescription('A&amp;B'), 'A&B');
  // &amp; is decoded last, so escaped markup is not double-decoded.
  assert.equal(cleanPixivDescription('&amp;lt;'), '&lt;');
  assert.equal(cleanPixivDescription('&amp;amp;'), '&amp;');
  // Unsupported numeric entities are left alone.
  assert.equal(cleanPixivDescription('&#12354;'), '&#12354;');
});

test('cleanPixivContent returns empty output for empty input', () => {
  assert.deepEqual(cleanPixivContent(''), { content: '', rubyOverrides: {} });
  assert.deepEqual(cleanPixivContent(null), { content: '', rubyOverrides: {} });
  assert.deepEqual(cleanPixivContent(undefined), { content: '', rubyOverrides: {} });
});

test('cleanPixivContent expands [[rb:漢字 > かんじ]] into text plus overrides', () => {
  const single = cleanPixivContent('[[rb:漢字 > かんじ]]を書く');
  assert.equal(single.content, '漢字(かんじ)を書く');
  assert.deepEqual(single.rubyOverrides, { 漢字: 'かんじ' });

  const fullWidth = cleanPixivContent('[[rb:東京＞とうきょう]]駅');
  assert.equal(fullWidth.content, '東京(とうきょう)駅');
  assert.deepEqual(fullWidth.rubyOverrides, { 東京: 'とうきょう' });

  const tight = cleanPixivContent('[[rb:大阪>おおさか]]');
  assert.equal(tight.content, '大阪(おおさか)');
  assert.deepEqual(tight.rubyOverrides, { 大阪: 'おおさか' });

  const multi = cleanPixivContent('[[rb:東京 > とうきょう]]と[[rb:大阪 > おおさか]]');
  assert.equal(multi.content, '東京(とうきょう)と大阪(おおさか)');
  assert.deepEqual(multi.rubyOverrides, { 東京: 'とうきょう', 大阪: 'おおさか' });

  // Later duplicates win, and CRLF is normalized before any marker handling.
  const duplicate = cleanPixivContent('[[rb:空 > そら]]\r\n[[rb:空 > から]]');
  assert.equal(duplicate.content, '空(そら)\n空(から)');
  assert.deepEqual(duplicate.rubyOverrides, { 空: 'から' });
});

test('cleanPixivContent drops the parentheses for a whitespace-only rb reading', () => {
  const spaced = cleanPixivContent('[[rb:漢字 > ]]');
  assert.equal(spaced.content, '漢字');
  assert.deepEqual(spaced.rubyOverrides, {});

  const tabbed = cleanPixivContent('[[rb:東京 >\t]]駅');
  assert.equal(tabbed.content, '東京駅');
  assert.deepEqual(tabbed.rubyOverrides, {});

  // Neighbouring markers keep working around the dropped one.
  const mixed = cleanPixivContent('[[rb:空 > ]]と[[rb:海 > うみ]]');
  assert.equal(mixed.content, '空と海(うみ)');
  assert.deepEqual(mixed.rubyOverrides, { 海: 'うみ' });
});

test('cleanPixivContent leaves rb markers without any reading untouched', () => {
  for (const raw of ['[[rb:漢字>]]', '[[rb:漢字]]']) {
    const result = cleanPixivContent(raw);
    assert.equal(result.content, raw, raw);
    assert.deepEqual(result.rubyOverrides, {}, raw);
  }
});

test('cleanPixivContent leaves malformed rb markers untouched', () => {
  for (const raw of [
    '[[rb:漢 字 > かんじ]]',
    '[[rb: > かんじ]]',
    '[[rb:漢字 > かんじ]',
  ]) {
    const result = cleanPixivContent(raw);
    assert.equal(result.content, raw, raw);
    assert.deepEqual(result.rubyOverrides, {}, raw);
  }
  // A matched marker consumes exactly up to the first ']]', leaving the extra bracket.
  const trailing = cleanPixivContent('[[rb:漢字 > かんじ]]]');
  assert.equal(trailing.content, '漢字(かんじ)]');
  assert.deepEqual(trailing.rubyOverrides, { 漢字: 'かんじ' });
});

test('cleanPixivContent rewrites [chapter:], [newpage] and drops image markers', () => {
  assert.equal(cleanPixivContent('[chapter:第一話]本文').content, '【第一話】\n本文');
  assert.equal(cleanPixivContent('前[chapter:第二話]後').content, '前\n【第二話】\n後');
  assert.equal(cleanPixivContent('[Chapter:序章]').content, '【序章】');
  // The captured title is inserted verbatim, without trimming.
  assert.equal(cleanPixivContent('[chapter: 序章 ]').content, '【 序章 】');

  assert.equal(cleanPixivContent('前[newpage]後').content, '前\n\n後');
  assert.equal(cleanPixivContent('前[NEWPAGE]後').content, '前\n\n後');
  assert.equal(cleanPixivContent('前[pixivimage:123-456]後').content, '前後');
  assert.equal(cleanPixivContent('前[uploadedimage:789]後').content, '前後');
});

test('cleanPixivContent collapses runs of blank lines and trims the edges', () => {
  assert.equal(cleanPixivContent('a\n\n\n\n\nb').content, 'a\n\n\nb');
  assert.equal(cleanPixivContent('a[newpage][newpage]b').content, 'a\n\n\nb');
  assert.equal(cleanPixivContent('\n\n本文\n\n').content, '本文');
  assert.equal(cleanPixivContent('[newpage]').content, '');
  assert.deepEqual(cleanPixivContent('[pixivimage:1]').rubyOverrides, {});
});

test('toPixivMirrorCoverUrl rewrites i.pximg.net and keeps other URLs', () => {
  assert.equal(toPixivMirrorCoverUrl('https://i.pximg.net/img/1.jpg'), 'https://i.pixiv.re/img/1.jpg');
  assert.equal(toPixivMirrorCoverUrl('http://i.pximg.net/img/1.jpg?a=1'), 'https://i.pixiv.re/img/1.jpg?a=1');
  assert.equal(toPixivMirrorCoverUrl('HTTPS://I.PXIMG.NET/img/1.jpg'), 'https://i.pixiv.re/img/1.jpg');
  assert.equal(toPixivMirrorCoverUrl('  https://i.pximg.net/img/1.jpg  '), 'https://i.pixiv.re/img/1.jpg');
  assert.equal(toPixivMirrorCoverUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(toPixivMirrorCoverUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.equal(toPixivMirrorCoverUrl(' data:image/png;base64,AAA '), 'data:image/png;base64,AAA');
  assert.equal(toPixivMirrorCoverUrl(''), '');
  assert.equal(toPixivMirrorCoverUrl(null), '');
  // Only the exact i.pximg.net host is rewritten; the i-cf subdomain is not.
  assert.equal(toPixivMirrorCoverUrl('https://i-cf.pximg.net/a.jpg'), 'https://i-cf.pximg.net/a.jpg');
  assert.throws(() => toPixivMirrorCoverUrl(5), TypeError);
});

test('fetchPixivNovel rejects an invalid id without any request', async () => {
  const stub = stubFetch(() => {
    throw new Error('no network expected');
  });
  try {
    await assert.rejects(() => fetchPixivNovel('https://example.com/not-a-novel'), /无效的 Pixiv 小说链接或 ID/);
    await assert.rejects(() => fetchPixivNovel('   '), /无效的 Pixiv 小说链接或 ID/);
    assert.deepEqual(stub.calls, []);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel returns the local API payload as-is', async () => {
  const payload = {
    id: '123456',
    title: '夜の電車',
    author: '作者',
    description: 'あらすじ',
    content: '本文',
    rubyOverrides: { 漢字: 'かんじ' },
    coverUrl: 'https://i.pixiv.re/c/1.jpg',
    sourceUrl: 'https://www.pixiv.net/novel/show.php?id=123456',
  };
  const stub = stubFetch(() => jsonResponse(payload));
  try {
    assert.deepEqual(await fetchPixivNovel('https://www.pixiv.net/novel/show.php?id=123456'), payload);
    assert.deepEqual(stub.calls, ['/api/pixiv?id=123456']);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel falls back to the AJAX cascade and cleans the fields', async () => {
  const stub = stubFetch(url => {
    if (url === '/api/pixiv?id=123456') return jsonResponse({ error: '上游 404' }, { ok: false, status: 404 });
    if (url === '/api/pixiv-ajax?id=123456') return jsonResponse({}, { ok: false, status: 502 });
    if (url === 'https://www.pixiv.net/ajax/novel/123456') {
      return jsonResponse({
        error: false,
        body: {
          title: '  夜の電車  ',
          userName: ' 作者 ',
          description: '一行目<br>二行目',
          content: '[[rb:漢字 > かんじ]]本文[newpage]二頁',
        },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    assert.deepEqual(await fetchPixivNovel('123456'), {
      id: '123456',
      title: '夜の電車',
      author: '作者',
      description: '一行目\n二行目',
      content: '漢字(かんじ)本文\n\n二頁',
      rubyOverrides: { 漢字: 'かんじ' },
      coverUrl: '',
      sourceUrl: 'https://www.pixiv.net/novel/show.php?id=123456',
    });
    assert.deepEqual(stub.calls, [
      '/api/pixiv?id=123456',
      '/api/pixiv-ajax?id=123456',
      'https://www.pixiv.net/ajax/novel/123456',
    ]);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel falls back with title and author defaults', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: false, body: { content: '' } });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    assert.deepEqual(await fetchPixivNovel('123456'), {
      id: '123456',
      title: 'Pixiv #123456',
      author: '',
      description: '',
      content: '',
      rubyOverrides: {},
      coverUrl: '',
      sourceUrl: 'https://www.pixiv.net/novel/show.php?id=123456',
    });
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel keeps the AJAX cover when the image proxy fails', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({ error: '无此作品' }, { ok: false, status: 404 });
    if (url === '/api/pixiv-ajax?id=123456') {
      return jsonResponse({ error: false, body: { title: 'T', content: '本文', coverUrl: 'https://i.pximg.net/c/1.jpg' } });
    }
    if (url.startsWith('/api/pixiv-image?url=')) return jsonResponse({}, { ok: false, status: 500 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    const result = await fetchPixivNovel('123456');
    assert.equal(result.coverUrl, 'https://i.pixiv.re/c/1.jpg');
    assert.ok(stub.calls.some(url => url.startsWith('/api/pixiv-image?url=https%3A%2F%2Fi.pximg.net%2Fc%2F1.jpg')));
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel upgrades the cover to a proxied data URL', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url === '/api/pixiv-ajax?id=123456') {
      return jsonResponse({ error: false, body: { title: 'T', content: '本文', coverUrl: 'https://i.pximg.net/c/1.jpg' } });
    }
    if (url.startsWith('/api/pixiv-image?url=')) return jsonResponse({ dataUrl: 'data:image/png;base64,AAA' });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    assert.equal((await fetchPixivNovel('123456')).coverUrl, 'data:image/png;base64,AAA');
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel ignores a non-data image response', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url === '/api/pixiv-ajax?id=123456') {
      return jsonResponse({ error: false, body: { title: 'T', content: '本文', coverUrl: 'https://i.pximg.net/c/1.jpg' } });
    }
    if (url.startsWith('/api/pixiv-image?url=')) return jsonResponse({ dataUrl: 'https://evil.example/x.png' });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    assert.equal((await fetchPixivNovel('123456')).coverUrl, 'https://i.pixiv.re/c/1.jpg');
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel surfaces the API error when every transport fails', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({ error: '该作品不存在' }, { ok: false, status: 404 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({}, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 502 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /该作品不存在/);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel reports the last AJAX failure without an API error body', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) {
      throw new TypeError('Load failed');
    }
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({}, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 503 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /Pixiv 请求失败 \(HTTP 503\)/);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel turns a pixiv error flag into the server message', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: '作品已删除' });
    // The last endpoint's message wins, so both report the same reason here.
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({ error: true, message: '作品已删除' });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /作品已删除/);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel treats a body without error:false as a failure', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ body: { content: '本文' } });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({ body: { content: '本文' } });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /未找到该 Pixiv 小说/);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel uses the native bridge when present', async () => {
  const native = withNativeBridge(async id => ({
    id,
    title: '  ',
    content: '本文',
    coverUrl: 'https://i.pixiv.re/c.jpg',
    rubyOverrides: { 漢字: ' かんじ ', 空: 5 },
  }));
  const stub = stubFetch(() => {
    throw new Error('no network expected');
  });
  try {
    assert.deepEqual(await fetchPixivNovel('123456'), {
      id: '123456',
      title: 'Pixiv #123456',
      author: '',
      description: '',
      content: '本文',
      rubyOverrides: { 漢字: 'かんじ' },
      coverUrl: 'https://i.pixiv.re/c.jpg',
      sourceUrl: 'https://www.pixiv.net/novel/show.php?id=123456',
    });
    assert.deepEqual(stub.calls, []);
  } finally {
    stub.restore();
    native.restore();
  }
});

test('fetchPixivNovel keeps the native reason when the web cascade also fails', async () => {
  const native = withNativeBridge(async () => {
    throw new Error('原生通道超时');
  });
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({}, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 502 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /原生通道超时/);
  } finally {
    stub.restore();
    native.restore();
  }
});

test('fetchPixivNovel rejects a native payload without content', async () => {
  const native = withNativeBridge(async () => ({ title: 'T' }));
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({}, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 502 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /Pixiv 返回的正文为空/);
  } finally {
    stub.restore();
    native.restore();
  }
});

test('fetchPixivNovel reports the native bridge error before the web API one', async () => {
  const native = withNativeBridge(async () => {
    throw new Error('原生通道超时');
  });
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({ error: '上游 500' }, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({}, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 502 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /原生通道超时/);
  } finally {
    stub.restore();
    native.restore();
  }
});

test('fetchPixivNovel keeps Pixiv own message over a later generic cascade failure', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({}, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: '作品已删除' });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 502 });
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /作品已删除/);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel orders failures: native, then /api/pixiv, then Pixiv message, then last error', async () => {
  const cascade = url => {
    if (url.startsWith('/api/pixiv?')) return jsonResponse({ error: '本地接口错误' }, { ok: false, status: 500 });
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: '作品已删除' });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) return jsonResponse({}, { ok: false, status: 502 });
    throw new Error(`unexpected request: ${url}`);
  };

  // With a native bridge, the native reason outranks both web layers.
  const native = withNativeBridge(async () => {
    throw new Error('原生通道超时');
  });
  const withBridge = stubFetch(cascade);
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /原生通道超时/);
  } finally {
    withBridge.restore();
    native.restore();
  }

  // Without it, the /api/pixiv reason outranks Pixiv's cascade message.
  const noBridge = stubFetch(cascade);
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /本地接口错误/);
  } finally {
    noBridge.restore();
  }
});

test('fetchPixivNovel shows the Android proxy reason instead of the CORS "Failed to fetch"', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return { ok: false, status: 404, json: async () => { throw new SyntaxError('not json'); } };
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: 'connect timed out' }, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), error => {
      assert.equal(error.message, `${PIXIV_UNREACHABLE}（connect timed out）`);
      return true;
    });
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel turns a bare network failure into a readable reason', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) throw new TypeError('Failed to fetch');
    if (url.startsWith('/api/pixiv-ajax')) return { ok: false, status: 404, json: async () => { throw new SyntaxError('not json'); } };
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), error => {
      assert.equal(error.message, PIXIV_UNREACHABLE);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    });
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel keeps pixiv\'s own reason from a failed proxy response', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return { ok: false, status: 404, json: async () => { throw new SyntaxError('not json'); } };
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: '該当作品は削除されたか、存在しない作品IDです。' }, { ok: false, status: 404 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /該当作品は削除された/);
  } finally {
    stub.restore();
  }
});

const RELAY = 'https://uku.saiaino.xyz/api/pixiv?id=';
const notJson = { ok: false, status: 404, json: async () => { throw new SyntaxError('not json'); } };

test('fetchPixivNovel falls back to the relay when the native proxy cannot reach pixiv', async () => {
  const novel = { id: '123456', title: 'T', author: 'A', description: '', content: '本文', rubyOverrides: {}, coverUrl: '', sourceUrl: 'https://www.pixiv.net/novel/show.php?id=123456' };
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return notJson;
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: 'connect timed out' }, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    if (url === `${RELAY}123456`) return jsonResponse(novel);
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    assert.deepEqual(await fetchPixivNovel('123456'), novel);
    assert.equal(stub.calls.at(-1), `${RELAY}123456`);
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel shows the relay\'s pixiv answer, and the local reason when the relay is down too', async () => {
  let relay = () => jsonResponse({ error: '无法从 Pixiv 获取小说 (HTTP 404)' }, { ok: false, status: 404 });
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return notJson;
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: 'connect timed out' }, { ok: false, status: 502 });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    if (url.startsWith(RELAY)) return relay();
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /无法从 Pixiv 获取小说 \(HTTP 404\)/);
    relay = () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(() => fetchPixivNovel('123456'), error => {
      assert.equal(error.message, `${PIXIV_UNREACHABLE}（connect timed out）`);
      return true;
    });
  } finally {
    stub.restore();
  }
});

test('fetchPixivNovel skips the relay when pixiv already answered or the page is the relay itself', async () => {
  const stub = stubFetch(url => {
    if (url.startsWith('/api/pixiv?')) return notJson;
    if (url.startsWith('/api/pixiv-ajax')) return jsonResponse({ error: true, message: '作品已删除' });
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), /作品已删除/);
    assert.equal(stub.calls.some(url => url.startsWith(RELAY)), false);
  } finally {
    stub.restore();
  }
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://uku.saiaino.xyz' } };
  const online = stubFetch(url => {
    if (url.startsWith('/api/pixiv')) return notJson;
    if (url.startsWith('https://www.pixiv.net/ajax/novel/')) throw new TypeError('Failed to fetch');
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    await assert.rejects(() => fetchPixivNovel('123456'), error => error.message === PIXIV_UNREACHABLE);
    assert.equal(online.calls.some(url => url.startsWith(RELAY)), false);
  } finally {
    online.restore();
    if (hadWindow) globalThis.window = originalWindow;
    else delete globalThis.window;
  }
});
