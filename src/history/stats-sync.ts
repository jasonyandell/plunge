/**
 * Connects this device's finished-hand log to the signed-in account.
 *
 * The local log stays the device's own record and is never changed here. Each
 * hand is uploaded once per account and marked only after the server names it
 * as stored; hands from the account's other devices are cached locally so the
 * merged log reads the same on every device. Nothing leaves the device while
 * signed out, and nothing is uploaded from database-free previews.
 */
import { listHands, statsDb, type HandRecord } from './legacy';
import { UPLOAD_BATCH } from './hand-record';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';

export interface RemoteHand { readonly device: string; readonly record: HandRecord; readonly received: string }
interface SyncMark { readonly key: string; readonly account: string; readonly id: string; readonly uploaded?: string; readonly rejected?: string }
interface CachedHand extends RemoteHand { readonly key: string; readonly account: string }
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
  /** The account's merged log: every device's hands, and how many devices contributed. */
  readonly hands: number;
  readonly devices: number;
  readonly error?: string;
}
const API = '/api/stats';
const DEVICE_KEY = 'device', ACCOUNT_KEY = 'account';
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
const getAll = <T>(store: string) => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
const meta = (key: string) => run<unknown>('meta', 'readonly', (s) => s.get(key));
const setMeta = (key: string, value: string) => run<void>('meta', 'readwrite', (s) => { s.put(value, key); });

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

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'PUT', credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Stats service unavailable (${response.status}).`);
  return data;
}

async function marks(account: string): Promise<Map<string, SyncMark>> {
  return new Map((await getAll<SyncMark>('sync')).filter((m) => m.account === account).map((m) => [m.id, m]));
}
async function summary(account: StatsStatus['account'], state: StatsStatus['state'], totals: { hands: number; devices: number }, error?: string): Promise<StatsStatus> {
  const hands = await listHands(), known = account ? await marks(account.id) : new Map<string, SyncMark>();
  const connected = hands.filter((h) => known.get(h.id)?.uploaded).length, rejected = hands.filter((h) => known.get(h.id)?.rejected).length;
  return { state, account, device: hands.length, connected, rejected, waiting: hands.length - connected - rejected, ...totals, ...(error ? { error } : {}) };
}

const TOTALS = (account: string) => `totals:${account}`;
async function cachedTotals(account: string): Promise<{ hands: number; devices: number }> {
  const value = await meta(TOTALS(account)).catch(() => null);
  try { const t = JSON.parse(typeof value === 'string' ? value : '') as { hands: number; devices: number }; return { hands: t.hands ?? 0, devices: t.devices ?? 0 }; }
  catch { return { hands: 0, devices: 0 }; }
}
/** The device stops treating itself as signed in: nothing more is sent until the account page says otherwise. */
export const forgetAccount = () => run<void>('meta', 'readwrite', (s) => { s.delete(ACCOUNT_KEY); }).catch(() => {});
class SignedOut extends Error {}
async function upload(account: string): Promise<number> {
  const device = await deviceId(), known = await marks(account);
  const pending = (await listHands()).filter((h) => !known.get(h.id)?.uploaded && !known.get(h.id)?.rejected);
  let sent = 0;
  for (let i = 0; i < pending.length; i += UPLOAD_BATCH) {
    const batch = pending.slice(i, i + UPLOAD_BATCH);
    const response = await fetch(`${API}/hands`, { method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, hands: batch }), signal: AbortSignal.timeout(15000) });
    const ack = await response.json() as { account?: string; stored?: string[]; rejected?: { id: string; error: string }[]; error?: string };
    if (response.status === 401) throw new SignedOut(ack.error ?? 'Sign in to connect your stats.');
    if (!response.ok || ack.account !== account) throw new Error(ack.error ?? `Stats service unavailable (${response.status}).`);
    const now = new Date().toISOString(), ids = new Set(batch.map((h) => h.id));
    await run<void>('sync', 'readwrite', (s) => {
      for (const id of ack.stored ?? []) if (ids.has(id)) { sent++; s.put({ key: `${account}:${id}`, account, id, uploaded: now } satisfies SyncMark); }
      for (const r of ack.rejected ?? []) if (ids.has(r.id)) s.put({ key: `${account}:${r.id}`, account, id: r.id, rejected: r.error } satisfies SyncMark);
    });
  }
  return sent;
}
/** Pull the account's other devices into the local cache, continuing from the last page seen. */
async function pull(account: string): Promise<number> {
  const device = await deviceId(), saved = await meta(`pulled:${account}`).catch(() => null);
  let cursor = typeof saved === 'string' ? saved : '', pulled = 0;
  do {
    const page = await api<{ items: RemoteHand[]; next: string | null }>(`/hands${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
    await run<void>('remote', 'readwrite', (s) => {
      for (const item of page.items) if (item.device !== device) { pulled++; s.put({ ...item, key: `${account}:${item.device}:${item.record.id}`, account } satisfies CachedHand); }
    });
    const last = page.items.at(-1);
    if (last) { cursor = `${last.received}|${last.device}|${last.record.id}`; await setMeta(`pulled:${account}`, cursor); }
    if (!page.next) break;
  } while (true);
  return pulled;
}

