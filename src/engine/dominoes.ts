/**
 * The double-six domino set, per docs/SUIT_ALGEBRA_PURE.md §1.
 * A domino is a 2-element multiset of pip values; we canonicalize as high ≥ low.
 */

export type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const PIPS: readonly Pip[] = [0, 1, 2, 3, 4, 5, 6];

export interface Domino {
  readonly high: Pip;
  readonly low: Pip;
}

/** Canonical id: `${high}${low}`, e.g. "65" for the 6-5. */
export type DominoId = string;

export function dom(a: Pip, b: Pip): Domino {
  return a >= b ? { high: a, low: b } : { high: b, low: a };
}

export function idOf(d: Domino): DominoId {
  return `${d.high}${d.low}`;
}

export function fromId(id: DominoId): Domino {
  const high = Number(id[0]) as Pip;
  const low = Number(id[1]) as Pip;
  if (
    id.length !== 2 ||
    !Number.isInteger(high) || !Number.isInteger(low) ||
    high < 0 || high > 6 || low < 0 || low > high
  ) {
    throw new Error(`invalid domino id: ${JSON.stringify(id)}`);
  }
  return { high, low };
}

/** All 28 dominoes of the double-six set. */
export const ALL_DOMINOES: readonly Domino[] = PIPS.flatMap((high) =>
  PIPS.filter((low) => low <= high).map((low) => dom(high, low)),
);

export const ALL_DOMINO_IDS: readonly DominoId[] = ALL_DOMINOES.map(idOf);

export function isDouble(d: Domino): boolean {
  return d.high === d.low;
}

export function pipSum(d: Domino): number {
  return d.high + d.low;
}

export function hasPip(d: Domino, p: Pip): boolean {
  return d.high === p || d.low === p;
}

/** Count value: 10 for 5-5 and 6-4, 5 for 5-0/4-1/3-2, else 0. */
export function countValue(d: Domino): 0 | 5 | 10 {
  const s = pipSum(d);
  return s === 10 ? 10 : s === 5 ? 5 : 0;
}

/** 7 trick points + 35 count points. */
export const TOTAL_HAND_POINTS = 42;

export function doublesIn(hand: readonly DominoId[]): number {
  return hand.filter((id) => isDouble(fromId(id))).length;
}
