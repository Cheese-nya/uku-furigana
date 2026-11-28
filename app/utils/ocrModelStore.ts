import { getPlatform } from './appInfo';
import { throwIfAborted } from './importErrors';

export type OcrModelKey = 'deim' | 'parseq30' | 'parseq50' | 'parseq100';

export interface OcrManifestFileEntry {
  key: OcrModelKey | 'config';
  size: number;
  sha256: string;
}

export interface OcrModelManifest {
  version: number;
  revision: string;
  files: Record<string, OcrManifestFileEntry>;
}

export interface OcrConfigData {
  classes: string[];
  markdown: Record<string, string>;
  charset: string[];
}

export interface OcrModelCacheStatus {
  bundled: boolean;
  cached: boolean;
  cachedBytes: number;
}

export interface OcrModelLoaderOptions {
  indexedDB?: IDBFactory;
  fetch?: typeof fetch;
  /** Override bundled detection (tests). When true, skips IndexedDB to avoid duplicating bundled models. */
  bundled?: boolean;
}

interface StoredManifestRecord {
  key: 'manifest';
  kind: 'manifest';
  revision: string;
  manifest: OcrModelManifest;
}

interface StoredModelRecord {
  key: string;
  kind: 'file';
  revision: string;
  name: string;
  size: number;
  sha256: string;
  data: ArrayBuffer;
}

type CacheRecord = StoredManifestRecord | StoredModelRecord;

const DB_NAME = 'uku-ocr-models';
const DB_VERSION = 1;
const STORE = 'files';
const MANIFEST_KEY = 'manifest';

const normalizeBase = (basePath: string) => `${basePath.replace(/\/$/, '')}/`;
const fileCacheKey = (revision: string, name: string) => `file:${revision}\u0000${name}`;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function isBundledRuntime(): boolean {
  return getPlatform() !== 'web';
}

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

async function readResponseWithProgress(
  response: Response,
  expectedSize: number,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const buf = await response.arrayBuffer();
    throwIfAborted(signal);
    onProgress?.(buf.byteLength, expectedSize || buf.byteLength);
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, expectedSize || loaded);
      }
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel error when aborting stream.
    }
    throw error;
  }
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

/**
 * Loads NDLOCR-Lite model binaries and config from `./vendor/ndlocr-lite/`.
 * On bundled native/desktop shells (`desktop`, `android`, `ios`), reads directly from local
 * bundle assets without copying ~150 MB into IndexedDB. On `web`, verifies SHA-256 and caches
 * downloaded models in IndexedDB for offline reuse.
 */
export class OcrModelStore {
  private readonly idbFactory?: IDBFactory;
  private readonly fetchFn: typeof fetch;
  private readonly bundled: boolean;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private manifestCache = new Map<string, OcrModelManifest>();

