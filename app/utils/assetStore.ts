// Illustrations of imported EPUBs. They stay out of the library JSON (which is saved whole on
// every change, and on desktop goes through pywebview) and live in IndexedDB as Blobs instead.
const DB_NAME = 'uku-book-assets';
const STORE = 'assets';

export interface StoredAsset { id: string; mime: string; data: Uint8Array }

interface AssetRecord { key: string; bookId: string; id: string; mime: string; blob: Blob }

let opening: Promise<IDBDatabase> | null = null;
const urls = new Map<string, string>();

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB 不可用'));
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('book', 'bookId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('插图数据库打开失败'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('插图保存失败'));
    tx.onabort = () => reject(tx.error || new Error('插图保存失败'));
  });
}

export async function putBookAssets(bookId: string, assets: StoredAsset[]): Promise<void> {
  if (!assets.length) return;
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const asset of assets) {
    const record: AssetRecord = { key: `${bookId}/${asset.id}`, bookId, id: asset.id, mime: asset.mime, blob: new Blob([asset.data as BlobPart], { type: asset.mime }) };
    store.put(record);
  }
  await done(tx);
}

/** An object URL for one illustration, or '' when it is missing. URLs are cached for the session. */
export async function bookAssetUrl(bookId: string, id: string): Promise<string> {
  const key = `${bookId}/${id}`;
  const cached = urls.get(key);
  if (cached) return cached;
  const db = await open();
  const record = await new Promise<AssetRecord | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as AssetRecord | undefined);
    request.onerror = () => reject(request.error);
  });
  if (!record) return '';
  const url = URL.createObjectURL(record.blob);
  urls.set(key, url);
  return url;
}

export async function deleteBookAssets(bookId: string): Promise<void> {
  for (const [key, url] of urls) if (key.startsWith(`${bookId}/`)) { URL.revokeObjectURL(url); urls.delete(key); }
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.objectStore(STORE).index('book');
  const request = index.openKeyCursor(IDBKeyRange.only(bookId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    tx.objectStore(STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await done(tx);
}

/** Shrink a cover image to at most 600px on its long side, as a JPEG data URL (the library stores covers inline). */
export function downscaleCover(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        const w = img.naturalWidth || img.width || 600;
        const h = img.naturalHeight || img.height || 600;
        const scale = Math.min(1, 600 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(blob);
  });
}
