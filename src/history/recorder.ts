/** Additive local history. No eviction, uploads, or solver reruns. */
import { questionGameId, type AppState } from '../ui/store';
import { encodeReplay } from '../engine/replay-code';
import { BUILD_ID } from '../ui/update';
import { digest, listEstimates, sessionEstimates, sessionReceipts } from '../ai/phone/records';
import { recordHand, listHands } from './legacy';
import manifest from '../ai/phone/manifest.json';

export function snapshotOf(app: AppState) {
  const g = app.game;
  if (!g) return null;
  const code = encodeReplay(g);
  return { schema: 'plunge-history-v1' as const, build: BUILD_ID, gameId: app.sessionId,
    handNumber: g.handNumber, seed: app.seed, settings: app.settings,
    code, phase: g.phase, marks: g.marks, points: g.points,
    winner: g.winner, handResult: g.handResult, thrownIn: g.thrownIn,
    // Codes contain dealt hands, auction, declaration and ordered plays. Retain
    // engine state only if a future/custom ruleset cannot be encoded.
    ...(code ? {} : { engineState: g }),
    receipts: Object.fromEntries(Object.entries(app.nativeReceipts).filter(([k]) => k.startsWith(`${g.handNumber}:`))),
    auctionSurveys: app.auctionSurveys,
    ...(app.room ? { room: app.room } : {}),
    // Added only when present, so ordinary snapshots keep their earlier content ids.
    ...retryProvenance(app) };
}
/**
 * A retried hand is the same game and hand as the original (root provenance),
 * replayed as practice. Saves from tabs predating undo lack these fields.
 */
function retryProvenance(app: AppState) {
  const g = app.game!, retry = app.retry?.handNumber === g.handNumber ? app.retry : null;
  const practiceHands = app.practiceHands ?? [];
  return {
    ...(retry ? { retry: { practice: true as const, root: { gameId: app.sessionId, handNumber: g.handNumber },
      branch: questionGameId(app), ...retry } } : {}),
    ...(practiceHands.length ? { practiceHands } : {}),
  };
}
type Snapshot = NonNullable<ReturnType<typeof snapshotOf>>;
let opened: Promise<IDBDatabase> | undefined;
export function historyDb(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('plunge-history', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('events', { keyPath: 'id' });
    r.onerror = () => { opened = undefined; reject(r.error); };
    r.onblocked = () => { opened = undefined; reject(new Error('Close other Plunge tabs and retry saving history.')); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opened = undefined; }; resolve(r.result); };
  });
}
export async function appendSnapshot(snapshot: Snapshot): Promise<void> {
  const id = await digest(snapshot), db = await historyDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite'), store = tx.objectStore('events');
    const request = store.get(id);
    request.onsuccess = () => { if (!request.result) store.add({ ...snapshot, id, recordedAt: new Date().toISOString() }); };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('History could not be saved.'));
  });
}
const pending = new Map<string, AppState>();
const staged = new Map<string, string>();
const STAGING = 'plunge:history:pending:';
/**
 * `leaving` marks a state the player is moving away from (a takeback, a
 * replay, a new game): its hand is logged as far as it went, so undone moves
 * are kept too. Room hands are recorded by the room itself.
 */
export async function recordHistory(app: AppState, leaving = false): Promise<void> {
  const snapshot = snapshotOf(app);
  if (!snapshot) return;
  const key = JSON.stringify(snapshot);
  pending.set(key, app);
  // Stage synchronously before IndexedDB/hash awaits: reloads recover even an
  // action immediately followed by closing the tab. Separate keys avoid tabs
  // overwriting one shared outbox. Storage failure leaves the memory retry.
  if (!staged.has(key) && typeof localStorage !== 'undefined') {
    const entry = STAGING + crypto.randomUUID();
    try { localStorage.setItem(entry, JSON.stringify(app)); staged.set(key, entry); }
    catch { /* IndexedDB can still succeed independently. */ }
  }
  await appendSnapshot(snapshot);
  // Every attempt gets its own record under its branch id; the first attempt's record is left as written.
  const g = app.game!, done = g.phase === 'hand-over' || g.phase === 'game-over';
  if (!snapshot.room && (done || leaving)) await recordHand(g, questionGameId(app), app.settings.difficulty, app.practiceHands ?? [],
    { build: BUILD_ID, walt: { player: manifest.player, source_commit: manifest.source_commit, wasm_sha256: manifest.wasm_sha256 } });
  pending.delete(key);
  const entry = staged.get(key);
  if (entry && typeof localStorage !== 'undefined') localStorage.removeItem(entry);
  staged.delete(key);
}
export async function retryHistory(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    const entries = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith(STAGING));
    for (const entry of entries) {
      const app = JSON.parse(localStorage.getItem(entry)!) as AppState;
      const snapshot = snapshotOf(app);
      if (snapshot) { const key = JSON.stringify(snapshot); pending.set(key, app); staged.set(key, entry); }
    }
  }
  for (const app of [...pending.values()]) await recordHistory(app);
}
export async function listHistory(): Promise<unknown[]> {
  const db = await historyDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('events').objectStore('events').getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function exportHistory(): Promise<string> {
  const unavailableStores: string[] = [];
  await retryHistory().catch(() => unavailableStores.push('pending-write'));
  // Walt receipts already have their own append-only-by-content-id local store.
  const receipts = await new Promise<Array<{ id: string }>>((resolve, reject) => {
    const r = indexedDB.open('plunge-walt', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('receipts', { keyPath: 'id' });
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction('receipts'), get = tx.objectStore('receipts').getAll();
      get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error);
      tx.oncomplete = tx.onabort = () => db.close();
    };
  }).catch(() => { unavailableStores.push('receipts'); return []; });
  const unique = <T extends { id: string }>(values: T[]) => [...new Map(values.map(value => [value.id, value])).values()];
  return JSON.stringify({ schema: 'plunge-history-export-v1', exportedAt: new Date().toISOString(),
    build: BUILD_ID, events: await listHistory().catch(() => { unavailableStores.push('events'); return []; }), pending: [...pending.values()].map(snapshotOf),
    hands: await listHands().catch(() => { unavailableStores.push('hands'); return []; }), receipts: unique([...receipts, ...sessionReceipts()]),
    estimates: unique([...(await listEstimates().catch(() => { unavailableStores.push('estimates'); return []; })), ...sessionEstimates()]),
    rescuedJournal: await readExistingDatabase('plunge-records'),
    legacyStats: await readExistingDatabase('plunge-stats'), unavailableStores }, null, 2);
}

/** Export prior recorder stores verbatim; never migrate, delete or upload them. */
async function readExistingDatabase(name: string): Promise<Record<string, unknown[]> | null> {
  if (!indexedDB.databases || !(await indexedDB.databases()).some(db => db.name === name)) return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  try {
    const result: Record<string, unknown[]> = {};
    for (const store of Array.from(db.objectStoreNames)) {
      result[store] = await new Promise((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    }
    return result;
  } finally { db.close(); }
}
