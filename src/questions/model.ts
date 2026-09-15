/** Durable question evidence. A replay is evidence for the examiner, never AI input. */
import { legalPlays, type GameState } from '../engine';
import { decodeReplay } from '../engine/replay-code';
import { tileOfId } from '../ai/walt/requests';
import { explainRequestOf } from '../ai/review-request';
import type { NativeReceipt } from '../ai/native';

export interface Question {
  schema: 'plunge-question-v1'; id: string; created: string;
  game_id: string; hand_number: number; ply: number; seed: number;
  snapshot: string; replay: string; note: string; alternative: number | null;
  receipt_id: string | null; receipt: NativeReceipt | null; build: string;
}
export interface Answer { body: string; updated: string }
export interface RemoteQuestion { question: Question; revision: number; answer: Answer | null }
export interface LocalQuestion extends RemoteQuestion { syncedRevision: number; target: string }
export interface PublicQuestion {
  id: string; created: string; note: string; ply: number; seat: number; domino: string;
  complete: boolean; answer: Answer | null; question: Question | null;
}
export const QUESTION_ID = /^[a-f0-9]{32}$/;
export const OWNER_TOKEN = /^[a-f0-9]{64}$/;
export const MAX_QUESTION_BYTES = 96_000;
export const finished = (g: GameState): boolean => g.phase === 'hand-over' || g.phase === 'game-over';
export const allPlays = (g: GameState) => [...g.tricks.flatMap(t => t.plays), ...g.currentTrick];

/** The old examiner addresses completed tricks. Supply a temporary public row for a partial trick. */
export function examinerGame(g: GameState): GameState {
  return g.currentTrick.length ? { ...g, currentTrick: [], tricks: [...g.tricks,
    { plays: g.currentTrick, winner: g.currentTrick[0]!.seat, points: 0 }] } : g;
}
export function validQuestion(value: unknown): Question {
  const q = value as Question;
  if (!q || q.schema !== 'plunge-question-v1' || typeof q.id !== 'string' || !QUESTION_ID.test(q.id)
    || typeof q.created !== 'string' || !Number.isFinite(Date.parse(q.created))
    || typeof q.game_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(q.game_id)
    || !Number.isInteger(q.hand_number) || q.hand_number < 1 || q.hand_number > 100_000
    || !Number.isInteger(q.ply) || q.ply < 0 || q.ply > 27
    || !Number.isInteger(q.seed) || q.seed < 0 || q.seed > 0xffffffff
    || typeof q.note !== 'string' || q.note.length > 4000
    || typeof q.build !== 'string' || q.build.length > 100
    || typeof q.snapshot !== 'string' || q.snapshot.length > 200
    || typeof q.replay !== 'string' || q.replay.length > 200 || !q.replay.startsWith(q.snapshot)
    || (q.receipt_id !== null && (typeof q.receipt_id !== 'string' || !/^[a-f0-9]{64}$/.test(q.receipt_id)))) {
    throw new Error('Invalid question.');
  }
  const snapshot = decodeReplay(q.snapshot), game = decodeReplay(q.replay);
  if (!snapshot || !game || !allPlays(snapshot)[q.ply]) throw new Error('The saved play cannot be replayed.');
  const built = explainRequestOf(examinerGame(snapshot), Math.floor(q.ply / 4), q.ply % 4);
  if (!built) throw new Error('This play cannot be examined.');
  const before = new Set(snapshot.dealt[built.seat]);
  for (const p of allPlays(snapshot).slice(0,q.ply)) before.delete(p.domino);
  const lead = q.ply % 4 ? allPlays(snapshot)[Math.floor(q.ply/4)*4]!.domino : null;
  const legal = legalPlays([...before],lead,snapshot.rules!).map(tileOfId);
  if (q.alternative !== null && (!Number.isInteger(q.alternative) || !legal.includes(q.alternative))) {
    throw new Error('Invalid alternative.');
  }
  if (q.receipt !== null) {
    const r = q.receipt;
    if (!r || r.schema !== 'plunge-decision-v1' || r.id !== q.receipt_id || !r.identity || !r.response
      || typeof r.identity.player?.name !== 'string' || !Number.isFinite(r.response.elapsed_us)
      || !Array.isArray(r.response.phases) || r.response.phases.length > 100
      || !r.response.phases.every(p => p && typeof p.name === 'string' && typeof p.status === 'string')) throw new Error('Invalid original scores.');
    const req = r.identity.request;
    const expected = { ...built.req, seed: q.seed };
    for (const k of ['decl', 'bid', 'bidder', 'seat', 'hand', 'plays', 'seed'] as const) {
      if (JSON.stringify(req?.[k]) !== JSON.stringify(expected[k])) throw new Error('Scores belong to a different decision.');
    }
    const tile = built.domino;
    if (r.response.choice !== Number(tile[0]) * (Number(tile[0]) + 1) / 2 + Number(tile[1])) throw new Error('Scores name a different play.');
  }
  // Retain only the versioned protocol's fields, never arbitrary request properties.
  return { schema: q.schema, id: q.id, created: q.created, game_id: q.game_id, hand_number: q.hand_number,
    ply: q.ply, seed: q.seed, snapshot: q.snapshot, replay: q.replay, note: q.note, alternative: q.alternative,
    receipt_id: q.receipt_id, receipt: q.receipt, build: q.build };
}
export function validUpdate(old: Question, next: Question): boolean {
  return ['id','created','game_id','hand_number','ply','seed','snapshot','receipt_id','build'].every(
    k => JSON.stringify(old[k as keyof Question]) === JSON.stringify(next[k as keyof Question]))
    && next.replay.startsWith(old.replay)
    && (old.receipt === null || JSON.stringify(old.receipt) === JSON.stringify(next.receipt));
}
export function publicQuestion(q: Question, answer: Answer | null): PublicQuestion {
  const g = decodeReplay(q.replay)!;
  const p = allPlays(g)[q.ply]!;
  const complete = finished(g);
  return { id: q.id, created: q.created, note: q.note, ply: q.ply, seat: p.seat, domino: p.domino,
    complete, answer: complete ? answer : null, question: complete ? q : null };
}
