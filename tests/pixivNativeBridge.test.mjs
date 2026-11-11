import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SWIFT_PATH = fileURLToPath(new URL('../ios/App/App/PixivNativeBridge.swift', import.meta.url));

/** Pulls the `bridgeScript` Swift multiline string out of the native bridge source. */
function loadBridgeScript() {
  const source = readFileSync(SWIFT_PATH, 'utf8');
  const marker = 'private static let bridgeScript = """';
  const start = source.indexOf(marker);
  assert.ok(start >= 0, 'bridgeScript multiline string must exist in PixivNativeBridge.swift');
  const bodyStart = source.indexOf('\n', start) + 1;
  const bodyEnd = source.indexOf('"""', bodyStart);
  assert.ok(bodyEnd > bodyStart, 'bridgeScript multiline string must be terminated');
  return source.slice(bodyStart, bodyEnd);
}

/** Runs the injected shim against a fake WebKit message handler and page. */
function installBridge() {
  const posted = [];
  const window = {
    webkit: {
      messageHandlers: {
        furiganaPixiv: { postMessage: message => posted.push(message) },
      },
    },
  };
  const document = { documentElement: { attributes: {}, setAttribute: (k, v) => { document.documentElement.attributes[k] = v; } } };
  const run = new Function('window', 'document', loadBridgeScript());
  run(window, document);
  return { window, document, posted };
}

test('injected Pixiv shim exposes isNative and forwards novel requests to the native handler', async () => {
  const { window, document, posted } = installBridge();

  assert.equal(window.furiganaPixiv.isNative, true);
  assert.equal(document.documentElement.attributes['data-furigana-native'], 'ios');

  const pending = window.furiganaPixiv.novel('20200345');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].kind, 'novel');
  assert.equal(posted[0].param, '20200345');
  assert.match(posted[0].requestId, /^pixiv-/);

  // Swift replies with a JSON *string*; the shim must resolve with the parsed payload.
  window.__furiganaPixivResolve(JSON.stringify({
    requestId: posted[0].requestId,
    ok: true,
    data: { id: '20200345', content: '本文' },
  }));
  assert.deepEqual(await pending, { id: '20200345', content: '本文' });
});

test('injected Pixiv shim rejects with the native error message and ignores unknown replies', async () => {
  const { window, posted } = installBridge();

  const failing = window.furiganaPixiv.novel('1');
  window.__furiganaPixivResolve(JSON.stringify({
    requestId: posted[0].requestId,
    ok: false,
    error: '无法从 Pixiv 获取小说 (HTTP 403)',
  }));
  await assert.rejects(() => failing, /HTTP 403/);

  // A duplicate/unknown reply must not throw (Swift may deliver late).
  assert.doesNotThrow(() => window.__furiganaPixivResolve(JSON.stringify({ requestId: 'nope', ok: true })));
  assert.doesNotThrow(() => window.__furiganaPixivResolve('not json'));

  const image = window.furiganaPixiv.image('https://i.pximg.net/x.jpg');
  assert.equal(posted[1].kind, 'image');
  window.__furiganaPixivResolve(JSON.stringify({
    requestId: posted[1].requestId,
    ok: true,
    data: 'data:image/jpeg;base64,AAA',
  }));
  assert.equal(await image, 'data:image/jpeg;base64,AAA');
});

test('injected Pixiv shim installs once so a re-injected script keeps pending promises', async () => {
  const { window, posted } = installBridge();
  const firstApi = window.furiganaPixiv;

  // Capacitor can re-evaluate the document-start script; it must not clobber state.
  const runAgain = new Function('window', 'document', loadBridgeScript());
  runAgain(window, { documentElement: { setAttribute: () => undefined } });

  assert.equal(window.furiganaPixiv, firstApi);
  void window.furiganaPixiv.novel('2');
  assert.equal(posted.length, 1);
});

test('iOS account shim passes actions and only returns the native account status', async () => {
  const { window, posted } = installBridge();
  for (const action of ['status', 'login', 'logout']) {
    const pending = window.furiganaPixiv.account(action);
    const request = posted.at(-1);
    assert.equal(request.kind, 'account');
    assert.equal(request.param, action);
    window.__furiganaPixivResolve({ requestId: request.requestId, ok: true, data: { supported: true, loggedIn: action !== 'logout' } });
    assert.deepEqual(await pending, { supported: true, loggedIn: action !== 'logout' });
  }
});
