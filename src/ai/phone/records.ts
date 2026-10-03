/** Local evidence, retained across reloads without a server. */
import type { NativeReceipt, NativeEstimate } from '../native';
const session = new Map<string, NativeReceipt>();
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('plunge-walt', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('receipts', { keyPath: 'id' }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export async function putReceipt(value: NativeReceipt): Promise<boolean> {
  session.set(value.id, value);
  try {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('receipts', 'readwrite');
    tx.objectStore('receipts').put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return true;
  } catch { database = undefined; return false; }
}
export async function getReceipt(id: string): Promise<NativeReceipt> {
  const saved = session.get(id);
  if (saved) return saved;
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('receipts').objectStore('receipts').get(id);
    request.onsuccess = () => request.result ? resolve(request.result as NativeReceipt) : reject(new Error('Original scores are not stored on this device.'));
    request.onerror = () => reject(request.error);
  });
}
export async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}

/** Actual hint/deeper run results, distinct from live move receipts. */
const estimates = new Map<string, NativeEstimate>();
export const sessionReceipts = () => [...session.values()];
export const sessionEstimates = () => [...estimates.values()];
export async function putEstimate(value: NativeEstimate): Promise<boolean> {
  estimates.set(value.id, value);
  try {
    const db = await estimateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('results', 'readwrite'); tx.objectStore('results').put(value);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close(); return true;
  } catch { return false; }
}
function estimateDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('plunge-walt-estimates', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('results', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function listEstimates(): Promise<NativeEstimate[]> {
  const db = await estimateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results'), r = tx.objectStore('results').getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    tx.oncomplete = tx.onabort = () => db.close();
  });
}
