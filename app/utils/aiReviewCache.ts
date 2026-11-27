// Persistent IndexedDB cache (+ in-memory fallback) for AI reading review decisions.

const DB_NAME = 'uku-ai-review-cache-v1';
const STORE_NAME = 'entries';
const MAX_CACHE_ENTRIES = 8000;

export interface AiReviewCacheEntry {
  key: string;
  reading: string;
  updatedAt: number;
}

const memoryFallback = new Map<string, AiReviewCacheEntry>();

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function computeAiReviewCacheKey(params: {
  model: string;
  surface: string;
  prevSentence: string;
  sentence: string;
  nextSentence: string;
  mode: 'choose' | 'infer';
  optionsKey: string;
  glossaryHash: string;
}): string {
  const payload = [
    params.prevSentence.trim(),
    params.sentence.trim(),
    params.nextSentence.trim(),
    params.mode,
    params.optionsKey,
    params.glossaryHash,
  ].join('\0');
  return `${params.model || 'default'}\0${params.surface}\0${fnv1aHex(payload)}`;
}

export function hashGlossaryForReview(glossary?: Array<{ surface: string; reading: string }>): string {
  if (!glossary || glossary.length === 0) return '0';
  const normalized = glossary
    .map(entry => `${entry.surface}=${entry.reading}`)
    .sort()
    .join('\n');
  return fnv1aHex(normalized);
}

export async function readAiReviewCache(keys: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (keys.length === 0) return result;
  for (const key of keys) {
    const hit = memoryFallback.get(key);
    if (hit) result.set(key, hit.reading);
  }
  const db = await openCacheDb();
  if (!db) return result;
  try {
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      for (const key of keys) {
        if (result.has(key)) continue;
        const req = store.get(key);
        req.onsuccess = () => {
          const entry = req.result as AiReviewCacheEntry | undefined;
          if (entry && typeof entry.reading === 'string' && entry.reading) {
            result.set(key, entry.reading);
            memoryFallback.set(key, entry);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
  return result;
}

export async function writeAiReviewCache(entries: AiReviewCacheEntry[]): Promise<void> {
  if (entries.length === 0) return;
  for (const entry of entries) {
    memoryFallback.set(entry.key, entry);
    if (memoryFallback.size > MAX_CACHE_ENTRIES) {
      const oldest = memoryFallback.keys().next().value;
      if (oldest !== undefined) memoryFallback.delete(oldest);
    }
  }
  const db = await openCacheDb();
  if (!db) return;
  try {
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const entry of entries) {
        store.put(entry);
      }
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - MAX_CACHE_ENTRIES;
        if (excess <= 0) return;
        const index = store.index('updatedAt');
        let deleted = 0;
        const cursorReq = index.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || deleted >= excess) return;
          cursor.delete();
          deleted += 1;
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function clearAiReviewCache(): Promise<void> {
  memoryFallback.clear();
  const db = await openCacheDb();
  if (!db) return;
  try {
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
