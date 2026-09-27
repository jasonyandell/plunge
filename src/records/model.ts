/**
 * Player records: facts kept once and never rewritten (docs-data-model.md).
 * Stats, reviews and leaderboards are views computed from these. This module
 * also runs in the Cloudflare Worker, which validates every upload with it.
 */
import { type GameState, type Seat } from '../engine';
import { decodeReplay } from '../engine/replay-code';
import type { HintEvidence } from '../questions/hint-evidence';
import { handSteps } from '../stats/replay';

export const HAND_ID = /^[a-f0-9]{32}$/;
export const WALT_ID_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_HAND_BYTES = 512_000;

/** Who sat in a seat. A computer seat names the Walt build, or null when unidentified. */
export type SeatRecord =
  | { readonly kind: 'person' }
  | { readonly kind: 'computer'; readonly player: string; readonly walt: string | null };

/** How a computer decided one move: the build plus the effort it was asked for. */
export interface WaltProfile {
  readonly source: 'play' | 'auction' | 'heuristic';
  readonly player: string;
  readonly walt: string | null;
  readonly worlds: number | null;
  readonly budgetMs: number | null;
  readonly mode: string | null;
  readonly counterexamples: boolean;
}

/** One entry per action in the replay code, in the same order. */
export interface ActionMeta {
  /** Milliseconds since the hand started; null for actions taken before recording began. */
  readonly at: number | null;
  readonly by: 'person' | 'computer';
  /** Index into HandRecord.profiles for a computer move. */
  readonly profile?: number;
  /** Digest of the Walt decision receipt, when the move has one. */
  readonly receipt?: string;
}

/** A hint displayed during the hand. Kept as a fact; never read by any stat. */
export interface AssistEvent {
  readonly at: number;
  /** Index of the action the hint preceded (0 = before the first action). */
  readonly before: number;
  readonly evidence: HintEvidence;
}

/** Settings in force from `at` (ms since the hand started) until the next entry. */
export interface SettingsEntry {
  readonly at: number;
  readonly preset: string;
  readonly difficulty: string;
  readonly hints: boolean;
  readonly thinkDeeper: boolean;
  readonly nello: boolean;
}

export interface HandRecord {
  readonly schema: 'plunge-hand-v2';
  readonly id: string;
  /** `id` is random per game and shared by its hands; `seed` is the game's RNG seed. */
  readonly game: { readonly id: string; readonly seed: string; readonly hand: number };
  /** App build (commit SHA; 'dev' for local builds). */
  readonly app: string;
  readonly started: string;
  readonly ended: string;
  readonly outcome: 'finished' | 'abandoned';
  /** Game score when the hand began. Not derivable when earlier hands went unrecorded. */
  readonly marksBefore: readonly [number, number];
  /** Engine-validated replay (src/engine/replay-code.ts); partial for an abandoned hand. */
  readonly code: string;
  readonly seats: readonly [SeatRecord, SeatRecord, SeatRecord, SeatRecord];
  readonly settings: readonly SettingsEntry[];
  readonly profiles: readonly WaltProfile[];
  readonly actions: readonly ActionMeta[];
  readonly assist: readonly AssistEvent[];
}

/**
 * What stats and leaderboards may read. An allowlist, not an omission: hints,
 * settings (which include the hints switch) and timing never reach a stat, and
 * a field added to HandRecord stays out until it is deliberately listed here.
 */
export interface ScoredHand {
  readonly id: string;
  readonly game: { readonly id: string; readonly hand: number };
  readonly ended: string;
  readonly outcome: 'finished' | 'abandoned';
  readonly marksBefore: readonly [number, number];
  readonly code: string;
  readonly seats: readonly [SeatRecord, SeatRecord, SeatRecord, SeatRecord];
}

export function scored(h: HandRecord): ScoredHand {
  return {
    id: h.id, game: { id: h.game.id, hand: h.game.hand }, ended: h.ended, outcome: h.outcome,
    marksBefore: [h.marksBefore[0], h.marksBefore[1]], code: h.code,
    seats: [h.seats[0], h.seats[1], h.seats[2], h.seats[3]],
  };
}

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const int = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
const time = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const walt = (v: unknown): v is string | null => v === null || (typeof v === 'string' && WALT_ID_PATTERN.test(v));
const NAME = /^[a-zA-Z0-9_.:-]{1,80}$/;

