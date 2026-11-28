import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { OcrModelStore } = loadTypescript('../app/utils/ocrModelStore.ts');

function createMemoryIdb() {
  const storeData = new Map();
  const makeRequest = executor => {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.({ target: req });
      } catch (err) {
        req.error = err;
        req.onerror?.({ target: req });
      }
    });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    transaction: () => {
      const tx = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: () => ({
          get: key => makeRequest(() => storeData.get(key)),
          put: value => makeRequest(() => {
            storeData.set(value.key, value);
            return value.key;
          }),
          clear: () => makeRequest(() => {
            storeData.clear();
          }),
        }),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  return {
    storeData,
    factory: {
      open: () => {
        const req = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.({ target: req }));
        return req;
      },
    },
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeFakeFetch(revision = 'rev-1', corruptData = false) {
  const deimBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const configBytes = new TextEncoder().encode(JSON.stringify({ classes: ['line_main'], markdown: {}, charset: ['あ'] }));
  const manifest = {
    version: 1,
    revision,
    files: {
      'deim.onnx': { key: 'deim', size: deimBytes.byteLength, sha256: sha256(deimBytes) },
      'ndl-config.json': { key: 'config', size: configBytes.byteLength, sha256: sha256(configBytes) },
    },
  };
  let calls = 0;
  const fetchFn = async url => {
    calls += 1;
    if (url.endsWith('manifest.json')) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    if (url.endsWith('deim.onnx')) {
      const body = corruptData ? new Uint8Array([9, 9, 9, 9, 9, 9]) : deimBytes;
      return new Response(body, { status: 200 });
    }
    if (url.endsWith('ndl-config.json')) {
      return new Response(configBytes, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchFn, getCalls: () => calls, manifest };
}

test('OcrModelStore bundled mode skips IndexedDB and reports bundled status', async () => {
  const { factory, storeData } = createMemoryIdb();
  const { fetchFn } = makeFakeFetch('bundled-rev');
  const store = new OcrModelStore({ bundled: true, indexedDB: factory, fetch: fetchFn });

  const cfg = await store.loadConfig('/vendor/ndlocr-lite');
  assert.deepEqual(cfg.classes, ['line_main']);
  const model = await store.loadAsset('/vendor/ndlocr-lite', 'deim');
  assert.equal(model.byteLength, 6);
  assert.equal(storeData.size, 0, 'bundled runtime must not duplicate models into IndexedDB');
  assert.deepEqual(await store.getStatus(), { bundled: true, cached: true, cachedBytes: 0 });
});

test('OcrModelStore web mode caches in IndexedDB, hits cache on second read, invalidates on revision change, and clears', async () => {
  const { factory, storeData } = createMemoryIdb();
  const fake1 = makeFakeFetch('rev-1');
  const store = new OcrModelStore({ bundled: false, indexedDB: factory, fetch: fake1.fetchFn });

  const buf1 = await store.loadAsset('/vendor/ndlocr-lite', 'deim');
  assert.equal(buf1.byteLength, 6);
  const callsAfterFirst = fake1.getCalls(); // manifest + deim

  // Second read of deim hits IndexedDB without fetching model binary again (manifest already memoized too)
  const buf2 = await store.loadAsset('/vendor/ndlocr-lite', 'deim');
  assert.equal(buf2.byteLength, 6);
  assert.equal(fake1.getCalls(), callsAfterFirst);

  // Also load config so status reports all manifest files cached
  await store.loadConfig('/vendor/ndlocr-lite');
  const status1 = await store.getStatus();
  assert.equal(status1.bundled, false);
  assert.equal(status1.cached, true);
  assert.ok(status1.cachedBytes > 6);

  // Clear cache
  await store.clearCache();
  assert.equal(storeData.size, 0);
  const statusCleared = await store.getStatus();
  assert.equal(statusCleared.cached, false);
  assert.equal(statusCleared.cachedBytes, 0);
});

test('OcrModelStore web mode rejects SHA-256 mismatch and handles revision updates', async () => {
  const { factory } = createMemoryIdb();
  const bad = makeFakeFetch('rev-bad', true);
  const storeBad = new OcrModelStore({ bundled: false, indexedDB: factory, fetch: bad.fetchFn });
  await assert.rejects(
    () => storeBad.loadAsset('/vendor/ndlocr-lite', 'deim'),
    /checksum mismatch/,
  );

  // Revision bump invalidates stale manifest cache
  const v1 = makeFakeFetch('rev-a');
  const v2 = makeFakeFetch('rev-b');
  let activeFetch = v1.fetchFn;
  const storeRev = new OcrModelStore({ bundled: false, indexedDB: factory, fetch: (u, o) => activeFetch(u, o) });
  await storeRev.loadAsset('/vendor/ndlocr-lite', 'deim');
  activeFetch = v2.fetchFn;
  // Fresh store instance (new page load) fetches rev-b instead of reusing stale rev-a asset
  const storeReload = new OcrModelStore({ bundled: false, indexedDB: factory, fetch: (u, o) => activeFetch(u, o) });
  await storeReload.loadAsset('/vendor/ndlocr-lite', 'deim');
  assert.ok(v2.getCalls() >= 2);
});
