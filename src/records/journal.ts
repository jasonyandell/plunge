/**
 * The hand journal: facts gathered while a hand is played — when each action
 * happened, who or which Walt took it, settings changes and hints displayed —
 * closed into a HandRecord when the hand finishes or is abandoned.
 *
 * Pure: the clock and id source are passed in, so recording is testable and
 * the reducer that drives it stays deterministic under a fixed clock.
 */
import type { GameState } from '../engine';
import { encodeReplay } from '../engine/replay-code';
import type { NativeReceipt } from '../ai/native';
import type { AuctionEvidence } from '../ai/auction';
import type { HintEvidence } from '../questions/hint-evidence';
import { handSteps } from '../stats/replay';
import type { Settings } from '../ui/store';
import type { ActionMeta, AssistEvent, HandRecord, SeatRecord, SettingsEntry, WaltProfile } from './model';

export interface HandJournal {
  readonly id: string;
  readonly game: { readonly id: string; readonly seed: string; readonly hand: number };
  readonly started: string;
  readonly startedMs: number;
  readonly marksBefore: readonly [number, number];
  readonly seats: readonly [SeatRecord, SeatRecord, SeatRecord, SeatRecord];
  readonly settings: readonly SettingsEntry[];
  readonly profiles: readonly WaltProfile[];
  readonly actions: readonly ActionMeta[];
  readonly assist: readonly AssistEvent[];
  /** A record has been written for this hand; later events are not part of it. */
  readonly closed: boolean;
}

export interface JournalContext {
  readonly now: number;
  readonly newId: () => string;
  /** App build id (commit SHA). */
  readonly app: string;
  /** Walt build id for the computer seats, or null when unidentified. */
  readonly walt: string | null;
}

/** How a computer move was decided, as far as the move's evidence says. */
export type ComputerMove =
  | { readonly kind: 'native'; readonly receipt: NativeReceipt }
  | { readonly kind: 'auction'; readonly survey: AuctionEvidence | null }
  | { readonly kind: 'heuristic'; readonly player: string };

const elapsed = (j: HandJournal, now: number) => Math.max(0, Math.round(now - j.startedMs));

function settingsAt(at: number, s: Settings): SettingsEntry {
  return { at, preset: s.preset, difficulty: s.difficulty, hints: s.showHints, thinkDeeper: s.thinkDeeper, nello: s.nelloPreview };
}

function seatsFor(s: Settings, walt: string | null): HandJournal['seats'] {
  const native = s.difficulty === 'native-l1' || s.difficulty === 'native-partner';
  const computer: SeatRecord = { kind: 'computer', player: s.difficulty, walt: native ? walt : null };
  return [{ kind: 'person' }, computer, computer, computer];
}

/** Start recording a hand at its deal. `prior` covers actions taken before recording began. */
export function openJournal(g: GameState, game: { id: string; seed: string }, settings: Settings,
  ctx: JournalContext, prior: readonly ActionMeta[] = []): HandJournal {
  return {
    id: ctx.newId(), game: { ...game, hand: g.handNumber },
    started: new Date(ctx.now).toISOString(), startedMs: ctx.now,
    marksBefore: [g.marks[0], g.marks[1]],
    seats: seatsFor(settings, ctx.walt), settings: [settingsAt(0, settings)],
    profiles: [], actions: prior, assist: [], closed: false,
  };
}

/**
 * Adopt a hand already in progress (a game saved before recording existed):
 * its earlier actions are kept with unknown times rather than dropped.
 */
export function adoptJournal(g: GameState, seed: string, settings: Settings, ctx: JournalContext): HandJournal {
  const prior = (handSteps(g) ?? []).map((step): ActionMeta =>
    ({ at: null, by: step.state.turn === 0 ? 'person' : 'computer' }));
  return openJournal(g, { id: ctx.newId(), seed }, settings, ctx, prior);
}

export function finished(g: GameState): boolean {
  return g.phase === 'hand-over' || g.phase === 'game-over';
}

