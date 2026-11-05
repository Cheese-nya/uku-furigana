import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { loadTypescript } from './loadTypescript.mjs';

const { decompressAsset, fetchCompressedBytes, fetchCompressedJson, brotliSibling } = loadTypescript(
  '../app/utils/compressedAsset.ts',
);

const response = (bytes, init = {}) => new Response(bytes, { status: 200, ...init });

// Node's CompressionStream does not know Brotli; emulate the Chromium 116+ stream so the
// preferred path is exercised here as well as in the browser.
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

test('gzip bytes are only inflated when they still carry the gzip signature', async () => {
  const text = JSON.stringify({ hello: '世界' });
  const gz = zlib.gzipSync(Buffer.from(text));
  assert.equal(Buffer.from(await decompressAsset(gz, 'gzip')).toString(), text);
  const plain = Buffer.from(text);
  assert.equal(Buffer.from(await decompressAsset(plain, 'gzip')).toString(), text);
  const unchanged = await decompressAsset(gz, 'gzip', true);
  assert.deepEqual(Buffer.from(unchanged), gz);
});

test('fetchCompressedBytes prefers Brotli and falls back to gzip when it 404s', async () => {
  const text = 'dictionary payload';
  const raw = Buffer.from(text);
  const gz = zlib.gzipSync(raw);
  const requested = [];
  const fetchFn = async url => {
    requested.push(url);
    if (url.endsWith('.br')) return new Response('missing', { status: 404 });
    return response(gz);
  };
  const bytes = await fetchCompressedBytes({ brotli: '/dict/a.br', gzip: '/dict/a.gz' }, fetchFn, { expectedSize: raw.byteLength });
  assert.equal(Buffer.from(bytes).toString(), text);
  assert.deepEqual(requested, ['/dict/a.br', '/dict/a.gz']);
  await assert.rejects(
    () => fetchCompressedBytes({ gzip: '/dict/a.gz' }, fetchFn, { expectedSize: raw.byteLength + 1 }),
    /大小不符/,
  );
});

test('fetchCompressedJson uses Brotli when available and does not double-decompress a decoded body', async () => {
  const value = { terms: ['読む'], count: 1 };
  const br = zlib.brotliCompressSync(Buffer.from(JSON.stringify(value)));
  const fetchFn = async () => response(br);
  assert.deepEqual(await fetchCompressedJson({ brotli: '/a.br', gzip: '/a.gz' }, fetchFn), value);
  const decodedFn = async () => response(JSON.stringify(value), { headers: { 'content-encoding': 'br' } });
  assert.deepEqual(await fetchCompressedJson({ brotli: '/a.br', gzip: '/a.gz' }, decodedFn), value);
});

test('missing sibling helper only changes .gz names', () => {
  assert.equal(brotliSibling('/dict/base.dat.gz'), '/dict/base.dat.br');
  assert.equal(brotliSibling('/dict/readings.json'), '/dict/readings.json.br');
});
