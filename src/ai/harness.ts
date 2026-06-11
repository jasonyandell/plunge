/**
 * Deterministic self-play harness — drives full games with `chooseAction` at
 * every seat. Used by the AI test suites (and handy for benchmarking).
 */

import {
  type Action,
  type GameConfig,
  type GameState,
  type Seat,
  type Team,
  applyAction,
  legalActions,
  mulberry32,
  newGame,
  teamOf,
  toSeed,
} from '../engine';
import { type Difficulty, chooseAction } from './index';

export type SeatDiffs = readonly [Difficulty, Difficulty, Difficulty, Difficulty];

export interface GameRecord {
  readonly final: GameState;
  readonly steps: number;
}

export interface PlayGameOptions {
  /** Called before each action is applied (for legality assertions, timing). */
  readonly onAction?: (
    state: GameState,
    seat: Seat,
    action: Action,
    legal: readonly Action[],
  ) => void;
}

/** Play one full game to `config.targetMarks`; deterministic per seed. */
export function playGame(
  config: GameConfig | undefined,
  seed: string,
  diffs: SeatDiffs,
  opts: PlayGameOptions = {},
): GameRecord {
  let st = newGame(config, seed);
  const rands = ([0, 1, 2, 3] as Seat[]).map((s) => mulberry32(toSeed(`${seed}/seat${s}`)));
  let steps = 0;
  while (st.phase !== 'game-over') {
    if (++steps > 100_000) throw new Error(`game did not terminate (seed ${seed})`);
    const seat = (st.turn ?? st.shaker) as Seat;
    const action = chooseAction(st, seat, diffs[seat], rands[seat]!);
    if (opts.onAction) opts.onAction(st, seat, action, legalActions(st));
    st = applyAction(st, action);
  }
  return { final: st, steps };
}

export interface MatchResult {
  /** Games won by difficulty A (the one that alternates teams). */
  readonly winsA: number;
  readonly games: number;
}

/**
 * Head-to-head: difficulty A vs difficulty B, alternating which team gets A
 * each game to cancel seat bias. Deterministic per seedBase.
 */
export function playMatch(
  config: GameConfig | undefined,
  seedBase: string,
  games: number,
  diffA: Difficulty,
  diffB: Difficulty,
): MatchResult {
  let winsA = 0;
  for (let g = 0; g < games; g++) {
    const aTeam = (g % 2) as Team;
    const diffs = ([0, 1, 2, 3] as Seat[]).map((s) =>
      teamOf(s) === aTeam ? diffA : diffB,
    ) as unknown as SeatDiffs;
    const { final } = playGame(config, `${seedBase}-${g}`, diffs);
    if (final.winner === aTeam) winsA++;
  }
  return { winsA, games };
}
