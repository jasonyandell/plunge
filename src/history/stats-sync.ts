/**
 * Connects this device's finished-hand log to the signed-in account.
 *
 * The local log is the device's own record and is never changed here. Each
 * hand is uploaded once per account and marked only after the server names it
 * as stored. Nothing leaves the device while signed out, nothing is uploaded
 * from database-free previews, and the game's periodic ticks make no request
 * unless there is a hand to send. The server holds the merged view.
 */
import { listHands, statsDb } from './legacy';
import { UPLOAD_BATCH } from './hand-record';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';

interface SyncMark { readonly key: string; readonly account: string; readonly id: string; readonly uploaded?: string; readonly rejected?: string }
export interface StatsStatus {
  /** 'device-only' builds have no account service; 'signed-out' keeps everything local. */
  readonly state: 'device-only' | 'signed-out' | 'connected' | 'offline';
  readonly account: { readonly id: string; readonly name: string } | null;
  /** Finished hands in this device's log. */
  readonly device: number;
  /** Of those, hands the account has acknowledged. */
  readonly connected: number;
  /** Hands still to upload, and hands the service would not accept (they stay on the device). */
  readonly waiting: number;
  readonly rejected: number;
  /** The account's hands across all its devices and rooms; known after the account page asks. */
  readonly hands: number;
  readonly devices: number;
  readonly error?: string;
}
const API = '/api/stats';
const DEVICE_KEY = 'device', ACCOUNT_KEY = 'account';
const NONE = { hands: 0, devices: 0 };
const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('plunge-stats-changed')); };

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return statsDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    let result: T;
    if (request) request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('The stats log could not be updated.'));
  }));
}
const meta = (key: string) => run<unknown>('meta', 'readonly', (s) => s.get(key));
const setMeta = (key: string, value: string) => run<void>('meta', 'readwrite', (s) => { s.put(value, key); });
const lastAccount = async () => { const value = await meta(ACCOUNT_KEY).catch(() => null); return typeof value === 'string' ? value : null; };
/** The device stops treating itself as signed in: nothing more is sent until the account page says otherwise. */
export const forgetAccount = () => run<void>('meta', 'readwrite', (s) => { s.delete(ACCOUNT_KEY); }).catch(() => {});

/** A stable random label for this install, so two devices with the same game ids never collide. */
export async function deviceId(): Promise<string> {
  let id = '';
  await run<void>('meta', 'readwrite', (s) => {
    const r = s.get(DEVICE_KEY);
    r.onsuccess = () => {
      id = typeof r.result === 'string' && /^[a-f0-9]{32}$/.test(r.result) ? r.result
        : [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, '0')).join('');
      s.put(id, DEVICE_KEY);
    };
  });
  return id;
}

async function marks(account: string): Promise<Map<string, SyncMark>> {
  return new Map((await run<SyncMark[]>('sync', 'readonly', (s) => s.getAll() as IDBRequest<SyncMark[]>)).filter((m) => m.account === account).map((m) => [m.id, m]));
}
async function summary(account: StatsStatus['account'], state: StatsStatus['state'], totals: { hands: number; devices: number }, error?: string): Promise<StatsStatus> {
  const hands = await listHands(), known = account ? await marks(account.id) : new Map<string, SyncMark>();
  const connected = hands.filter((h) => known.get(h.id)?.uploaded).length, rejected = hands.filter((h) => known.get(h.id)?.rejected).length;
  return { state, account, device: hands.length, connected, rejected, waiting: hands.length - connected - rejected, ...totals, ...(error ? { error } : {}) };
}

