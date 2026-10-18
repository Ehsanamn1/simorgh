type CachedResponse = { key: string; partition: string; savedAt: number; payload: Record<string, unknown> };

const DB_NAME = 'medar-offline-cache';
const STORE_NAME = 'responses';
const MAX_ENTRIES_PER_USER = 120;
const MAX_RESPONSE_CHARS = 700_000;
let currentPartition = '';

export function setOfflineCachePartition(userId: string | null | undefined) {
  currentPartition = typeof userId === 'string' && userId.length > 0 ? userId : '';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('partition', 'partition', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function cacheKey(queryKey: string): string | null {
  if (!currentPartition || !queryKey) return null;
  return currentPartition + ':' + queryKey;
}

/** Cache only successful, read-only API results. Writes are never silently queued or replayed. */
export async function writeOfflineResponse(queryKey: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const key = cacheKey(queryKey);
    if (!key || JSON.stringify(payload).length > MAX_RESPONSE_CHARS) return;
    const db = await openDatabase();
    if (!db) return;
    const record: CachedResponse = { key, partition: currentPartition, savedAt: Date.now(), payload };
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).index('partition').getAll(currentPartition);
      request.onsuccess = () => {
        const records = (request.result as CachedResponse[]).sort((a, b) => b.savedAt - a.savedAt);
        const stale = records.slice(MAX_ENTRIES_PER_USER);
        if (stale.length) {
          const deleteTx = db.transaction(STORE_NAME, 'readwrite');
          const store = deleteTx.objectStore(STORE_NAME);
          stale.forEach(item => store.delete(item.key));
          deleteTx.oncomplete = () => resolve();
          deleteTx.onerror = () => resolve();
        } else resolve();
      };
      request.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Offline cache must never break the live operation.
  }
}

export async function readOfflineResponse(queryKey: string): Promise<Record<string, unknown> | null> {
  try {
    const key = cacheKey(queryKey);
    if (!key) return null;
    const db = await openDatabase();
    if (!db) return null;
    const result = await new Promise<CachedResponse | null>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as CachedResponse | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
    db.close();
    if (!result || result.partition !== currentPartition) return null;
    return result.payload;
  } catch {
    return null;
  }
}