function profileOf(move: ComputerMove, walt: string | null): WaltProfile {
  switch (move.kind) {
    case 'native': {
      const r = move.receipt.response;
      return { source: 'play', player: move.receipt.identity.player.name, walt,
        worlds: r.n ?? null, budgetMs: r.budget_ms ?? null, mode: r.mode ?? null,
        counterexamples: r.counterexample_result !== undefined };
    }
    case 'auction': {
      const s = move.survey;
      if (s?.schema === 'plunge-played-auction-v1')
        return { source: 'auction', player: `bid-book:${s.book_id}:${s.profile}`, walt: null,
          worlds: null, budgetMs: null, mode: null, counterexamples: false };
      return { source: 'auction', player: 'walt-auction', walt,
        worlds: s?.worlds ?? null, budgetMs: null, mode: s?.route ?? null, counterexamples: false };
    }
    case 'heuristic':
      return { source: 'heuristic', player: move.player, walt: null,
        worlds: null, budgetMs: null, mode: null, counterexamples: false };
  }
}

/** Append one action. `move` is absent for the person's own action. */
export function withAction(j: HandJournal, now: number, walt: string | null, move?: ComputerMove): HandJournal {
  if (j.closed) return j;
  if (!move) return { ...j, actions: [...j.actions, { at: elapsed(j, now), by: 'person' }] };
  const profile = profileOf(move, walt), key = JSON.stringify(profile);
  let index = j.profiles.findIndex(p => JSON.stringify(p) === key);
  const profiles = index < 0 ? [...j.profiles, profile] : j.profiles;
  if (index < 0) index = profiles.length - 1;
  const meta: ActionMeta = move.kind === 'native'
    ? { at: elapsed(j, now), by: 'computer', profile: index, receipt: move.receipt.id }
    : { at: elapsed(j, now), by: 'computer', profile: index };
  return { ...j, profiles, actions: [...j.actions, meta] };
}

export function withHint(j: HandJournal, now: number, evidence: HintEvidence): HandJournal {
  if (j.closed) return j;
  return { ...j, assist: [...j.assist, { at: elapsed(j, now), before: j.actions.length, evidence: structuredClone(evidence) }] };
}

export function withSettings(j: HandJournal, now: number, s: Settings): HandJournal {
  if (j.closed) return j;
  return { ...j, settings: [...j.settings, settingsAt(elapsed(j, now), s)] };
}

/**
 * Close the hand into a record. A hand that cannot be replayed is not
 * recordable; an abandoned hand with no actions is only a deal and is skipped.
 * If the journal ever disagrees with the replay's length, the hand is still
 * kept, with its timings marked unknown rather than misaligned.
 */
export function closeJournal(j: HandJournal, g: GameState, outcome: 'finished' | 'abandoned',
  ctx: JournalContext): { journal: HandJournal; record: HandRecord | null } {
  const journal = { ...j, closed: true };
  if (j.closed) return { journal, record: null };
  const code = encodeReplay(g), steps = handSteps(g);
  if (!code || !steps || (outcome === 'abandoned' && steps.length === 0)) return { journal, record: null };
  const aligned = j.actions.length === steps.length && j.actions.every((a, i) =>
    a.by === (j.seats[steps[i]!.state.turn!]!.kind === 'person' ? 'person' : 'computer'));
  const actions = aligned ? j.actions : steps.map((step): ActionMeta =>
    ({ at: null, by: j.seats[step.state.turn!]!.kind === 'person' ? 'person' : 'computer' }));
  return {
    journal,
    record: {
      schema: 'plunge-hand-v2', id: j.id, game: j.game, app: ctx.app,
      started: j.started, ended: new Date(ctx.now).toISOString(), outcome,
      marksBefore: j.marksBefore, code, seats: j.seats, settings: j.settings,
      profiles: j.profiles, actions,
      assist: j.assist.map(e => ({ ...e, before: Math.min(e.before, actions.length) })),
    },
  };
}