class SignedOut extends Error {}
/** Send what the account hasn't acknowledged; returns how many hands it newly stored. */
async function upload(account: string): Promise<number> {
  const device = await deviceId(), known = await marks(account);
  const pending = (await listHands()).filter((h) => !known.get(h.id)?.uploaded && !known.get(h.id)?.rejected);
  let sent = 0;
  for (let i = 0; i < pending.length; i += UPLOAD_BATCH) {
    const batch = pending.slice(i, i + UPLOAD_BATCH);
    // keepalive: a hand that finishes as the tab closes still gets its one attempt.
    const response = await fetch(`${API}/hands`, { method: 'PUT', credentials: 'same-origin', cache: 'no-store', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, hands: batch }), signal: AbortSignal.timeout(15000) });
    const ack = await response.json() as { account?: string; stored?: string[]; rejected?: { id: string; error: string }[]; error?: string };
    if (response.status === 401) throw new SignedOut(ack.error ?? 'Sign in to connect your stats.');
    if (!response.ok || ack.account !== account) throw new Error(ack.error ?? `Stats service unavailable (${response.status}).`);
    const now = new Date().toISOString(), ids = new Set(batch.map((h) => h.id));
    await run<void>('sync', 'readwrite', (s) => {
      for (const id of ack.stored ?? []) if (ids.has(id)) { sent++; s.put({ key: `${account}:${id}`, account, id, uploaded: now } satisfies SyncMark); }
      for (const r of ack.rejected ?? []) if (ids.has(r.id)) s.put({ key: `${account}:${r.id}`, account, id: r.id, rejected: r.error } satisfies SyncMark);
    });
  }
  if (sent) changed();
  return sent;
}
interface Who { available: boolean; account: StatsStatus['account']; hands?: number; devices?: number }
const whoAmI = async (): Promise<Who> => {
  const response = await fetch(API, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const data = await response.json() as Who & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Stats service unavailable (${response.status}).`);
  return data;
};

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work); queue = next.catch(() => {}); return next; };

/**
 * The game's timer, focus, reconnect and finished-hand ticks: upload only what
 * the last known account hasn't acknowledged, with no request at all when
 * there is nothing to send or the device isn't signed in.
 */
export const syncStats = (): Promise<StatsStatus> => serial(async () => {
  if (QUESTIONS_LOCAL_ONLY) return summary(null, 'device-only', NONE);
  const last = await lastAccount();
  if (!last) return summary(null, 'signed-out', NONE);
  const account = { id: last, name: '' };
  try { await upload(last); return summary(account, 'connected', NONE); }
  catch (e) {
    if (e instanceof SignedOut) { await forgetAccount(); return summary(null, 'signed-out', NONE); }
    return summary(account, 'offline', NONE, e instanceof Error ? e.message : 'Stats service unavailable.');
  }
});
/** The account page: ask who is signed in, upload, and read the account's totals. */
export const connectStats = (): Promise<StatsStatus> => serial(async () => {
  if (QUESTIONS_LOCAL_ONLY) return summary(null, 'device-only', NONE);
  let who: Who;
  try { who = await whoAmI(); } catch (e) {
    const last = await lastAccount();
    return summary(last ? { id: last, name: '' } : null, 'offline', NONE, e instanceof Error ? e.message : 'Stats service unavailable.');
  }
  if (!who.available) return summary(null, 'device-only', NONE);
  if (!who.account) { await forgetAccount(); return summary(null, 'signed-out', NONE); }
  const account = who.account;
  await setMeta(ACCOUNT_KEY, account.id).catch(() => { /* The status still comes from the service. */ });
  let error: string | undefined;
  try { if (await upload(account.id)) who = await whoAmI(); }
  catch (e) { error = e instanceof SignedOut ? 'Please sign in again.' : e instanceof Error ? e.message : 'Stats could not be connected right now.'; }
  return summary(account, 'connected', { hands: who.hands ?? 0, devices: who.devices ?? 0 }, error);
});
/** The device's own counts, without contacting the service. */
export async function statsStatus(): Promise<StatsStatus> {
  if (QUESTIONS_LOCAL_ONLY) return summary(null, 'device-only', NONE);
  const last = await lastAccount();
  return last ? summary({ id: last, name: '' }, 'offline', NONE) : summary(null, 'signed-out', NONE);
}