export type SyncMode = 'light' | 'full';
let queue: Promise<unknown> = Promise.resolve();
/**
 * `light` (the game's timer, focus, reconnect, finished hand): upload only what
 * the last known account hasn't acknowledged, and make no request at all when
 * there is nothing to send or the device isn't signed in. `full` (the account
 * page): ask the service who is signed in, upload, pull the other devices, and
 * read the account's totals. Calls run one at a time.
 */
export function syncStats(mode: SyncMode = 'light'): Promise<StatsStatus> {
  const next = queue.then(() => mode === 'full' ? fullSync() : lightSync());
  queue = next.catch(() => {});
  return next;
}
async function lightSync(): Promise<StatsStatus> {
  if (QUESTIONS_LOCAL_ONLY) return summary(null, 'device-only', { hands: 0, devices: 0 });
  const last = await meta(ACCOUNT_KEY).catch(() => null);
  if (typeof last !== 'string') return summary(null, 'signed-out', { hands: 0, devices: 0 });
  const account = { id: last, name: '' };
  try {
    if (await upload(last)) changed();
    return summary(account, 'connected', await cachedTotals(last));
  } catch (e) {
    if (e instanceof SignedOut) { await forgetAccount(); return summary(null, 'signed-out', { hands: 0, devices: 0 }); }
    return summary(account, 'offline', await cachedTotals(last), e instanceof Error ? e.message : 'Stats service unavailable.');
  }
}
async function fullSync(): Promise<StatsStatus> {
  if (QUESTIONS_LOCAL_ONLY) return summary(null, 'device-only', { hands: 0, devices: 0 });
  let who: { available: boolean; account: StatsStatus['account']; hands?: number; devices?: number };
  try { who = await api(''); } catch (e) {
    const last = await meta(ACCOUNT_KEY).catch(() => null);
    const account = typeof last === 'string' ? { id: last, name: '' } : null;
    return summary(account, 'offline', account ? await cachedTotals(account.id) : { hands: 0, devices: 0 }, e instanceof Error ? e.message : 'Stats service unavailable.');
  }
  if (!who.available) return summary(null, 'device-only', { hands: 0, devices: 0 });
  if (!who.account) { await forgetAccount(); return summary(null, 'signed-out', { hands: 0, devices: 0 }); }
  const account = who.account;
  await setMeta(ACCOUNT_KEY, account.id).catch(() => { /* The status still comes from the service. */ });
  let error: string | undefined;
  try {
    // Totals are re-read only when this visit changed something.
    if (await upload(account.id) + await pull(account.id)) who = await api('');
  } catch (e) { error = e instanceof SignedOut ? 'Please sign in again.' : e instanceof Error ? e.message : 'Stats could not be connected right now.'; }
  const totals = { hands: who.hands ?? 0, devices: who.devices ?? 0 };
  await setMeta(TOTALS(account.id), JSON.stringify(totals)).catch(() => {});
  changed();
  return summary(account, 'connected', totals, error);
}

/** The current connection without contacting the service. */
export async function statsStatus(): Promise<StatsStatus> {
  if (QUESTIONS_LOCAL_ONLY) return summary(null, 'device-only', { hands: 0, devices: 0 });
  const last = await meta(ACCOUNT_KEY).catch(() => null);
  return typeof last === 'string' ? summary({ id: last, name: '' }, 'offline', await cachedTotals(last)) : summary(null, 'signed-out', { hands: 0, devices: 0 });
}

/**
 * The merged log as this device knows it: its own hands first, then cached
 * hands from the last signed-in account's other devices, oldest first.
 */
export async function listAccountHands(): Promise<RemoteHand[]> {
  const device = await deviceId(), own = (await listHands()).map((record) => ({ device, record, received: '' }));
  const account = await meta(ACCOUNT_KEY).catch(() => null);
  const others = typeof account === 'string' ? (await getAll<CachedHand>('remote')).filter((h) => h.account === account && h.device !== device)
    .map(({ device: d, record, received }) => ({ device: d, record, received })) : [];
  return [...own, ...others].sort((a, b) => a.record.endedAt.localeCompare(b.record.endedAt) || a.device.localeCompare(b.device));
}
