import { brotliSibling, fetchCompressedJson } from './compressedAsset';
import { type CompactEntry, readYomitanZip } from './yomitanFormat';

export interface DictEntry {
  dict: string;
  term: string;
  reading: string;
  tags: string[];
  glosses: string[];
  examples: [string, string][];
  score: number;
}

export interface DictionaryRecord {
  id: string;
  title: string;
  revision: string;
  attribution: string;
  license?: string;
  enabled: boolean;
  order: number;
  builtin: boolean;
  count: number;
}

export interface DictionaryStoreOptions {
  indexedDB?: IDBFactory;
  fetch?: typeof fetch;
}

interface BuiltinManifest {
  id: string;
  title?: string;
  revision?: string;
  attribution?: string;
  license?: string;
  count?: number;
  shards?: string[];
  brotliBaseUrl?: string;
  brotliShards?: Record<string, string>;
}

const DB_NAME = 'uku-lookup';
// v2 adds a staging store: a download/upgrade writes there and moves into `terms` in one
// transaction, so an interrupted install can never leave a half dictionary looking ready.
const DB_VERSION = 2;
const DICT_STORE = 'dictionaries';
const TERM_STORE = 'terms';
const STAGING_STORE = 'terms-staging';
const BATCH_SIZE = 2000;
const SHARD_CONCURRENCY = 4;

