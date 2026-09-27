/**
 * Post-hand analysis: replay any completed play of the hand and have walt
 * price EVERY legal option that seat had, from its information state at the
 * time — its own dealt hand plus the public record, nothing more. This is
 * the full evaluator (race off, so per-option values come back), the same
 * level-1 mind that plays; the numbers are walt's model-relative estimates
 * on n sampled worlds, not receipts.
 *
 * Values are P(declaring team makes the contract) in basis points. For a
 * defender, lower is better; `goodnessOf` folds that so every consumer can
 * sort best-first for the seat's own team, and `Explanation.options` comes
 * back already sorted that way.
 *
 * Scope mirrors play scope: straight points-and-marks contracts only, no
 * sat-out partner. `explainScope` says whether a hand can be analyzed.
 */

import {
  type DominoId,
  type GameState,
  type Seat,
  teamOf,
  toSeed,
} from '../../engine';
import { idOfTile, tileOfId, waltContractBid, waltDeclId } from './requests';
import type { PlayRequest, PlayResponse } from './walt';
import { runWalt } from './index';
import { explainScope, explainRequestOf } from '../review-request';
export { explainScope, explainRequestOf } from '../review-request';

/** Worlds sampled for an explanation; matches walt's playing strength. */
export const EXPLAIN_N = 40;
/** The "look closer" tier, for when n=40 feels like the reason. */
export const EXPLAIN_N_CLOSER = 160;
const EXPLAIN_N0 = 8;

export interface ExplainOption {
  readonly domino: DominoId;
  /** P(declaring team makes it), basis points 0..10000, walt's estimate. */
  readonly bp: number;
  /** This is the tile that was actually played. */
  readonly played: boolean;
  /** Tied for the best option for the seat's own team. */
  readonly best: boolean;
}

export interface Explanation {
  readonly seat: Seat;
  /** The tile actually played. */
  readonly domino: DominoId;
  readonly forced: boolean;
  /** The seat is on the declaring team (higher bp = better for them). */
  readonly declaringTeam: boolean;
  /** All legal options, sorted best-first for the seat's team. Empty when forced. */
  readonly options: readonly ExplainOption[];
  /** Worlds sampled for this estimate. */
  readonly n: number;
}

/** Goodness of a bp value from `seat`'s perspective (higher = better). */
export function goodnessOf(bp: number, declaringTeam: boolean): number {
  return declaringTeam ? bp : 10000 - bp;
}


const cache = new Map<string, Explanation>();

/**
 * Price every option the seat had at (trick, play). Resolves to null when
 * out of scope or the solver isn't available; cached per (hand, decision, n).
 */
export async function explainMove(
  g: GameState,
  trick: number,
  play: number,
  n: number = EXPLAIN_N,
): Promise<Explanation | null> {
  const built = explainRequestOf(g, trick, play, n);
  if (!built || built.req.contract) return null;
  const key = JSON.stringify(built.req);
  const hit = cache.get(key);
  if (hit) return hit;

  const resp = (await runWalt('play', built.req)) as PlayResponse | null;
  if (!resp) return null;

  const declaringTeam = teamOf(built.seat) === teamOf(g.declarer!);
  let options: ExplainOption[] = [];
  if (!resp.forced && resp.opts.length > 0) {
    const sorted = [...resp.opts].sort(
      (a, b) => goodnessOf(b[1], declaringTeam) - goodnessOf(a[1], declaringTeam),
    );
    const bestGoodness = goodnessOf(sorted[0]![1], declaringTeam);
    options = sorted.map(([tile, bp]) => {
      const id = idOfTile(tile);
      return {
        domino: id,
        bp,
        played: id === built.domino,
        best: goodnessOf(bp, declaringTeam) === bestGoodness,
      };
    });
  }

  const exp: Explanation = {
    seat: built.seat,
    domino: built.domino,
    forced: resp.forced,
    declaringTeam,
    options,
    n,
  };
  cache.set(key, exp);
  return exp;
}
