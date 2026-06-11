/**
 * Hand evaluation: candidate-trump scoring, Nel-O safety, and the
 * Plunge/Splash qualifiers. Pure functions of (hand, config) — these only
 * ever see the evaluating player's own 7 dominoes.
 */

import {
  ALL_DOMINO_IDS,
  type Declaration,
  type DominoId,
  type GameConfig,
  type Pip,
  type TrickRules,
  buildRules,
  countValue,
  fromId,
  hasPip,
  isCalled,
  isDouble,
  pipSum,
  rank,
} from '../engine';

const PIPS_DESC: readonly Pip[] = [6, 5, 4, 3, 2, 1, 0];

export interface DeclEval {
  /** Estimated tricks my side takes if I declare this and lead. */
  readonly estTricks: number;
  /** Estimated points (tricks + count) for my team — calibrated to 0..42. */
  readonly expectedPoints: number;
}

/** Members of effective suit s under `rules`, ranked descending. */
function effectiveSuitDesc(s: Pip, rules: TrickRules): DominoId[] {
  return ALL_DOMINO_IDS.filter((id) => {
    const d = fromId(id);
    return hasPip(d, s) && !isCalled(d, rules);
  }).sort((a, b) => rank(fromId(b), rules) - rank(fromId(a), rules));
}

/**
 * Score a candidate declaration (pip trump / doubles trump / no-trump) for a
 * 7-domino hand. Nello and sevens are rated elsewhere.
 */
export function evalDeclaration(
  hand: readonly DominoId[],
  decl: Declaration,
  cfg: GameConfig,
): DeclEval {
  const rules = buildRules(decl, cfg);
  if (!rules || decl.type === 'nello' || decl.type === 'sevens') {
    return { estTricks: 0, expectedPoints: 0 };
  }
  const mine = new Set(hand);
  const used = new Set<DominoId>();
  let estTricks = 0;

  if (rules.powered) {
    const allTrump = ALL_DOMINO_IDS.filter((id) => isCalled(fromId(id), rules)).sort(
      (a, b) => rank(fromId(b), rules) - rank(fromId(a), rules),
    );
    const myTrumps = allTrump.filter((id) => mine.has(id));
    let sureRun = 0;
    for (const id of allTrump) {
      if (mine.has(id)) sureRun++;
      else break;
    }
    const outTrumps = allTrump.length - myTrumps.length;
    const extras = myTrumps.length - sureRun;
    // Extra (non-boss) trumps are worth more when I out-number the field.
    const extraVal =
      myTrumps.length > outTrumps ? 0.8 : myTrumps.length === outTrumps ? 0.55 : 0.35;
    estTricks += sureRun + extras * extraVal;
    if (myTrumps.length === 0) estTricks -= 1.5; // trumpless declarations are awful
    if (myTrumps.length === 1) estTricks -= 0.5; // a lone trump is barely a suit
    for (const id of myTrumps) used.add(id);
  }

  // Off-suit winners: the top (and second) of each effective pip suit.
  for (const s of PIPS_DESC) {
    const suit = effectiveSuitDesc(s, rules);
    const top = suit[0];
    if (!top || !mine.has(top) || used.has(top)) continue;
    const myLen = suit.filter((id) => mine.has(id)).length;
    // Doubles stand up on the first round almost always; bare bosses a bit less.
    estTricks += (isDouble(fromId(top)) ? 0.85 : 0.6) - 0.06 * Math.max(0, myLen - 2);
    used.add(top);
    const second = suit[1];
    if (second && mine.has(second) && !used.has(second)) {
      estTricks += 0.4;
      used.add(second);
    }
  }
  estTricks = Math.max(0, Math.min(7, estTricks));

  // Count security: my own count dominoes that ride on winners are safe;
  // loose count in weak suits gets captured by the defense.
  let security = 0;
  for (const id of hand) {
    const cv = countValue(fromId(id));
    if (cv === 0) continue;
    if (used.has(id)) security += 1;
    else security -= cv === 10 ? 1.6 : 0.8;
  }
  // Partner takes a share of the tricks I don't: 1 of 3 unknown hands,
  // ~6 points per trick.
  const partnerHelp = (7 - estTricks) * 1.7;
  return { estTricks, expectedPoints: estTricks * 6 + security + partnerHelp };
}

