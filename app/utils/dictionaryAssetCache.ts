import { fetchCompressedBytes } from './compressedAsset';

export interface DictionaryAssetEntry {
  brotli: string;
  size: number;
  sha256?: string;
  brotliSize?: number;
}

export interface DictionaryAssetManifest {
  version: number;
  revision: string;
  files: Record<string, DictionaryAssetEntry>;
}

export interface DictionaryAssets {
  revision: string;
  manifest: DictionaryAssetManifest;
  files: Map<string, ArrayBuffer>;
}

export interface DictionaryAssetLoaderOptions {
  indexedDB?: IDBFactory;
  fetch?: typeof fetch;
  /** Cache is on by default when IndexedDB exists; tests and local shells can turn it off. */
  cache?: boolean;
  concurrency?: number;
}

interface StoredManifest {
  key: 'manifest';
  kind: 'manifest';
  revision: string;
  manifest: DictionaryAssetManifest;
}

interface StoredFile {
  key: string;
  kind: 'file';
  revision: string;
  name: string;
  size: number;
  data: ArrayBuffer;
}

type CacheRecord = StoredManifest | StoredFile;

const DB_NAME = 'uku-dictionary-assets';
const DB_VERSION = 1;
const STORE = 'files';
const MANIFEST_KEY = 'manifest';

const normalizeBase = (basePath: string) => `${basePath.replace(/\/$/, '')}/`;
const fileKey = (revision: string, name: string) => `${revision}\u0000${name}`;
const cacheKey = (revision: string, name: string) => `file:${fileKey(revision, name)}`;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function isManifest(value: unknown): value is DictionaryAssetManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DictionaryAssetManifest>;
  return (
    typeof candidate.revision === 'string' &&
    Boolean(candidate.files) &&
    typeof candidate.files === 'object'
  );
}

/**
 * Loads the Kuromoji dictionary files described by public/dict/manifest.json. A complete,
 * revision-matched IndexedDB copy is used without touching the network; otherwise all files are
 * downloaded first and only then written, so a partial install is never treated as a cache hit.
 */