  constructor(options: OcrModelLoaderOptions = {}) {
    this.idbFactory = options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    this.fetchFn = options.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : fetch);
    this.bundled = options.bundled ?? isBundledRuntime();
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.idbFactory) return Promise.reject(new Error('IndexedDB unavailable'));
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
        reject(request.error ?? new Error('Failed to open OCR model cache'));
      };
    });
    return this.dbPromise;
  }

  async loadManifest(basePath: string, signal?: AbortSignal): Promise<OcrModelManifest> {
    const prefix = normalizeBase(basePath);
    const cached = this.manifestCache.get(prefix);
    if (cached) return cached;

    throwIfAborted(signal);
    const res = await this.fetchFn(`${prefix}manifest.json`, { cache: 'no-cache', signal });
    if (!res.ok) {
      throw new Error(`OCR model manifest load failed: HTTP ${res.status}`);
    }
    const manifest = (await res.json()) as OcrModelManifest;
    if (!manifest || manifest.version !== 1 || typeof manifest.revision !== 'string' || !manifest.files) {
      throw new Error('Invalid OCR model manifest');
    }
    this.manifestCache.set(prefix, manifest);
    return manifest;
  }

  private findFileName(manifest: OcrModelManifest, key: OcrModelKey | 'config'): { name: string; entry: OcrManifestFileEntry } {
    for (const [name, entry] of Object.entries(manifest.files)) {
      if (entry.key === key) return { name, entry };
    }
    throw new Error(`OCR model file for key "${key}" missing in manifest`);
  }

  private async readCachedFile(revision: string, name: string, entry: OcrManifestFileEntry): Promise<ArrayBuffer | null> {
    if (this.bundled || !this.idbFactory) return null;
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE, 'readonly');
      const record = (await requestResult(tx.objectStore(STORE).get(fileCacheKey(revision, name)))) as CacheRecord | undefined;
      if (
        record?.kind === 'file' &&
        record.revision === revision &&
        record.size === entry.size &&
        record.data.byteLength === entry.size &&
        record.sha256 === entry.sha256
      ) {
        return record.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeCachedFile(manifest: OcrModelManifest, name: string, entry: OcrManifestFileEntry, data: ArrayBuffer): Promise<void> {
    if (this.bundled || !this.idbFactory) return;
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const record: StoredModelRecord = {
        key: fileCacheKey(manifest.revision, name),
        kind: 'file',
        revision: manifest.revision,
        name,
        size: data.byteLength,
        sha256: entry.sha256,
        data,
      };
      const meta: StoredManifestRecord = {
        key: MANIFEST_KEY,
        kind: 'manifest',
        revision: manifest.revision,
        manifest,
      };
      store.put(record);
      store.put(meta);
      const stale = store.index('revision').openCursor();
      stale.onsuccess = () => {
        const cursor = stale.result;
        if (cursor) {
          if ((cursor.value as CacheRecord).revision !== manifest.revision) cursor.delete();
          cursor.continue();
        }
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // Cache write failure is non-fatal; runtime still has the loaded bytes.
    }
  }

  async loadAsset(
    basePath: string,
    key: OcrModelKey | 'config',
    options: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<ArrayBuffer> {
    const prefix = normalizeBase(basePath);
    const manifest = await this.loadManifest(prefix, options.signal);
    const { name, entry } = this.findFileName(manifest, key);

    const cached = await this.readCachedFile(manifest.revision, name, entry);
    if (cached) {
      options.onProgress?.(entry.size, entry.size);
      return cached;
    }

    throwIfAborted(options.signal);
    const res = await this.fetchFn(`${prefix}${name}`, { signal: options.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch OCR asset ${name}: HTTP ${res.status}`);
    }
    const data = await readResponseWithProgress(res, entry.size, options.onProgress, options.signal);
    if (data.byteLength !== entry.size) {
      throw new Error(`OCR asset ${name} size mismatch: expected ${entry.size}, got ${data.byteLength}`);
    }
    if (!this.bundled && entry.sha256) {
      const digest = await computeSha256Hex(data);
      if (digest && digest !== entry.sha256) {
        throw new Error(`OCR asset ${name} checksum mismatch`);
      }
    }
    await this.writeCachedFile(manifest, name, entry, data);
    return data;
  }

  async loadConfig(basePath: string, signal?: AbortSignal): Promise<OcrConfigData> {
    const buf = await this.loadAsset(basePath, 'config', { signal });
    const text = new TextDecoder('utf-8').decode(buf);
    const parsed = JSON.parse(text) as OcrConfigData;
    if (!Array.isArray(parsed.classes) || !Array.isArray(parsed.charset)) {
      throw new Error('Invalid NDL OCR config payload');
    }
    return parsed;
  }

  async getStatus(): Promise<OcrModelCacheStatus> {
    if (this.bundled) return { bundled: true, cached: true, cachedBytes: 0 };
    if (!this.idbFactory) return { bundled: false, cached: false, cachedBytes: 0 };
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const manifestRec = (await requestResult(store.get(MANIFEST_KEY))) as StoredManifestRecord | undefined;
      if (!manifestRec || manifestRec.kind !== 'manifest') {
        return { bundled: false, cached: false, cachedBytes: 0 };
      }
      const entries = Object.entries(manifestRec.manifest.files);
      const records = await Promise.all(
        entries.map(([name]) => requestResult(store.get(fileCacheKey(manifestRec.revision, name))) as Promise<CacheRecord | undefined>),
      );
      let cachedBytes = 0;
      let allPresent = true;
      for (const rec of records) {
        if (rec?.kind === 'file') cachedBytes += rec.size;
        else allPresent = false;
      }
      return { bundled: false, cached: allPresent, cachedBytes };
    } catch {
      return { bundled: false, cached: false, cachedBytes: 0 };
    }
  }

  async clearCache(): Promise<void> {
    this.manifestCache.clear();
    if (!this.idbFactory) return;
    try {
      const db = await this.openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // Ignore clear failures.
    }
  }
}

let sharedStore: OcrModelStore | null = null;
export const getOcrModelStore = () => (sharedStore ??= new OcrModelStore());
