/** Pure reconstruction of one past own/public view. No solver imports. */
import { type GameState, type Seat, type DominoId, toSeed } from '../engine';
import { tileOfId, waltContractBid, waltDeclId } from './walt/requests';
import type { PlayRequest } from './walt/walt';
const EXPLAIN_N = 40, EXPLAIN_N0 = 8;
/** Can this finished (or in-progress) hand be analyzed by walt at all? */
export function explainScope(g: GameState): boolean {
  return (
    waltDeclId(g.declaration) !== null &&
    waltContractBid(g.contract) !== null &&
    g.declarer !== null &&
    g.sittingOut === null
  );
}

/**
 * Build the walt request for the decision at (trick, play) — the state
 * BEFORE that tile hit the table. Null when out of scope or out of range.
 */
export function explainRequestOf(
  g: GameState,
  trick: number,
  play: number,
  n: number = EXPLAIN_N,
): { req: PlayRequest; seat: Seat; domino: DominoId } | null {
  if (!explainScope(g)) return null;
  const decl = waltDeclId(g.declaration);
  const bid = waltContractBid(g.contract);
  if (decl === null || bid === null || g.declarer === null) return null;
  const target = g.tricks[trick]?.plays[play];
  if (!target) return null;

  const plays: number[] = [];
  for (let t = 0; t < trick; t++) {
    for (const p of g.tricks[t]!.plays) plays.push(p.seat, tileOfId(p.domino));
  }
  for (let i = 0; i < play; i++) {
    const p = g.tricks[trick]!.plays[i]!;
    plays.push(p.seat, tileOfId(p.domino));
  }

  const dealt = g.dealt[target.seat] ?? [];
  if (dealt.length !== 7) return null;
  const hand = dealt.map(tileOfId).sort((a, b) => a - b);

  return {
    req: {
      decl,
      bid,
      seat: target.seat,
      bidder: g.declarer,
      hand,
      plays,
      n,
      n0: EXPLAIN_N0,
      seed: toSeed(`explain/${g.handNumber}/${g.shaker}`),
      race: false, // the full evaluator — per-option values are the point
    },
    seat: target.seat,
    domino: target.domino,
  };
}

