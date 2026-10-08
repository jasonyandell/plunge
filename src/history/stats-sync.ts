/**
 * Connects this device's hands log to the signed-in account.
 *
 * The local log is the device's own record and is never changed here. Each
 * hand is uploaded once per account and marked only after the server names it
 * as stored. Stats are greedy: whoever is signed in claims the device's hands,
 * so a second account on the same device gets them too. Nothing leaves the
 * device while signed out or from database-free previews.
 */
import { listHands, statsDb } from './legacy';
import { UPLOAD_BATCH } from './hand-record';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';

interface SyncMark { readonly key: string; readonly account: string; readonly id: string; readonly uploaded?: string; readonly rejected?: string }
export interface StatsStatus {
  /** The signed-in account, or null: signed out, or a preview without an account service. */
  readonly account: string | null;
  /** Hands in this device's log. */
  readonly device: number;
  /** Of those, hands the account has acknowledged. */
  readonly connected: number;
  /** Hands still to upload, and hands the service would not accept (they stay on the device). */
  readonly waiting: number;
  readonly rejected: number;
  /** The account's hands across all its devices and rooms, when the service answered. */
  readonly total: number | null;
  readonly error?: string;
}
const DEVICE_KEY = 'device';

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
async function status(account: string | null, total: number | null, error?: string): Promise<StatsStatus> {
  const hands = await listHands(), known = account ? await marks(account) : new Map<string, SyncMark>();
  const connected = hands.filter((h) => known.get(h.id)?.uploaded).length, rejected = hands.filter((h) => known.get(h.id)?.rejected).length;
  return { account, device: hands.length, connected, rejected, waiting: hands.length - connected - rejected, total, ...(error ? { error } : {}) };
}
interface Ack { account?: string; stored?: string[]; rejected?: { id: string; error: string }[]; total?: number; error?: string }
/** Browsers refuse keepalive requests above about 64 KB; a hand is well under this. */
const KEEPALIVE_BYTES = 48_000;
async function put(device: string, hands: unknown[]): Promise<Ack & { status: number }> {
  // keepalive: a hand that finishes as the tab closes still gets its one attempt. A long backlog goes without it.
  const body = JSON.stringify({ device, hands });
  const response = await fetch('/api/stats/hands', { method: 'PUT', credentials: 'same-origin', cache: 'no-store', keepalive: body.length < KEEPALIVE_BYTES,
    headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(15000) });
  return { status: response.status, ...(await response.json() as Ack) };
}

let queue: Promise<unknown> = Promise.resolve();
/**
 * Upload what the signed-in account hasn't acknowledged. Called after each
 * hand attempt, on focus, on reconnect and from the account page; calls run
 * one at a time. Signed out, the one request comes back 401 and nothing is
 * marked. Pass the account id when it is already known to skip asking.
 */
export function syncStats(known?: string): Promise<StatsStatus> {
  const next = queue.then(async () => {
    if (QUESTIONS_LOCAL_ONLY) return status(null, null);
    const device = await deviceId();
    let account = known ?? null;
    if (!account) {
      const who = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<{ account?: { id: string } | null }>).catch(() => null);
      account = who?.account?.id ?? null;
      if (!account) return status(null, null);
    }
    const acknowledged = await marks(account);
    const pending = (await listHands()).filter((h) => !acknowledged.get(h.id)?.uploaded && !acknowledged.get(h.id)?.rejected);
    if (!pending.length && !known) return status(account, null);
    let total: number | null = null;
    try {
      // The account page asks even with nothing pending: an empty upload answers with the account's total.
      for (let i = 0; i < Math.max(1, pending.length); i += UPLOAD_BATCH) {
        const batch = pending.slice(i, i + UPLOAD_BATCH), ack = await put(device, batch);
        if (ack.status === 401) return status(null, null);
        if (ack.status !== 200 || ack.account !== account) throw new Error(ack.error ?? `Stats service unavailable (${ack.status}).`);
        const now = new Date().toISOString(), ids = new Set(batch.map((h) => h.id));
        await run<void>('sync', 'readwrite', (s) => {
          for (const id of ack.stored ?? []) if (ids.has(id)) s.put({ key: `${account}:${id}`, account, id, uploaded: now } satisfies SyncMark);
          for (const r of ack.rejected ?? []) if (ids.has(r.id)) s.put({ key: `${account}:${r.id}`, account, id: r.id, rejected: r.error } satisfies SyncMark);
        });
        total = ack.total ?? null;
      }
      return status(account, total);
    } catch (e) { return status(account, total, e instanceof Error ? e.message : 'Stats service unavailable.'); }
  });
  queue = next.catch(() => {});
  return next;
}