function validSeat(v: unknown): SeatRecord {
  const s = v as SeatRecord;
  if (s?.kind === 'person') return { kind: 'person' };
  if (s?.kind === 'computer' && text(s.player, 80) && NAME.test(s.player) && walt(s.walt)) return s;
  throw new Error('Invalid seat.');
}

function validProfile(v: unknown): WaltProfile {
  const p = v as WaltProfile;
  if (!p || !['play', 'auction', 'heuristic'].includes(p.source) || !text(p.player, 120) || !walt(p.walt)
    || !(p.worlds === null || int(p.worlds, 0, 1_000_000)) || !(p.budgetMs === null || int(p.budgetMs, 0, 3_600_000))
    || !(p.mode === null || text(p.mode, 80)) || !bool(p.counterexamples)) throw new Error('Invalid Walt profile.');
  return p;
}

/** The decoded hand and its engine walk, or an error naming what disagrees. */
export function validHand(value: unknown): HandRecord {
  const h = value as HandRecord;
  if (!h || h.schema !== 'plunge-hand-v2' || !text(h.id, 32) || !HAND_ID.test(h.id)) throw new Error('Invalid hand.');
  if (!h.game || !text(h.game.id, 32) || !HAND_ID.test(h.game.id) || !text(h.game.seed, 200) || !int(h.game.hand, 1, 10_000))
    throw new Error('Invalid game.');
  if (!text(h.app, 64) || !NAME.test(h.app) || !time(h.started) || !time(h.ended)) throw new Error('Invalid hand times.');
  if (h.outcome !== 'finished' && h.outcome !== 'abandoned') throw new Error('Invalid outcome.');
  if (!Array.isArray(h.marksBefore) || h.marksBefore.length !== 2 || !h.marksBefore.every(m => int(m, 0, 99)))
    throw new Error('Invalid marks.');
  if (!Array.isArray(h.seats) || h.seats.length !== 4) throw new Error('Invalid seats.');
  const seats = h.seats.map(validSeat);
  if (!Array.isArray(h.profiles) || h.profiles.length > 64) throw new Error('Invalid profiles.');
  h.profiles.forEach(validProfile);
  if (!Array.isArray(h.settings) || h.settings.length < 1 || h.settings.length > 64 || !h.settings.every(s =>
    s && int(s.at, 0, 1e9) && text(s.preset, 40) && text(s.difficulty, 40) && bool(s.hints) && bool(s.thinkDeeper) && bool(s.nello)))
    throw new Error('Invalid settings.');
  const g: GameState | null = text(h.code, 400) ? decodeReplay(h.code) : null;
  const steps = g && handSteps(g);
  if (!g || !steps) throw new Error('The replay does not match the rules.');
  const finished = g.phase === 'hand-over' || g.phase === 'game-over';
  if (finished !== (h.outcome === 'finished')) throw new Error('The outcome does not match the replay.');
  if (!Array.isArray(h.actions) || h.actions.length !== steps.length) throw new Error('Every action needs its timing.');
  h.actions.forEach((a, i) => {
    const actor = steps[i]!.state.turn as Seat;
    const by = seats[actor]!.kind === 'person' ? 'person' : 'computer';
    if (!a || a.by !== by || !(a.at === null || int(a.at, 0, 1e9))) throw new Error('Invalid action.');
    if (a.profile !== undefined && !int(a.profile, 0, h.profiles.length - 1)) throw new Error('Invalid action profile.');
    if (a.receipt !== undefined && !(text(a.receipt, 64) && WALT_ID_PATTERN.test(a.receipt))) throw new Error('Invalid receipt.');
  });
  if (!Array.isArray(h.assist) || h.assist.length > 500 || !h.assist.every(e =>
    e && int(e.at, 0, 1e9) && int(e.before, 0, steps.length) && typeof e.evidence === 'object' && e.evidence !== null
    && ['move', 'bid', 'trump'].includes(e.evidence.kind))) throw new Error('Invalid hint events.');
  return h;
}

/** Score after a hand, and whether it ended the game. Derived, never stored. */
export function marksAfter(h: ScoredHand, g: GameState): { marks: [number, number]; gameOver: boolean } {
  const marks: [number, number] = [h.marksBefore[0], h.marksBefore[1]];
  if (g.handResult) marks[g.handResult.team] += g.handResult.marks;
  return { marks, gameOver: marks[0] >= g.config.targetMarks || marks[1] >= g.config.targetMarks };
}
