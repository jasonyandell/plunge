import { playLocation, playIndex } from '../engine/play-index';
/** Durable question evidence. A replay is evidence for the examiner, never AI input. */
import { legalPlays, type GameState } from '../engine';
import { decodeReplay } from '../engine/replay-code';
import { tileOfId, idOfTile } from '../ai/walt/requests';
import { explainRequestOf } from '../ai/review-request';
import type { NativeReceipt } from '../ai/native';
import { validHint, type HintEvidence } from './hint-evidence';

interface QuestionBase {
  id: string; created: string;
  game_id: string; hand_number: number; ply: number; seed: number;
  snapshot: string; replay: string; note: string; alternative: number | null;
  receipt_id: string | null; receipt: NativeReceipt | null; build: string;
}
export type Question = QuestionBase & (
  { schema: 'plunge-question-v1'; hint?: never; hint_id?: never }
  | { schema: 'plunge-question-v2'; hint: HintEvidence; hint_id: string }
);
export interface Answer { body: string; updated: string }
export interface RemoteQuestion { question: Question; revision: number; answer: Answer | null }
export interface LocalQuestion extends RemoteQuestion { syncedRevision: number; target: string }
export interface PublicQuestion {
  id: string; created: string; note: string; ply: number; seat: number; domino: string | null;
  kind: 'play' | 'move' | 'bid' | 'trump';
  location?: { trick: number; play: number };
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
  if (!q || !['plunge-question-v1','plunge-question-v2'].includes(q.schema) || typeof q.id !== 'string' || !QUESTION_ID.test(q.id)
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
  if (!snapshot || !game) throw new Error('The saved position cannot be replayed.');
  if (q.schema === 'plunge-question-v2') {
    if (q.ply !== allPlays(snapshot).length || q.alternative !== null || q.receipt_id !== null || q.receipt !== null
      || typeof q.hint_id !== 'string' || !/^[a-f0-9]{64}$/.test(q.hint_id)) throw new Error('Invalid hint capture.');
    const hint = validHint(q.hint, snapshot, q.seed);
    return { schema: q.schema, id: q.id, created: q.created, game_id: q.game_id, hand_number: q.hand_number,
      ply: q.ply, seed: q.seed, snapshot: q.snapshot, replay: q.replay, note: q.note, alternative: null,
      receipt_id: null, receipt: null, build: q.build, hint, hint_id: q.hint_id };
  }
  if (q.hint !== undefined || q.hint_id !== undefined || !allPlays(snapshot)[q.ply]) throw new Error('The saved play cannot be replayed.');
  const loc = playLocation(snapshot,q.ply);
  if (!loc) throw new Error('Invalid play position.');
  const built = explainRequestOf(examinerGame(snapshot),loc.trick,loc.play);
  if (!built) throw new Error('This play cannot be examined.');
  const before = new Set(snapshot.dealt[built.seat]);
  for (const p of allPlays(snapshot).slice(0,q.ply)) before.delete(p.domino);
  const lead = loc.play ? allPlays(snapshot)[playIndex(snapshot,loc.trick,0)]!.domino : null;
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
    const response = r.response;
    if (typeof response.route !== 'string' || (response.interruption !== undefined && typeof response.interruption !== 'string')) throw new Error('Invalid score details.');
    const review = response.review_result;
    if (review && (typeof review !== 'object' || typeof review.status !== 'string'
      || !Number.isInteger(review.baseline) || !Number.isInteger(review.choice)
      || (review.samples !== undefined && !Number.isSafeInteger(review.samples))
      || (review.support !== undefined && !Number.isSafeInteger(review.support)))) throw new Error('Invalid partner review.');
    const req = r.identity.request;
    const expected = { ...built.req, seed: q.seed };
    for (const k of ['contract', 'decl', 'bid', 'bidder', 'seat', 'hand', 'plays', 'seed'] as const) {
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
  return ['schema','id','created','game_id','hand_number','ply','seed','snapshot','receipt_id','build','hint','hint_id'].every(
    k => JSON.stringify(old[k as keyof Question]) === JSON.stringify(next[k as keyof Question]))
    && next.replay.startsWith(old.replay)
    && (old.receipt === null || JSON.stringify(old.receipt) === JSON.stringify(next.receipt));
}
/** Owner-only hint view; the UI renders only their own hand before completion. */
export function ownerQuestion(q: Question, answer: Answer | null): PublicQuestion {
  const shown = publicQuestion(q, answer);
  return q.schema === 'plunge-question-v2' ? { ...shown, question: q,
    domino: q.hint.kind === 'move' ? idOfTile(q.hint.choice) : null } : shown;
}
export function publicQuestion(q: Question, answer: Answer | null): PublicQuestion {
  const g = decodeReplay(q.replay)!;
  const complete = finished(g);
  if (q.schema === 'plunge-question-v2') {
    const captured = decodeReplay(q.snapshot)!;
    const location = q.hint.kind === 'move' ? {location:{trick:captured.tricks.length,play:captured.currentTrick.length}} : {};
    return { ...location, id: q.id, created: q.created, note: q.note, ply: q.ply, seat: 0, kind: q.hint.kind,
      domino: complete && q.hint.kind === 'move' ? idOfTile(q.hint.choice) : null,
      complete, answer: complete ? answer : null, question: complete ? q : null };
  }
  const p = allPlays(g)[q.ply]!;
  return { location:playLocation(g,q.ply)!, id: q.id, created: q.created, note: q.note, ply: q.ply, seat: p.seat, domino: p.domino, kind: 'play',
    complete, answer: complete ? answer : null, question: complete ? q : null };
}