export class DictionaryStore {
  private readonly idbFactory?: IDBFactory;
  private readonly fetchFn?: typeof fetch;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: DictionaryStoreOptions = {}) {
    this.idbFactory =
      options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    this.fetchFn =
      options.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (!this.idbFactory) {
      return Promise.reject(new Error('当前环境不支持离线词典存储'));
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.idbFactory!.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DICT_STORE)) {
          db.createObjectStore(DICT_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(TERM_STORE)) {
          const terms = db.createObjectStore(TERM_STORE, { autoIncrement: true });
          terms.createIndex('term', 'term', { unique: false });
          terms.createIndex('reading', 'reading', { unique: false });
          terms.createIndex('dict', 'dict', { unique: false });
        }
        if (!db.objectStoreNames.contains(STAGING_STORE)) {
          db.createObjectStore(STAGING_STORE, { autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error ?? new Error('无法打开词典数据库'));
      };
    });

    return this.dbPromise;
  }

  async list(): Promise<DictionaryRecord[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORE, 'readonly');
      const req = tx.objectStore(DICT_STORE).getAll();
      req.onsuccess = () => {
        const items = ((req.result as DictionaryRecord[]) || []).slice();
        items.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORE, 'readwrite');
      const store = tx.objectStore(DICT_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result as DictionaryRecord | undefined;
        if (rec) {
          rec.enabled = Boolean(on);
          store.put(rec);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async setOrder(ids: string[]): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORE, 'readwrite');
      const store = tx.objectStore(DICT_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as DictionaryRecord[]) || [];
        const byId = new Map(all.map((d) => [d.id, d]));
        let order = 0;
        const seen = new Set<string>();
        for (const id of ids) {
          const rec = byId.get(id);
          if (rec && !seen.has(id)) {
            seen.add(id);
            rec.order = order++;
            store.put(rec);
          }
        }
        all
          .filter((d) => !seen.has(d.id))
          .sort((a, b) => a.order - b.order)
          .forEach((rec) => {
            rec.order = order++;
            store.put(rec);
          });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private clearTermsForDict(db: IDBDatabase, dictId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TERM_STORE, 'readwrite');
      const index = tx.objectStore(TERM_STORE).index('dict');
      const req = index.openCursor(dictId);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.openDb();
    await this.clearTermsForDict(db, id);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORE, 'readwrite');
      tx.objectStore(DICT_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async insertCompactEntries(
    db: IDBDatabase,
    dictId: string,
    entries: CompactEntry[],
    startCount: number,
    totalCount: number,
    onProgress?: (fraction: number) => void,
    storeName = TERM_STORE,
  ): Promise<number> {
    let inserted = startCount;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const [term, reading, tags, glosses, examples, score] of batch) {
          const record: DictEntry = {
            dict: dictId,
            term,
            reading,
            tags,
            glosses,
            examples,
            score,
          };
          store.put(record);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      inserted += batch.length;
      if (onProgress && totalCount > 0) {
        onProgress(Math.min(0.99, inserted / totalCount));
      }
    }
    return inserted;
  }

  private putDictionaryRecord(db: IDBDatabase, record: DictionaryRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORE, 'readwrite');
      tx.objectStore(DICT_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private clearStaging(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, 'readwrite');
      tx.objectStore(STAGING_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private shardUrls(prefix: string, manifest: BuiltinManifest, shard: string): { gzip: string; brotli?: string } {
    const gzip = `${prefix}${shard}`;
    const explicit = manifest.brotliShards?.[shard];
    if (typeof explicit === 'string' && explicit) {
      const brotli = /^(?:[a-z]+:)?\//i.test(explicit) ? explicit : `${prefix}${explicit.replace(/^\.?\//, '')}`;
      return { gzip, brotli };
    }
    if (typeof manifest.brotliBaseUrl === 'string' && manifest.brotliBaseUrl) {
      const base = manifest.brotliBaseUrl.endsWith('/') ? manifest.brotliBaseUrl : `${manifest.brotliBaseUrl}/`;
      return { gzip, brotli: `${prefix}${base.replace(/^\.?\//, '')}${brotliSibling(shard)}` };
    }
    return { gzip };
  }

  private async fetchShard(
    prefix: string,
    manifest: BuiltinManifest,
    shard: string,
  ): Promise<CompactEntry[]> {
    if (!this.fetchFn) throw new Error('当前环境不支持网络请求');
    const rows = await fetchCompressedJson<unknown>(this.shardUrls(prefix, manifest, shard), this.fetchFn);
    if (!Array.isArray(rows)) throw new Error(`词典分片格式错误：${shard}`);
    return rows as CompactEntry[];
  }

  /**
   * Downloads up to four shards ahead while inserting them in their original order, so entries
   * stay grouped by the source's sorted shard order and network waits overlap.
   */
  private async installShards(
    db: IDBDatabase,
    dictId: string,
    prefix: string,
    manifest: BuiltinManifest,
    shards: string[],
    expectedTotal: number,
    onProgress?: (fraction: number) => void,
  ): Promise<number> {
    const pending = new Map<number, Promise<CompactEntry[]>>();
    const prefetch = (index: number) => {
      if (index >= shards.length || pending.has(index)) return;
      const task = this.fetchShard(prefix, manifest, shards[index]);
      // Prefetched failures are awaited out of order; mark them handled now so the browser
      // does not report them as unhandled while an earlier shard is still being inserted.
      void task.catch(() => undefined);
      pending.set(index, task);
    };
    for (let i = 0; i < Math.min(SHARD_CONCURRENCY, shards.length); i++) prefetch(i);

    let inserted = 0;
    try {
      for (let i = 0; i < shards.length; i++) {
        const rows = await pending.get(i)!;
        pending.delete(i);
        inserted = await this.insertCompactEntries(
          db,
          dictId,
          rows,
          inserted,
          expectedTotal,
          onProgress,
          STAGING_STORE,
        );
        prefetch(i + SHARD_CONCURRENCY);
      }
    } catch (error) {
      await Promise.allSettled(pending.values());
      throw error;
    }
    return inserted;
  }

  /** Moves all staged rows into `terms` and publishes the metadata in one transaction. */
  private finalizeStaged(db: IDBDatabase, dictId: string, record: DictionaryRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TERM_STORE, STAGING_STORE, DICT_STORE], 'readwrite');
      const terms = tx.objectStore(TERM_STORE);
      const staging = tx.objectStore(STAGING_STORE);
      const dictionaries = tx.objectStore(DICT_STORE);

      const putRecord = () => dictionaries.put(record);
      const moveStaged = () => {
        const request = staging.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            putRecord();
            return;
          }
          terms.put({ ...(cursor.value as DictEntry), dict: dictId });
          cursor.delete();
          cursor.continue();
        };
      };

      const oldTerms = terms.index('dict').openCursor(dictId);
      oldTerms.onsuccess = () => {
        const cursor = oldTerms.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          moveStaged();
        }
      };
      oldTerms.onerror = () => reject(oldTerms.error);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('词典安装事务已中止'));
    });
  }

  async ensureBuiltin(
    baseUrl = '/lookup/ja-zh/',
    onProgress?: (fraction: number) => void,
    /** Place in the dictionary list when it is installed for the first time. */
    order = 0,
  ): Promise<DictionaryRecord> {
    if (!this.fetchFn) {
      throw new Error('当前环境不支持网络请求');
    }
    const db = await this.openDb();
    const prefix = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const indexRes = await this.fetchFn(`${prefix}index.json`, { cache: 'no-cache' });
    if (!indexRes.ok) {
      throw new Error('词典加载失败');
    }
    const manifest = (await indexRes.json()) as BuiltinManifest;
    const dictId = manifest.id || 'wty-ja-zh';
    const revision = String(manifest.revision || '');
    const shards = Array.isArray(manifest.shards) ? manifest.shards.filter((name): name is string => typeof name === 'string') : [];
    if (!shards.length) throw new Error('词典没有可加载的分片');

    const expectedCount =
      typeof manifest.count === 'number' && Number.isFinite(manifest.count) && manifest.count > 0
        ? Math.round(manifest.count)
        : null;
    const expectedTotal = expectedCount ?? shards.length * 20_000;

    const existingList = await this.list();
    const existing = existingList.find((d) => d.id === dictId);
    if (
      existing &&
      existing.count > 0 &&
      existing.revision === revision &&
      (expectedCount === null || existing.count === expectedCount)
    ) {
      onProgress?.(1);
      return existing;
    }

    // A previous attempt may have been interrupted after staging some shards. The live terms
    // and metadata are untouched until finalize, so clearing staging is always safe.
    await this.clearStaging(db);
    let inserted = 0;
    try {
      inserted = await this.installShards(db, dictId, prefix, manifest, shards, expectedTotal, onProgress);
      if (expectedCount !== null && inserted !== expectedCount) {
        throw new Error(`词典条目数不符：期望 ${expectedCount}，实际 ${inserted}`);
      }
      const record: DictionaryRecord = {
        id: dictId,
        title: manifest.title || '日中词典（维基词典）',
        revision,
        attribution: manifest.attribution || '',
        license: manifest.license,
        enabled: existing ? existing.enabled : true,
        order: existing ? existing.order : order,
        builtin: true,
        count: inserted,
      };
      onProgress?.(0.99);
      await this.finalizeStaged(db, dictId, record);
      onProgress?.(1);
      return record;
    } catch (error) {
      await this.clearStaging(db).catch(() => undefined);
      throw error;
    }
  }

  async importZip(
    data: ArrayBuffer,
    onProgress?: (fraction: number) => void,
  ): Promise<DictionaryRecord> {
    const parsed = await readYomitanZip(data);
    const db = await this.openDb();
    const existing = await this.list();
    const maxOrder = existing.reduce((max, d) => Math.max(max, d.order), -1);
    const id = `user-${Date.now()}`;

    await this.insertCompactEntries(
      db,
      id,
      parsed.entries,
      0,
      parsed.entries.length,
      onProgress,
    );

    // A Japanese–Chinese dictionary the user brings (e.g. 明鏡) replaces the bundled Wiktionary one: it goes
    // first and the bundled ja-zh is switched off. Other dictionaries join at the end.
    const chinese = /^zh/i.test(parsed.targetLanguage);
    const record: DictionaryRecord = {
      id,
      title: parsed.title || id,
      revision: parsed.revision,
      attribution: parsed.attribution,
      enabled: true,
      order: chinese ? -1 : maxOrder + 1,
      builtin: false,
      count: parsed.entries.length,
    };

    await this.putDictionaryRecord(db, record);
    if (chinese) {
      for (const other of existing) if (other.builtin && other.id === 'wty-ja-zh' && other.enabled) await this.setEnabled(other.id, false);
      await this.setOrder([id, ...existing.map((d) => d.id)]);
    }
    onProgress?.(1);
    return record;
  }

  async find(terms: string[]): Promise<DictEntry[]> {
    const uniqueTerms = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
    if (uniqueTerms.length === 0) return [];

    const dicts = await this.list();
    const enabledOrder = new Map<string, number>();
    for (const d of dicts) {
      if (d.enabled) enabledOrder.set(d.id, d.order);
    }
    if (enabledOrder.size === 0) return [];

    const db = await this.openDb();
    const results = await new Promise<DictEntry[]>((resolve, reject) => {
      const tx = db.transaction(TERM_STORE, 'readonly');
      const store = tx.objectStore(TERM_STORE);
      const termIndex = store.index('term');
      const readingIndex = store.index('reading');
      const seenKeys = new Set<string>();
      const collected: DictEntry[] = [];

      const collectFromIndex = (index: IDBIndex, query: string) => {
        const req = index.openCursor(query);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const val = cursor.value as DictEntry;
          if (enabledOrder.has(val.dict)) {
            const pk =
              cursor.primaryKey !== undefined
                ? String(cursor.primaryKey)
                : `${val.dict}\0${val.term}\0${val.reading}\0${val.glosses.join('\t')}`;
            if (!seenKeys.has(pk)) {
              seenKeys.add(pk);
              collected.push({
                dict: val.dict,
                term: val.term,
                reading: val.reading,
                tags: val.tags,
                glosses: val.glosses,
                examples: val.examples,
                score: val.score,
              });
            }
          }
          cursor.continue();
        };
      };

      for (const q of uniqueTerms) {
        collectFromIndex(termIndex, q);
        collectFromIndex(readingIndex, q);
      }

      tx.oncomplete = () => resolve(collected);
      tx.onerror = () => reject(tx.error);
    });

    results.sort((a, b) => {
      const orderDiff = (enabledOrder.get(a.dict) ?? 0) - (enabledOrder.get(b.dict) ?? 0);
      if (orderDiff !== 0) return orderDiff;
      if (b.score !== a.score) return b.score - a.score;
      return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
    });

    return results;
  }
}
