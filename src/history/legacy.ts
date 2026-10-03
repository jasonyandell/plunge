/**
 * The local stats log: an append-only record of finished hands, kept on the
 * device in IndexedDB and never uploaded anywhere.
 *
 * Each hand is stored as its engine-validated replay code plus a few
 * denormalized fields for the dashboard topline. Everything else — tricks,
 * count, bids, agreement with Walt — is re-derived from the replay, so new
 * statistics apply retroactively to the whole log.
 *
 * Rescued from PR #7, commit 03970be4. The original analysis store is
 * preserved for compatibility; the current recorder does not run reviews.
 */
import type { GameState } from '../engine';
import { encodeReplay } from '../engine/replay-code';

export interface HandRecord {
  readonly schema: 'plunge-hand-v1';
  /** `${gameId}:${handNumber}` — the natural append-only dedup key. */
  readonly id: string;
  readonly gameId: string;
  readonly handNumber: number;
  /** Engine-validated replay of the finished hand (src/engine/replay-code.ts). */
  readonly code: string;
  readonly endedAt: string;
  readonly marksBefore: readonly [number, number];
  readonly marksAfter: readonly [number, number];
  readonly gameOver: boolean;
  readonly thrownIn: boolean;
  /** Computer-player setting when the hand was played. */
  readonly player: string;
}

const GAME_ID = /^[a-zA-Z0-9_-]{1,80}$/;

/** The finished hand as a log record, or null when it cannot be replayed. */
export function handRecordOf(g: GameState, gameId: string, player: string): HandRecord | null {
  if ((g.phase !== 'hand-over' && g.phase !== 'game-over') || !GAME_ID.test(gameId)) return null;
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
  };
}

let opened: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('plunge-stats', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('hands', { keyPath: 'id' });
      request.result.createObjectStore('analysis', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opened = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opened = undefined; reject(new Error('This browser could not open the stats log.')); };
  });
}

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

export async function recordFinishedHand(g: GameState, gameId: string, player: string): Promise<void> {
  const record = handRecordOf(g, gameId, player);
  if (record) await appendHand(record);
}
