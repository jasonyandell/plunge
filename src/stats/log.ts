/**
 * The local stats log: an append-only record of finished hands, kept on the
 * device in IndexedDB and never uploaded anywhere.
 *
 * Each hand is stored as its engine-validated replay code plus a few
 * denormalized fields for the dashboard topline. Everything else — tricks,
 * count, bids, agreement with Walt — is re-derived from the replay, so new
 * statistics apply retroactively to the whole log.
 *
 * Records are never rewritten. Walt's post-hoc reviews of your plays live in
 * a separate derived store keyed by the same id; that cache is versioned by
 * analysis profile and safe to recompute at any time.
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

/** Walt's verdict on one of your play decisions (walt tile ids, 0–27). */
export interface PlyVerdict {
  /** Index into the hand's plays for this decision. */
  readonly ply: number;
  readonly played: number;
  readonly suggested: number | null;
  readonly forced: boolean;
  readonly playedChance: number | null;
  readonly bestChance: number | null;
  /** True when your play tied Walt's best estimate. */
  readonly playedBest: boolean;
}

export interface HandAnalysis {
  readonly schema: 'plunge-hand-analysis-v1';
  /** Matches HandRecord.id. */
  readonly id: string;
  readonly profile: string;
  readonly plies: readonly PlyVerdict[];
  /** The contract is out of Walt's scope — nothing to score. */
  readonly unsupported: boolean;
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

/** Derived cache — overwriting is fine, the log itself is never touched. */
export async function putAnalysis(analysis: HandAnalysis): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('analysis', 'readwrite');
    tx.objectStore('analysis').put(analysis);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('The review could not be saved.'));
  });
}

export async function listAnalyses(): Promise<HandAnalysis[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('analysis').objectStore('analysis').getAll();
    r.onsuccess = () => resolve(r.result as HandAnalysis[]);
    r.onerror = () => reject(r.error);
  });
}

/** Record a finished hand from the live table. Quiet by design: stats must never interrupt play. */
export async function recordFinishedHand(g: GameState, gameId: string, player: string): Promise<void> {
  const record = handRecordOf(g, gameId, player);
  if (record) await appendHand(record);
}
