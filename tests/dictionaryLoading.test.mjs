import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const json = path => JSON.parse(read(path));
const assetPath = path => fileURLToPath(new URL(path, import.meta.url));

const annotationClient = read('../app/utils/annotationClient.ts');
const kuromojiEngine = read('../app/utils/kuromojiEngine.ts');
const kuromojiLoader = read('../app/utils/kuromojiLoader.ts');
const dictionaryStore = read('../app/utils/dictionaryStore.ts');
const assetCache = read('../app/utils/dictionaryAssetCache.ts');

test('慢网不会被 60 秒超时打断后重新下载', () => {
  assert.equal(annotationClient.includes('60000'), false);
  assert.equal(annotationClient.includes('加载超时'), false);
  assert.equal(kuromojiEngine.includes('加载超时'), false);
  assert.equal(kuromojiEngine.includes('setTimeout'), false);
  assert.ok(annotationClient.includes("startFallback('异步注音线程不可用')"), 'worker crash still degrades');
});

test('Kuromoji 使用预加载缓存，原生解压并行、旧 zlib 回退仍串行', () => {
  assert.ok(kuromojiLoader.includes('primeKuromojiDictionary'));
  assert.ok(kuromojiLoader.includes('releasePrimedKuromojiDictionary'));
  assert.ok(kuromojiLoader.includes('stockQueue'), 'zlibjs fallback stays memory-bounded');
  assert.ok(kuromojiEngine.includes('loadDictionaryAssets'));
  assert.ok(kuromojiLoader.includes('queueMicrotask'), 'cached buffers are handed back asynchronously');
});

test('点词词典并发安装、staging 与 gzip 兼容字段都在', () => {
  assert.ok(dictionaryStore.includes('SHARD_CONCURRENCY'));
  assert.ok(dictionaryStore.includes('STAGING_STORE'));
  assert.ok(dictionaryStore.includes('brotliShards'));
  assert.ok(dictionaryStore.includes('finalizeStaged'));
  assert.ok(assetCache.includes('manifest.json'));
  assert.ok(assetCache.includes('readCachedFiles'));
});

test('提交的 Brotli 资产与 manifest/index 一致，原 gzip 字段未删除', () => {
  const dict = json('../public/dict/manifest.json');
  assert.equal(dict.version, 1);
  assert.ok(dict.revision);
  assert.ok(existsSync(assetPath(`../public/dict/${dict.files['base.dat.gz'].brotli}`)));
  for (const [name, entry] of Object.entries(dict.files)) {
    assert.ok(existsSync(assetPath(`../public/dict/${entry.brotli}`)), `${name} Brotli exists`);
    assert.equal(statSync(assetPath(`../public/dict/${entry.brotli}`)).size, entry.brotliSize);
  }

  for (const name of ['ja-zh', 'ja-en']) {
    const index = json(`../public/lookup/${name}/index.json`);
    assert.ok(Array.isArray(index.shards) && index.shards.length > 0, `${name} keeps old gzip shards`);
    assert.ok(index.brotliBaseUrl);
    for (const shard of index.shards) {
      const brotli = index.brotliShards[shard];
      assert.ok(brotli, `${name}/${shard} has Brotli`);
      assert.ok(existsSync(assetPath(`../public/lookup/${name}/${brotli}`)));
    }
  }
});
