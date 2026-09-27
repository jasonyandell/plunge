/**
 * The device log (IndexedDB `plunge-records`). Hands are written once and
 * never rewritten; only their `synced` acknowledgement changes. Reviews are a
 * derived cache, safe to drop and recompute.
 */
import type { HandRecord } from './model';
import type { HandAnalysis } from '../stats/log';

interface StoredHand { readonly record: HandRecord; readonly synced: boolean }

let opened: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('plunge-records', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('hands', { keyPath: 'record.id' });
      request.result.createObjectStore('reviews', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opened = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opened = undefined; reject(new Error('This browser could not open the hand log.')); };
  });
}

function all<T>(store: string): Promise<T[]> {
  return db().then(database => new Promise((resolve, reject) => {
    const r = database.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  }));
}

/** Append records; one already in the log is left exactly as first written. */
export async function appendHands(records: readonly HandRecord[]): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('hands', 'readwrite'), store = tx.objectStore('hands');
    for (const record of records) {
      const r = store.get(record.id);
      r.onsuccess = () => { if (!r.result) store.add({ record, synced: false } satisfies StoredHand); };
    }
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('The hand could not be added to the log.'));
  });
}

export async function listHands(): Promise<HandRecord[]> {
  return (await all<StoredHand>('hands')).map(h => h.record).sort((a, b) => a.ended.localeCompare(b.ended));
}

export async function unsyncedHands(): Promise<HandRecord[]> {
  return (await all<StoredHand>('hands')).filter(h => !h.synced).map(h => h.record);
}

export async function markSynced(id: string): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('hands', 'readwrite'), store = tx.objectStore('hands');
    const r = store.get(id);
    r.onsuccess = () => { const h = r.result as StoredHand | undefined; if (h && !h.synced) store.put({ ...h, synced: true }); };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('The upload could not be acknowledged.'));
  });
}

/** Derived cache — overwriting is fine; the log itself is never touched. */
export async function putReview(analysis: HandAnalysis): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('reviews', 'readwrite');
    tx.objectStore('reviews').put(analysis);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('The review could not be saved.'));
  });
}

export const listReviews = (): Promise<HandAnalysis[]> => all<HandAnalysis>('reviews');
