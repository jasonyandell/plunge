/**
 * AI players. Public contract: `chooseAction` must return a member of
 * `legalActions(state)` for the given seat, deterministically given `rand`.
 *
 * - easy:   light common sense, mostly random play.
 * - medium: heuristic club player (src/ai/medium.ts).
 * - hard:   medium + Monte Carlo determinization (src/ai/hard.ts).
 * - onyx:   the ONNX-exported Gus belief student for play (src/ai/onyx.ts);
 *           falls back to hard for bidding/declaring and out-of-scope contracts.
 *           Needs an async pre-warm (preloadOnyx + prewarmOnyx) to hit the cache;
 *           a cold cache or missing session degrades cleanly to hard.
 * - walt:   the level-1 exact sampling-stack solver in wasm (src/ai/walt) —
 *           bids, declares, AND plays straight 42, in a Web Worker. Same
 *           pre-warm bridge (preloadWalt + prewarmWalt); anything out of
 *           scope or uncached degrades cleanly to hard.
 *
 * Imperfect information is enforced structurally: every policy receives an
 * `Observation` (src/ai/observation.ts) — own hand + public info only —
 * never the GameState's hidden hands. Hard samples hidden hands consistent
 * with the observation; it cannot peek.
 */

import {
  type Action,
  type GameState,
  type Seat,
  legalActions,
} from '../engine';
import { observe } from './observation';
import { easyAction } from './easy';
import { mediumAction } from './medium';
import { hardAction } from './hard';
import { onyxAction } from './onyx';
import { waltAction } from './walt';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'onyx' | 'walt';

export function chooseAction(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty,
  rand: () => number,
): Action {
  if (state.phase === 'hand-over') return { type: 'next-hand' };
  if (state.turn !== seat) throw new Error(`not seat ${seat}'s turn`);
  const actions = legalActions(state);
  const first = actions[0];
  if (!first) throw new Error('no legal actions');
  if (actions.length === 1) return first;

  const obs = observe(state, seat);
  switch (difficulty) {
    case 'easy':
      return easyAction(obs, actions, rand);
    case 'medium':
      return mediumAction(obs, actions, rand);
    case 'hard':
      return hardAction(obs, actions, rand);
    case 'onyx':
      return onyxAction(obs, actions, rand);
    case 'walt':
      return waltAction(obs, actions, rand);
  }
}

export { preloadOnyx, prewarmOnyx, onyxReady } from './onyx';
export { preloadWalt, prewarmWalt, waltReady } from './walt';
