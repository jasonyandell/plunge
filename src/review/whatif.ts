/**
 * "If I had played X, would I have done better?" — answered two separate
 * ways that must never be confused:
 *
 * - Hindsight: finish the hand on the REAL hands with one fixed continuation
 *   (the practice player at every seat). That is a realized outcome of one
 *   particular continuation, not proof that a move is better or optimal.
 * - What you knew: guess the hidden hands many times, using only what the
 *   player at the decision could see (src/ai/observation.ts), and finish each
 *   guess the same way. That is an estimated chance, with sampling noise.
 *
 * The practice player is the deterministic own-information heuristic in
 * src/ai/medium.ts, not Walt: each seat decides from its own observation.
 */
import {
  type Action, type DominoId, type GameState, type Seat, type Team,
  applyAction, legalActions, mulberry32, teamOf, toSeed,
} from '../engine';
import { observe } from '../ai/observation';
import { mediumAction } from '../ai/medium';
import { sampleWorld } from '../ai/hard';
import { sameAction } from './steps';

export const CONTINUATION_NAME = 'the practice player';
export const DEFAULT_SAMPLES = 24;

export interface Outcome {
  /** Hand finished (always true for a continuation; may be false for an unfinished record). */
  readonly finished: boolean;
  readonly thrownIn: boolean;
  /** Declaring team, null if thrown in or not yet bid. */
  readonly declaringTeam: Team | null;
  readonly made: boolean | null;
  /** Marks won by each team in this hand. */
  readonly marks: readonly [number, number];
  readonly points: readonly [number, number];
}

export function outcomeOf(g: GameState): Outcome {
  const marks: [number, number] = [0, 0];
  if (g.handResult) marks[g.handResult.team] = g.handResult.marks;
  return {
    finished: g.phase === 'hand-over' || g.phase === 'game-over',
    thrownIn: g.thrownIn,
    declaringTeam: g.declarer === null ? null : teamOf(g.declarer),
    made: g.handResult ? g.handResult.made : null,
    marks,
    points: [g.points[0], g.points[1]],
  };
}

/** Marks for `team` minus marks against it: +1 made, −1 set, 0 thrown in. */
export function netMarks(o: Outcome, team: Team): number {
  return o.marks[team] - o.marks[1 - team as Team];
}

/** Finish the hand with the practice player in every seat. */
export function finishHand(g: GameState): GameState {
  for (let guard = 0; guard < 200; guard++) {
    if (g.phase !== 'bidding' && g.phase !== 'declaring' && g.phase !== 'playing') return g;
    const seat = g.turn!;
    const acts = legalActions(g);
    const action = acts.length === 1 ? acts[0]! : mediumAction(observe(g, seat), acts, () => 0);
    g = applyAction(g, action);
  }
  throw new Error('Continuation did not finish.');
}

/** The real-hands continuation after one move. */
export function hindsight(g: GameState, action: Action): Outcome {
  return outcomeOf(finishHand(applyAction(g, action)));
}

/**
 * A position with the hidden hands replaced by a guess. Built only from the
 * actor's observation plus public state: real hidden hands never pass through.
 */
function guessedState(g: GameState, hands: DominoId[][]): GameState {
  return { ...g, hands, dealt: hands };
}

export interface OptionEstimate {
  readonly action: Action;
  readonly samples: number;
  /** Deals (of `samples`) where the actor's team came out ahead in marks. */
  readonly ahead: number;
  /** Deals where the actor's team lost marks. */
  readonly behind: number;
  /** Average net marks for the actor's team. */
  readonly averageNet: number;
  /** Average points the actor's team took in the hand. */
  readonly averagePoints: number;
  /** Net marks per sampled deal, in sample order (paired across options). */
  readonly nets: readonly number[];
}

export interface Estimate {
  readonly seat: Seat;
  readonly samples: number;
  readonly options: readonly OptionEstimate[];
}

/**
 * Sample hidden hands from `seat`'s point of view and finish every legal
 * option on the same guessed deals (common samples keep the comparison fair).
 * `pause` lets a UI breathe between options; `signal` cancels.
 */
export async function estimateOptions(
  g: GameState, samples = DEFAULT_SAMPLES, seed = 'review',
  pause: () => Promise<void> = () => Promise.resolve(),
  signal?: AbortSignal,
): Promise<Estimate> {
  const seat = g.turn;
  if (seat === null || !['bidding', 'declaring', 'playing'].includes(g.phase)) throw new Error('No decision here.');
  const obs = observe(g, seat);
  const rand = mulberry32(toSeed(`${seed}|${seat}`));
  // Public state only: drop every hidden hand before sampling replacements.
  const publicView: GameState = { ...g, hands: [[], [], [], []], dealt: [[], [], [], []] };
  const worlds = Array.from({ length: samples }, () => guessedState(publicView, sampleWorld(obs, rand)));
  const team = teamOf(seat);
  const options: OptionEstimate[] = [];
  for (const action of legalActions(g)) {
    let ahead = 0, behind = 0, points = 0;
    const nets: number[] = [];
    for (const w of worlds) {
      const o = outcomeOf(finishHand(applyAction(w, action)));
      const n = netMarks(o, team);
      if (n > 0) ahead++; else if (n < 0) behind++;
      nets.push(n); points += o.points[team];
    }
    const averageNet = nets.reduce((a, b) => a + b, 0) / samples;
    options.push({ action, samples, ahead, behind, averageNet, averagePoints: points / samples, nets });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    await pause();
  }
  return { seat, samples, options };
}

export function optionFor(e: Estimate, action: Action): OptionEstimate | undefined {
  return e.options.find(o => sameAction(o.action, action));
}

export type Comparison = 'same' | 'too-close' | 'better' | 'worse';

/**
 * Compare option `a` with `b` on the same sampled deals: identical on every
 * deal, within about two standard errors of the paired difference, or a
 * clearer sampled edge. Even "better" is an estimate, never a proof.
 */
export function compareOptions(a: OptionEstimate, b: OptionEstimate): Comparison {
  const d = a.nets.map((n, i) => n - (b.nets[i] ?? 0));
  if (d.every(x => x === 0)) return 'same';
  const mean = d.reduce((x, y) => x + y, 0) / d.length;
  const variance = d.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, d.length - 1);
  const se = Math.sqrt(variance / d.length);
  if (Math.abs(mean) <= 2 * se) return 'too-close';
  return mean > 0 ? 'better' : 'worse';
}
