/**
 * The suit algebra, translated directly from docs/SUIT_ALGEBRA_PURE.md.
 *
 * A declaration's entire semantic content is the pair (κ, π): which dominoes
 * are *called* into the 8th suit, and whether that suit has *power* (trump).
 * TrickRules carries that pair plus the two rank-variant knobs from
 * docs/RULES.md §9 (doubles high/low in pip suits, inverted own-suit order).
 */

import {
  type Domino, type DominoId, type Pip,
  fromId, hasPip, isDouble, pipSum,
} from './dominoes';

/** Led suit ℓ ∈ {0..6} (pip suits) ∪ {7} (the called suit). */
export type LedSuit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const CALLED_SUIT = 7 as const;

export interface TrickRules {
  /** κ(δ): pip p → σ_p; doubles → D°; none → ∅ (no-trump). */
  readonly called: { kind: 'pip'; pip: Pip } | { kind: 'doubles' } | { kind: 'none' };
  /** π(δ) = κ(δ) when powered (trump), ∅ otherwise (nello / follow-me). */
  readonly powered: boolean;
  /** Doubles' rank inside their natural pip suit: high (standard) or low. */
  readonly pipSuitDoubles: 'high' | 'low';
  /** Rank order when doubles form their own suit: 6-6 high (normal) or 0-0 high (inverted). */
  readonly calledDoublesOrder: 'normal' | 'inverted';
}

/** d ∈ κ(δ) */
export function isCalled(d: Domino, rules: TrickRules): boolean {
  switch (rules.called.kind) {
    case 'pip': return hasPip(d, rules.called.pip);
    case 'doubles': return isDouble(d);
    case 'none': return false;
  }
}

/** d ∈ π(δ) — has power over both pip suits. */
export function isPowered(d: Domino, rules: TrickRules): boolean {
  return rules.powered && isCalled(d, rules);
}

/** ℓ(d, δ): the suit a led domino calls for. */
export function ledSuitOf(d: Domino, rules: TrickRules): LedSuit {
  return isCalled(d, rules) ? CALLED_SUIT : d.high;
}

/** follows(d, ℓ, δ): d ∈ σ̂_ℓ — can d follow a lead of suit ℓ? */
export function follows(d: Domino, led: LedSuit, rules: TrickRules): boolean {
  if (led === CALLED_SUIT) return isCalled(d, rules);
  return hasPip(d, led) && !isCalled(d, rules);
}

/** Rank ⊤: the double tops its pip suit. Any number above all pip sums works. */
const TOP = 100;
/** Rank ⊥ for the doubles-low variant: below every pip sum. */
const BOTTOM = -1;

/**
 * rank(d, δ): rank within a suit — depends only on the domino and the
 * declaration, never on what was led (SUIT_ALGEBRA §6, cases read top-down).
 */
export function rank(d: Domino, rules: TrickRules): number {
  if (rules.called.kind === 'doubles' && isDouble(d)) {
    // Doubles as a suit: rank by pip value (optionally inverted).
    return rules.calledDoublesOrder === 'normal' ? d.high : 6 - d.high;
  }
  if (isDouble(d)) {
    return rules.pipSuitDoubles === 'high' ? TOP : BOTTOM;
  }
  return pipSum(d);
}

/** tier(d, ℓ, δ): 2 = trump, 1 = follows the led suit, 0 = slough. */
export function tier(d: Domino, led: LedSuit, rules: TrickRules): 0 | 1 | 2 {
  if (isPowered(d, rules)) return 2;
  if (follows(d, led, rules)) return 1;
  return 0;
}

export interface TrickPlay {
  readonly seat: number;
  readonly domino: DominoId;
}

/**
 * Trick winner = argmax over τ(d, ℓ, δ) = (tier, rank) lexicographic.
 * Unique by SUIT_ALGEBRA §7; sloughs (tier 0) can never win.
 */
export function trickWinnerIndex(plays: readonly TrickPlay[], rules: TrickRules): number {
  const lead = plays[0];
  if (!lead) throw new Error('empty trick');
  const led = ledSuitOf(fromId(lead.domino), rules);
  let best = 0;
  let bestTier = tier(fromId(lead.domino), led, rules);
  let bestRank = rank(fromId(lead.domino), rules);
  for (let i = 1; i < plays.length; i++) {
    const d = fromId(plays[i]!.domino);
    const t = tier(d, led, rules);
    if (t === 0) continue;
    const r = rank(d, rules);
    if (t > bestTier || (t === bestTier && r > bestRank)) {
      best = i;
      bestTier = t;
      bestRank = r;
    }
  }
  return best;
}

/**
 * Legal plays from `hand` given the domino that led the trick (or null when
 * leading). Step 2 of SUIT_ALGEBRA §8: follow if you can, anything if you can't.
 */
export function legalPlays(
  hand: readonly DominoId[],
  leadDomino: DominoId | null,
  rules: TrickRules,
): DominoId[] {
  if (leadDomino === null) return [...hand];
  const led = ledSuitOf(fromId(leadDomino), rules);
  const followers = hand.filter((id) => follows(fromId(id), led, rules));
  return followers.length > 0 ? followers : [...hand];
}