export class DictionaryAssetLoader {
  private readonly idbFactory?: IDBFactory;
  private readonly fetchFn: typeof fetch;
  private readonly useCache: boolean;
  private readonly concurrency: number;
  private readonly loading = new Map<string, Promise<DictionaryAssets | null>>();
  private readonly writes = new Set<Promise<void>>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: DictionaryAssetLoaderOptions = {}) {
    this.idbFactory = options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    this.fetchFn = options.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : fetch);
    this.useCache = (options.cache ?? true) && Boolean(this.idbFactory);
    this.concurrency = Math.max(1, options.concurrency ?? 3);
  }

  loadAll(basePath: string): Promise<DictionaryAssets | null> {
    const prefix = normalizeBase(basePath);
    const existing = this.loading.get(prefix);
    if (existing) return existing;
    const promise = this.loadInternal(prefix);
    this.loading.set(prefix, promise);
    // Deduplicate concurrent consumers only. Keeping the resolved 100 MB map here would double
    // the tokenizer's memory for the lifetime of the page.
    void promise.then(
      () => { if (this.loading.get(prefix) === promise) this.loading.delete(prefix); },
      () => { if (this.loading.get(prefix) === promise) this.loading.delete(prefix); },
    );
    return promise;
  }

  /** Waits for background cache writes; useful for tests and diagnostics, not on the load path. */
  async whenCached(): Promise<void> {
    while (this.writes.size) await Promise.allSettled([...this.writes]);
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.useCache || !this.idbFactory) return Promise.reject(new Error('dictionary cache disabled'));
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.idbFactory!.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('revision', 'revision', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error ?? new Error('无法打开词典缓存'));
      };
    });
    return this.dbPromise;
  }

  private async readCachedManifest(): Promise<DictionaryAssetManifest | null> {
    if (!this.useCache) return null;
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE, 'readonly');
      const record = (await requestResult(tx.objectStore(STORE).get(MANIFEST_KEY))) as CacheRecord | undefined;
      return record?.kind === 'manifest' && isManifest(record.manifest) ? record.manifest : null;
    } catch {
      return null;
    }
  }

  private async readCachedFiles(manifest: DictionaryAssetManifest): Promise<DictionaryAssets | null> {
    if (!this.useCache) return null;
    const names = Object.keys(manifest.files).sort();
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      let completed = false;
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          completed = true;
          resolve();
        };
        tx.onabort = () => reject(tx.error ?? new Error('词典缓存读取已中止'));
      });
      const records = await Promise.all(
        names.map(name => requestResult(store.get(cacheKey(manifest.revision, name))) as Promise<CacheRecord | undefined>),
      );
      await done;
      if (!completed) return null;
      const files = new Map<string, ArrayBuffer>();
      for (let i = 0; i < names.length; i++) {
        const record = records[i];
        if (record?.kind !== 'file' || record.revision !== manifest.revision) return null;
        if (record.size !== manifest.files[names[i]].size || record.data.byteLength !== record.size) return null;
        files.set(names[i], record.data);
      }
      return { revision: manifest.revision, manifest, files };
    } catch {
      return null;
    }
  }

  private async fetchManifest(prefix: string): Promise<DictionaryAssetManifest | null> {
    const response = await this.fetchFn(`${prefix}manifest.json`, { cache: 'no-cache' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`词典清单加载失败：${response.status}`);
    const value = (await response.json()) as unknown;
    if (!isManifest(value) || value.version !== 1) return null;
    return value;
  }

  private async download(prefix: string, manifest: DictionaryAssetManifest): Promise<DictionaryAssets> {
    const names = Object.keys(manifest.files).sort();
    const files = new Map<string, ArrayBuffer>();
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= names.length) return;
        const name = names[index];
        const entry = manifest.files[name];
        const relative = entry.brotli.startsWith('/') || /^[a-z]+:/i.test(entry.brotli)
          ? entry.brotli
          : `${prefix}${entry.brotli.replace(/^\.?\//, '')}`;
        const bytes = await fetchCompressedBytes(
          { brotli: relative, gzip: `${prefix}${name}` },
          this.fetchFn,
          { expectedSize: entry.size },
        );
        files.set(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, names.length) }, worker));
    return { revision: manifest.revision, manifest, files };
  }

  private async writeCache(assets: DictionaryAssets): Promise<void> {
    if (!this.useCache) return;
    const db = await this.openDb();
    for (const name of Object.keys(assets.manifest.files).sort()) {
      const data = assets.files.get(name);
      if (!data) continue;
      const record: StoredFile = {
        key: cacheKey(assets.revision, name),
        kind: 'file',
        revision: assets.revision,
        name,
        size: data.byteLength,
        data,
      };
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    const meta: StoredManifest = {
      key: MANIFEST_KEY,
      kind: 'manifest',
      revision: assets.revision,
      manifest: assets.manifest,
    };
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(meta);
    // Old revisions stay readable until the complete new set and its manifest are committed.
    const stale = store.index('revision').openCursor();
    stale.onsuccess = () => {
      const cursor = stale.result;
      if (cursor) {
        if ((cursor.value as CacheRecord).revision !== assets.revision) cursor.delete();
        cursor.continue();
      }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private queueCacheWrite(assets: DictionaryAssets): void {
    const write = this.writeCache(assets)
      .catch(error => console.warn('词典缓存写入失败，下次仍会重新加载：', error))
      .finally(() => this.writes.delete(write));
    this.writes.add(write);
  }

  private async loadInternal(prefix: string): Promise<DictionaryAssets | null> {
    // Node tests and file:// desktop shells cannot resolve this fetch; keep the stock loader.
    const protocol = (globalThis as { window?: { location?: { protocol?: string } } }).window?.location?.protocol;
    if (
      prefix.startsWith('./') ||
      protocol === 'file:' ||
      (!/^(?:[a-z]+:)?\/\//i.test(prefix) && typeof window === 'undefined' && typeof self === 'undefined')
    ) {
      return null;
    }
    const cachedManifest = await this.readCachedManifest();
    let manifest: DictionaryAssetManifest | null = null;
    try {
      manifest = await this.fetchManifest(prefix);
    } catch (error) {
      if (cachedManifest) {
        const cached = await this.readCachedFiles(cachedManifest);
        if (cached) return cached;
      }
      console.warn('词典清单获取失败，使用原 gzip 加载：', error);
      return null;
    }

    if (!manifest) {
      // New app against an older static deployment: fall back to the plain gzip loader.
      if (cachedManifest) {
        const cached = await this.readCachedFiles(cachedManifest);
        if (cached) return cached;
      }
      return null;
    }

    const cached = await this.readCachedFiles(manifest);
    if (cached) return cached;

    try {
      const assets = await this.download(prefix, manifest);
      this.queueCacheWrite(assets);
      return assets;
    } catch (error) {
      // A failed new revision must not discard the previous complete cache.
      if (cachedManifest && cachedManifest.revision !== manifest.revision) {
        const fallback = await this.readCachedFiles(cachedManifest);
        if (fallback) {
          console.warn('新词典加载失败，继续使用上一版缓存：', error);
          return fallback;
        }
      }
      throw error;
    }
  }
}

let sharedLoader: DictionaryAssetLoader | null = null;
const shared = () => (sharedLoader ??= new DictionaryAssetLoader());

/** The worker and fallback engine share this loader so the reading table and tokenizer download once. */
export function loadDictionaryAssets(basePath: string): Promise<DictionaryAssets | null> {
  return shared().loadAll(basePath);
}

export async function readDictionaryAsset(basePath: string, name: string): Promise<ArrayBuffer | null> {
  const assets = await loadDictionaryAssets(basePath);
  return assets?.files.get(name) ?? null;
}

export function waitForDictionaryCache(): Promise<void> {
  return shared().whenCached();
}
