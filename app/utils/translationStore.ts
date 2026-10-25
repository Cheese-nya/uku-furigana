const DB_NAME = 'uku-translations';
const DB_VERSION = 1;
const STORE_NAME = 'sentences';
const BOOK_INDEX = 'book';

export interface TranslationRecord {
  bookId: string;
  target: string;
  text: string;
  translation: string;
  engine: string;
  at: number;
}

/** Cache of per-sentence translations, keyed by book, target language and source sentence.
 * `TranslationStore` (IndexedDB) and `MemoryTranslationStore` both implement it.
 */
export interface TranslationCache {
  get(bookId: string, target: string, texts: string[]): Promise<Map<string, string>>;
  put(bookId: string, target: string, engine: string, pairs: [string, string][]): Promise<void>;
  count(bookId: string, target: string, texts: string[]): Promise<number>;
  clearBook(bookId: string): Promise<void>;
}

interface IndexedDbFactory {
  open(name: string, version?: number): IDBOpenDBRequest;
}

/** Either the factory itself or a getter for it (so a test can swap the global later). */
type IndexedDbSource = IndexedDbFactory | (() => IndexedDbFactory | undefined);

function resolveFactory(source?: IndexedDbSource): IndexedDbFactory | undefined {
  if (!source) return globalIndexedDb();
  const factory = typeof source === 'function' ? source() : source;
  return factory && typeof factory.open === 'function' ? factory : undefined;
}

function globalIndexedDb(): IndexedDbFactory | undefined {
  const factory = (globalThis as { indexedDB?: IndexedDbFactory }).indexedDB;
  return factory && typeof factory.open === 'function' ? factory : undefined;
}

function openDb(factory: IndexedDbFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) return;
      // The array keyPath makes [bookId, target, text] the primary key, so a re-translated
      // sentence overwrites its old row instead of piling up duplicates.
      const store = db.createObjectStore(STORE_NAME, { keyPath: ['bookId', 'target', 'text'] });
      store.createIndex(BOOK_INDEX, 'bookId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('译文数据库打开失败'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('译文数据库读取失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('译文数据库写入失败'));
    transaction.onabort = () => reject(transaction.error || new Error('译文数据库写入失败'));
  });
}

/** In-memory cache with the same surface as the IndexedDB one: used in tests, and as the
 * floor the IndexedDB store falls back to where there is no database.
 */
export class MemoryTranslationStore implements TranslationCache {
  private readonly rows = new Map<string, TranslationRecord>();

  private static key(bookId: string, target: string, text: string): string {
    return JSON.stringify([bookId, target, text]);
  }

  async get(bookId: string, target: string, texts: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const text of texts) {
      const record = this.rows.get(MemoryTranslationStore.key(bookId, target, text));
      if (record) found.set(text, record.translation);
    }
    return found;
  }

  async put(bookId: string, target: string, engine: string, pairs: [string, string][]): Promise<void> {
    const at = Date.now();
    for (const [text, translation] of pairs) {
      const record: TranslationRecord = { bookId, target, text, translation, engine, at };
      this.rows.set(MemoryTranslationStore.key(bookId, target, text), record);
    }
  }

  async count(bookId: string, target: string, texts: string[]): Promise<number> {
    return (await this.get(bookId, target, texts)).size;
  }

  async clearBook(bookId: string): Promise<void> {
    for (const [key, record] of this.rows) if (record.bookId === bookId) this.rows.delete(key);
  }
}

/** IndexedDB cache. Each operation closes its connection, as `libraryStorage` does. The
 * database factory is injectable; where none is available the object serves an in-memory
 * cache instead, so a caller never has to branch on the environment.
 */
export class TranslationStore implements TranslationCache {
  private readonly source: IndexedDbSource | undefined;
  private readonly memory = new MemoryTranslationStore();

  constructor(source?: IndexedDbSource) {
    this.source = source;
  }

  private async open(): Promise<IDBDatabase | undefined> {
    const factory = resolveFactory(this.source);
    return factory ? openDb(factory) : undefined;
  }

  async get(bookId: string, target: string, texts: string[]): Promise<Map<string, string>> {
    if (!texts.length) return new Map();
    const db = await this.open();
    if (!db) return this.memory.get(bookId, target, texts);
    try {
      const found = new Map<string, string>();
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
      const records = await Promise.all(texts.map(text => requestResult(
        store.get([bookId, target, text]) as IDBRequest<TranslationRecord | undefined>)));
      for (const record of records) {
        if (record && typeof record.translation === 'string') found.set(record.text, record.translation);
      }
      return found;
    } finally {
      db.close();
    }
  }

  async put(bookId: string, target: string, engine: string, pairs: [string, string][]): Promise<void> {
    if (!pairs.length) return;
    const db = await this.open();
    if (!db) { await this.memory.put(bookId, target, engine, pairs); return; }
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const at = Date.now();
      for (const [text, translation] of pairs) {
        const record: TranslationRecord = { bookId, target, text, translation, engine, at };
        store.put(record);
      }
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  async count(bookId: string, target: string, texts: string[]): Promise<number> {
    if (!texts.length) return 0;
    const db = await this.open();
    if (!db) return this.memory.count(bookId, target, texts);
    try {
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
      const keys = await Promise.all(texts.map(text => requestResult(store.getKey([bookId, target, text]))));
      return keys.filter(key => key !== undefined).length;
    } finally {
      db.close();
    }
  }

  async clearBook(bookId: string): Promise<void> {
    const db = await this.open();
    if (!db) { await this.memory.clearBook(bookId); return; }
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.index(BOOK_INDEX).openKeyCursor(IDBKeyRange.only(bookId));
      // Deletes are queued from the cursor callback, while the transaction is still active.
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }
}

/** A store for the current environment: IndexedDB, with an in-memory floor. */
export function defaultTranslationStore(): TranslationCache {
  return new TranslationStore();
}
