import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { IDBFactory } from 'fake-indexeddb';
import { loadTypescript } from './loadTypescript.mjs';

const { DictionaryStore } = loadTypescript('../app/utils/dictionaryStore.ts');

const BASE = 'https://test.local/lookup/ja-zh/';
const entry = (term, reading, score = 0) => [term, reading, [], [`${term} gloss`], [], score];

// Node's CompressionStream does not know Brotli; emulate Chromium 116+ so both asset paths run.
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

function server(manifest, shards) {
  const files = new Map();
  files.set(`${BASE}index.json`, Buffer.from(JSON.stringify(manifest)));
  for (const [name, rows] of Object.entries(shards)) {
    const raw = Buffer.from(JSON.stringify(rows));
    files.set(`${BASE}${name}`, zlib.gzipSync(raw));
    files.set(`${BASE}${name.replace(/\.gz$/, '.br')}`, zlib.brotliCompressSync(raw));
  }
  const requests = [];
  let active = 0;
  let maxActive = 0;
  const fetchFn = async (url, init) => {
    requests.push({ url, init });
    const body = files.get(url);
    if (!body) return new Response('missing', { status: 404 });
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return new Response(body, { status: 200 });
  };
  return {
    fetchFn,
    requests,
    get maxActive() { return maxActive; },
    set(name, body) {
      if (body === null) files.delete(`${BASE}${name}`);
      else files.set(`${BASE}${name}`, Buffer.from(body));
    },
  };
}

function manifest(revision, shards, count) {
  return {
    id: 'wty-ja-zh',
    title: 'test dictionary',
    revision,
    count,
    shards,
    brotliBaseUrl: 'assets/test/',
    brotliShards: Object.fromEntries(shards.map(name => [name, `assets/test/${name.replace(/\.gz$/, '.br')}`])),
  };
}

function allTerms(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open('uku-lookup', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('terms', 'readonly');
      const get = tx.objectStore('terms').getAll();
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => reject(get.error);
    };
  });
}

test('首次安装走 Brotli、按分片顺序写入；revision 未变时不再下载 shard', async () => {
  const shards = {
    'terms-00.json.gz': [entry('古い', 'ふるい', 5), entry('読む', 'よむ', 3)],
    'terms-01.json.gz': [entry('新しい', 'あたらしい', 1)],
  };
  const source = server(manifest('r1', Object.keys(shards), 3), shards);
  const factory = new IDBFactory();
  const store = new DictionaryStore({ indexedDB: factory, fetch: source.fetchFn });

  const record = await store.ensureBuiltin(BASE);
  assert.equal(record.count, 3);
  assert.equal(record.revision, 'r1');
  assert.ok(source.maxActive >= 2, 'the two shards download concurrently');
  const found = await store.find(['読む', 'よむ']);
  assert.equal(found.length, 1, 'term and reading lookup see the installed rows');
  assert.equal(found[0].term, '読む');
  assert.equal(source.requests.filter(req => req.url.endsWith('.br')).length, 2, 'both shards use Brotli');

  const terms = await allTerms(factory);
  assert.deepEqual(terms.map(row => row.term), ['古い', '読む', '新しい'], 'insertion follows shard order');

  const before = source.requests.length;
  await store.ensureBuiltin(BASE);
  assert.equal(source.requests.length, before + 1, 'only the manifest is revalidated');
  assert.ok(source.requests.at(-1).url.endsWith('index.json'));
});

test('分片失败不破坏旧词典，也不发布新 revision；重试后无重复条目', async () => {
  const oldShards = { 'terms-00.json.gz': [entry('旧語', 'きゅうご')] };
  const source = server(manifest('r1', Object.keys(oldShards), 1), oldShards);
  const factory = new IDBFactory();
  const store = new DictionaryStore({ indexedDB: factory, fetch: source.fetchFn });
  await store.ensureBuiltin(BASE);

  const newShards = {
    'terms-00.json.gz': [entry('新語', 'しんご')],
    'terms-01.json.gz': [entry('失敗', 'しっぱい')],
  };
  const next = manifest('r2', Object.keys(newShards), 2);
  source.set('index.json', JSON.stringify(next));
  const first = Buffer.from(JSON.stringify(newShards['terms-00.json.gz']));
  source.set('terms-00.json.gz', zlib.gzipSync(first));
  source.set('terms-00.json.br', zlib.brotliCompressSync(first));
  source.set('terms-01.json.gz', 'not found'); // this name exists but is not a valid body below
  source.set('terms-01.json.br', 'not found');
  // Replace the second shard with a failing response rather than an invalid payload.
  const failingFetch = async (url, init) => {
    if (url.includes('terms-01')) return new Response('boom', { status: 503 });
    return source.fetchFn(url, init);
  };
  const retrying = new DictionaryStore({ indexedDB: factory, fetch: failingFetch });
  await assert.rejects(() => retrying.ensureBuiltin(BASE), /503/);

  const list = await retrying.list();
  assert.equal(list.length, 1, 'failed upgrade did not publish a second record');
  assert.equal(list[0].revision, 'r1');
  assert.equal((await retrying.find(['旧語'])).length, 1, 'old dictionary remains available');
  assert.equal((await retrying.find(['新語'])).length, 0, 'staged rows are invisible to lookup');

  source.set('terms-01.json.gz', zlib.gzipSync(Buffer.from(JSON.stringify(newShards['terms-01.json.gz']))));
  source.set('terms-01.json.br', zlib.brotliCompressSync(Buffer.from(JSON.stringify(newShards['terms-01.json.gz']))));
  const recovered = new DictionaryStore({ indexedDB: factory, fetch: source.fetchFn });
  const record = await recovered.ensureBuiltin(BASE);
  assert.equal(record.revision, 'r2');
  assert.equal((await recovered.find(['旧語'])).length, 0, 'old rows were replaced atomically');
  assert.equal((await recovered.find(['新語'])).length, 1);
  assert.deepEqual((await allTerms(factory)).map(row => row.term), ['新語', '失敗']);
});

test('count 不符时不发布词典，并保留可重试状态', async () => {
  const shards = { 'terms-00.json.gz': [entry('一', 'いち'), entry('二', 'に')] };
  const source = server(manifest('r1', Object.keys(shards), 3), shards);
  const store = new DictionaryStore({ indexedDB: new IDBFactory(), fetch: source.fetchFn });
  await assert.rejects(() => store.ensureBuiltin(BASE), /条目数不符/);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await store.find(['一']), []);
});

test('Brotli 404 时逐个回退 gzip，仍能完成安装', async () => {
  const shards = { 'terms-00.json.gz': [entry('読む', 'よむ')] };
  const source = server(manifest('r1', Object.keys(shards), 1), shards);
  source.set('terms-00.json.br', null);
  const store = new DictionaryStore({ indexedDB: new IDBFactory(), fetch: source.fetchFn });
  const record = await store.ensureBuiltin(BASE);
  assert.equal(record.count, 1);
  assert.ok(source.requests.some(req => req.url.endsWith('terms-00.json.br')));
  assert.ok(source.requests.some(req => req.url.endsWith('terms-00.json.gz')));
  assert.equal((await store.find(['読む'])).length, 1);
});
