import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { IDBFactory } from 'fake-indexeddb';
import { loadTypescript } from './loadTypescript.mjs';

const { DictionaryAssetLoader } = loadTypescript('../app/utils/dictionaryAssetCache.ts');

const BASE = 'https://test.local/dict/';
const NativeDecompressionStream = globalThis.DecompressionStream;
globalThis.DecompressionStream = class {
  constructor(format) {
    if (format !== 'brotli') return new NativeDecompressionStream(format);
    let chunks = [];
    return new TransformStream({
      transform(chunk) { chunks.push(Buffer.from(chunk)); },
      flush(controller) {
        controller.enqueue(new Uint8Array(zlib.brotliDecompressSync(Buffer.concat(chunks))));
        chunks = [];
      },
    });
  }
};

const FILE_A = Buffer.from('first dictionary file');
const FILE_B = Buffer.from('{"second":"dictionary"}');
const manifestFor = revision => ({
  version: 1,
  revision,
  files: {
    'base.dat.gz': { brotli: `assets/${revision}/base.dat.br`, size: FILE_A.byteLength },
    'readings.json.gz': { brotli: `assets/${revision}/readings.json.br`, size: FILE_B.byteLength },
  },
});

function server() {
  const bodies = new Map([
    ['base.dat.gz', FILE_A],
    ['readings.json.gz', FILE_B],
  ]);
  const requests = [];
  let current = manifestFor('r1');
  let failDownloads = false;
  const fetchFn = async url => {
    requests.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(current), { status: 200 });
    if (failDownloads) return new Response('offline', { status: 503 });
    const name = url.split('/').pop().replace(/\.br$/, '.gz');
    const raw = bodies.get(name);
    if (!raw) return new Response('missing', { status: 404 });
    return new Response(url.endsWith('.br') ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw), { status: 200 });
  };
  return {
    fetchFn,
    requests,
    setManifest(manifest) { current = manifest; },
    setFailDownloads(value) { failDownloads = value; },
  };
}

test('首次下载后缓存已解压文件，第二次启动只请求清单', async () => {
  const source = server();
  const loader = new DictionaryAssetLoader({ indexedDB: new IDBFactory(), fetch: source.fetchFn });
  const first = await loader.loadAll(BASE);
  assert.equal(first.revision, 'r1');
  assert.equal(Buffer.from(first.files.get('base.dat.gz')).toString(), FILE_A.toString());
  await loader.whenCached();

  const requestsBefore = source.requests.length;
  const second = await loader.loadAll(BASE);
  assert.equal(second.revision, 'r1');
  assert.equal(Buffer.from(second.files.get('readings.json.gz')).toString(), FILE_B.toString());
  assert.deepEqual(source.requests.slice(requestsBefore), [`${BASE}manifest.json`], 'cached files are not downloaded again');
});

test('新 revision 下载失败时继续使用上一版完整缓存', async () => {
  const source = server();
  const loader = new DictionaryAssetLoader({ indexedDB: new IDBFactory(), fetch: source.fetchFn });
  await loader.loadAll(BASE);
  await loader.whenCached();

  source.setManifest(manifestFor('r2'));
  source.setFailDownloads(true);
  const fallback = await loader.loadAll(BASE);
  assert.equal(fallback.revision, 'r1', 'the previous complete revision still works');
  assert.equal(Buffer.from(fallback.files.get('base.dat.gz')).toString(), FILE_A.toString());
});

test('缺少 manifest 时返回 null，让调用方使用原 gzip 加载', async () => {
  const loader = new DictionaryAssetLoader({
    cache: false,
    fetch: async () => new Response('missing', { status: 404 }),
  });
  assert.equal(await loader.loadAll(BASE), null);
});

test('缓存中任一文件缺失时不会误判为命中', async () => {
  const source = server();
  const factory = new IDBFactory();
  const loader = new DictionaryAssetLoader({ indexedDB: factory, fetch: source.fetchFn });
  await loader.loadAll(BASE);
  await loader.whenCached();

  await new Promise((resolve, reject) => {
    const request = factory.open('uku-dictionary-assets', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete('file:r1\u0000base.dat.gz');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });

  const requestsBefore = source.requests.length;
  const reloaded = await loader.loadAll(BASE);
  assert.equal(Buffer.from(reloaded.files.get('base.dat.gz')).toString(), FILE_A.toString());
  assert.ok(source.requests.slice(requestsBefore).some(url => url.endsWith('base.dat.br')), 'the missing file is fetched again');
});