export interface RatedDecl {
  readonly decl: Declaration;
  readonly score: DeclEval;
}

/** All trump-style declarations (7 pips, doubles, no-trump), best first. */
export function rateDeclarations(
  hand: readonly DominoId[],
  cfg: GameConfig,
  byTricks = false,
): RatedDecl[] {
  const candidates: Declaration[] = [
    ...PIPS_DESC.map((pip): Declaration => ({ type: 'pip', pip })),
    { type: 'doubles' },
    { type: 'no-trump' },
  ];
  const rated = candidates.map((decl) => ({ decl, score: evalDeclaration(hand, decl, cfg) }));
  rated.sort((a, b) =>
    byTricks
      ? b.score.estTricks - a.score.estTricks
      : b.score.expectedPoints - a.score.expectedPoints,
  );
  return rated;
}

/**
 * Nel-O danger: roughly "how many tricks am I at risk of winning".
 * 0 ≈ stone-cold; ≥3 is reckless.
 */
export function nelloDanger(hand: readonly DominoId[], cfg: GameConfig): number {
  const rules = buildRules({ type: 'nello' }, cfg);
  if (!rules) return 99;
  const mine = new Set(hand);
  let danger = 0;

  // Doubles. Under own-suit doubles their pip value is the whole story;
  // doubles-high-in-suit makes every double near-lethal.
  const OWN_SUIT_W = [0, 0.4, 1.0, 1.8, 2.8, 4.0, 5.5];
  for (const id of hand) {
    const d = fromId(id);
    if (!isDouble(d)) continue;
    if (rules.called.kind === 'doubles') {
      danger += OWN_SUIT_W[rank(d, rules)] ?? 5.5;
    } else if (rules.pipSuitDoubles === 'high') {
      danger += 4.5;
    }
    // doubles-low: a double is the floor of its suit — handled below.
  }

  // For each suit I hold: how much room is under my lowest member?
  for (const s of PIPS_DESC) {
    const suitAsc = effectiveSuitDesc(s, rules).reverse();
    const mineIn = suitAsc.filter((id) => mine.has(id));
    const lowest = mineIn[0];
    if (!lowest) continue;
    const myMin = rank(fromId(lowest), rules);
    const below = suitAsc.filter(
      (id) => !mine.has(id) && rank(fromId(id), rules) < myMin,
    ).length;
    danger += below * 0.9;
  }
  return danger;
}

export function doublePipsDesc(hand: readonly DominoId[]): number[] {
  return hand
    .map(fromId)
    .filter(isDouble)
    .map((d) => d.high)
    .sort((a, b) => b - a);
}

/**
 * A "lay-down" Plunge. The team must take all 7 tricks with the partner
 * naming trump blind, so one loose domino is fatal — demand 5+ doubles, or
 * 4 big doubles with every off-domino heavy enough to ride under them.
 */
export function plungeWorthy(hand: readonly DominoId[]): boolean {
  const dp = doublePipsDesc(hand);
  if (dp.length >= 5) return true;
  if (dp.length < 4) return false;
  const sum = dp.reduce((a, b) => a + b, 0);
  const offs = hand.map(fromId).filter((d) => !isDouble(d));
  const weakOffs = offs.filter((d) => pipSum(d) < 8).length;
  return sum >= 16 && weakOffs === 0;
}

/** Splash: 3-double hands strong enough to demand all 7 tricks — near-laydown only. */
export function splashWorthy(hand: readonly DominoId[]): boolean {
  const dp = doublePipsDesc(hand);
  if (dp.length < 3) return false;
  const top3 = dp[0]! + dp[1]! + dp[2]!;
  const offs = hand.map(fromId).filter((d) => !isDouble(d));
  const weakOffs = offs.filter((d) => pipSum(d) < 9).length;
  return top3 >= 15 && weakOffs === 0;
}
