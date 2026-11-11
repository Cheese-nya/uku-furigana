import {
  buildImportedReadingData,
  type ImportedNameDictionary,
  type ImportedReadingData,
} from './nameReadings';
import { isValidImportedNameDictionary, type NameDictionaryImportResult } from './nameDictionaryImport';

const DB_NAME = 'uku-name-readings';
const STORE = 'dictionaries';
const DB_VERSION = 1;

export interface NameReadingStoreOptions { indexedDB?: IDBFactory }

export type NameReadingStoreErrorCode = 'storageUnavailable' | 'storageFailed';

export class NameReadingStoreError extends Error {
  readonly code: NameReadingStoreErrorCode;

  constructor(code: NameReadingStoreErrorCode) {
    super(code);
    this.name = 'NameReadingStoreError';
    this.code = code;
  }
}

/** One small IndexedDB record per imported zip; the zip itself is not persisted. */
export class NameReadingStore {
  private readonly factory?: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: NameReadingStoreOptions = {}) {
    this.factory = options.indexedDB ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (!this.factory) return Promise.reject(new NameReadingStoreError('storageUnavailable'));
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.dbPromise = null; reject(request.error ?? new NameReadingStoreError('storageFailed')); };
    });
    return this.dbPromise;
  }

  async list(): Promise<ImportedNameDictionary[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(((request.result as unknown[]) || []).filter(isValidImportedNameDictionary));
      request.onerror = () => reject(request.error);
    });
  }

  async save(result: NameDictionaryImportResult): Promise<ImportedNameDictionary> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(result.library);
      tx.oncomplete = () => resolve(result.library);
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async load(): Promise<ImportedReadingData> {
    try { return buildImportedReadingData(await this.list()); }
    catch (error) {
      // A private-mode or unavailable IndexedDB must not stop the built-in annotation engine.
      console.warn('本地读音词典加载失败，使用内置读音：', error);
      return buildImportedReadingData([]);
    }
  }
}

let sharedStore: NameReadingStore | null = null;
export function getNameReadingStore(): NameReadingStore {
  if (!sharedStore) sharedStore = new NameReadingStore();
  return sharedStore;
}
