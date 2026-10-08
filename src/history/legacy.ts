/**
 * The local stats log: an append-only record of every hand attempt the human
 * played, kept on the device in IndexedDB. Finished hands and the branches
 * left behind by a takeback or an abandoned game alike: every move is a
 * human-labeled 42 move. A signed-in device uploads the log to its account
 * (src/history/stats-sync.ts); the log itself is never changed by that.
 *
 * Each hand is stored as its engine-validated replay code plus a few
 * denormalized fields. Everything else — tricks, count, bids, agreement with
 * Walt — is re-derived from the replay, so new statistics apply
 * retroactively to the whole log.
 *
 * Rescued from PR #7, commit 03970be4. The original analysis store is
 * preserved for compatibility; the current recorder does not run reviews.
 */
import type { GameState } from '../engine';
import { encodeReplay } from '../engine/replay-code';
import { GAME_ID } from './hand-record';

export interface HandRecord {
  readonly schema: 'plunge-hand-v1';
  /** `${gameId}:${handNumber}` — the natural append-only dedup key. */
  readonly id: string;
  /** The game, or a retried hand's branch (`${sessionId}-r${attempt}`), so every attempt keeps its own record. */
  readonly gameId: string;
  readonly handNumber: number;
  /** Engine-validated replay of the hand as far as it went (src/engine/replay-code.ts). */
  readonly code: string;
  /** When the hand finished, or when its branch was left. */
  readonly endedAt: string;
  readonly marksBefore: readonly [number, number];
  readonly marksAfter: readonly [number, number];
  readonly gameOver: boolean;
  readonly thrownIn: boolean;
  /** Computer-player setting when the hand was played. */
  readonly player: string;
  /**
   * Earlier hands of this game that were undone or replayed. Present only when
   * there were some: the marks and game result then include practice.
   */
  readonly practiceHands?: readonly number[];
}

/** The hand as a log record, or null when nothing has been played or it cannot be replayed. */
export function handRecordOf(g: GameState, gameId: string, player: string, practiceHands: readonly number[] = []): HandRecord | null {
  if (!g.bids.length || !GAME_ID.test(gameId)) return null;
  const code = encodeReplay(g);
  if (!code) return null;
  const marksBefore: [number, number] = [g.marks[0], g.marks[1]];
  if (g.handResult) marksBefore[g.handResult.team] -= g.handResult.marks;
  return {
    schema: 'plunge-hand-v1',
    id: `${gameId}:${g.handNumber}`,
    gameId,
    handNumber: g.handNumber,
    code,
    endedAt: new Date().toISOString(),
    marksBefore,
    marksAfter: [g.marks[0], g.marks[1]],
    gameOver: g.phase === 'game-over',
    thrownIn: g.thrownIn,
    player,
    ...(practiceHands.length ? { practiceHands: [...practiceHands] } : {}),
  };
}

let opened: Promise<IDBDatabase> | undefined;
/**
 * The device's stats database. Version 2 adds the account-connection stores
 * beside the original hands log (src/history/stats-sync.ts); existing hands
 * are kept exactly as written.
 */
export function statsDb(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('plunge-stats', 2);
    request.onupgradeneeded = () => {
      const stores = request.result.objectStoreNames;
      if (!stores.contains('hands')) request.result.createObjectStore('hands', { keyPath: 'id' });
      if (!stores.contains('analysis')) request.result.createObjectStore('analysis', { keyPath: 'id' });
      if (!stores.contains('meta')) request.result.createObjectStore('meta');
      if (!stores.contains('sync')) request.result.createObjectStore('sync', { keyPath: 'key' });
    };
    let blocked = false;
    request.onblocked = () => { blocked = true; opened = undefined; reject(new Error('Close other Plunge tabs to finish updating the stats log.')); };
    request.onsuccess = () => {
      // A connection that opens after its caller gave up is closed, never leaked.
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); opened = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opened = undefined; reject(new Error('This browser could not open the stats log.')); };
  });
}
const db = statsDb;

/** Append once; a hand already in the log is left exactly as first written. */
export async function appendHand(record: HandRecord): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('hands', 'readwrite'), store = tx.objectStore('hands');
    const r = store.get(record.id);
    r.onsuccess = () => { if (!r.result) store.add(record); };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('The hand could not be added to the stats log.'));
  });
}

export async function listHands(): Promise<HandRecord[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('hands').objectStore('hands').getAll();
    r.onsuccess = () => resolve((r.result as HandRecord[]).sort((a, b) => a.endedAt.localeCompare(b.endedAt)));
    r.onerror = () => reject(r.error);
  });
}

export async function recordHand(g: GameState, gameId: string, player: string, practiceHands: readonly number[] = []): Promise<void> {
  const record = handRecordOf(g, gameId, player, practiceHands);
  if (record) await appendHand(record);
}
