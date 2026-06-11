/**
 * Medium: a solid club player on pure heuristics.
 *
 * Bidding   — rates every candidate trump (count, quality, doubles, count
 *             security → expected points), bids the ladder honestly, and
 *             recognizes Nel-O, Plunge and Splash hands.
 * Declaring — best trump by the same evaluation; Nel-O when the hand fits.
 * Play      — declarer pulls trump while holding control then cashes
 *             winners; defenders protect count, feed count to partner's sure
 *             winners, duck cheaply when a trick is lost, and ruff 10-counts;
 *             dedicated Nel-O logic on both sides.
 *
 * Everything here sees only the Observation (own hand + public info).
 */

import {
  type Action,
  type Bid,
  type Declaration,
  type DominoId,
  type LedSuit,
  type Seat,
  type TrickRules,
  bidStrength,
  countValue,
  follows,
  fromId,
  highBid,
  isCalled,
  isDouble,
  ledSuitOf,
  partnerOf,
  rank,
  teamOf,
  tier,
  trickWinnerIndex,
} from '../engine';
import type { Observation } from './observation';
import {
  nelloDanger,
  plungeWorthy,
  rateDeclarations,
  splashWorthy,
} from './evaluate';

type BidAction = Extract<Action, { type: 'bid' }>;
type DeclareAction = Extract<Action, { type: 'declare' }>;
type PlayAction = Extract<Action, { type: 'play' }>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function minBy<T>(items: readonly T[], key: (t: T) => number): T {
  let best = items[0]!;
  let bestK = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]!);
    if (k < bestK) {
      best = items[i]!;
      bestK = k;
    }
  }
  return best;
}

function maxBy<T>(items: readonly T[], key: (t: T) => number): T {
  return minBy(items, (t) => -key(t));
}

/** Trick order τ as a single number: tier*1000 + rank; sloughs identified at −1. */
function tauOf(id: DominoId, led: LedSuit, rules: TrickRules): number {
  const d = fromId(id);
  const t = tier(d, led, rules);
  return t === 0 ? -1 : t * 1000 + rank(d, rules);
}

/** Could any unseen domino beat τ on this lead? (Conservative: the beater
 *  might be partner's — we can't know, so we treat it as a threat.) */
function unseenBeats(obs: Observation, tauVal: number, led: LedSuit): boolean {
  const rules = obs.rules!;
  return obs.unseen.some((u) => tauOf(u, led, rules) > tauVal);
}

/** Is this domino, led right now, unbeatable by any unseen domino? */
function bossWhenLed(obs: Observation, id: DominoId): boolean {
  const rules = obs.rules!;
  const led = ledSuitOf(fromId(id), rules);
  return !unseenBeats(obs, tauOf(id, led, rules), led);
}

function isTrump(id: DominoId, rules: TrickRules): boolean {
  return rules.powered && isCalled(fromId(id), rules);
}

function sameDecl(a: Declaration, b: Declaration): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'pip' && b.type === 'pip') return a.pip === b.pip;
  return true;
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

function marksValue(b: Bid): number {
  return b.kind === 'marks' ? b.value : 99;
}

export function mediumBid(obs: Observation, acts: readonly Action[]): Action {
  const bids = acts.filter((a): a is BidAction => a.type === 'bid');
  const pass = bids.find((a) => a.bid.kind === 'pass');
  const hand = obs.hand;
  const cfg = obs.config;

  // Specials: Plunge with 4+ big doubles; Splash with 3 when strong.
  const plunges = bids.filter((a) => a.bid.kind === 'marks' && a.bid.special === 'plunge');
  if (plunges.length > 0 && plungeWorthy(hand)) {
    return minBy(plunges, (a) => marksValue(a.bid));
  }
  const splashes = bids.filter((a) => a.bid.kind === 'marks' && a.bid.special === 'splash');
  if (splashes.length > 0 && splashWorthy(hand) && !plungeWorthy(hand)) {
    return minBy(splashes, (a) => marksValue(a.bid));
  }

  const cur = highBid(obs.bids);
  const curStr = cur ? bidStrength(cur.bid) : 0;
  const partnerHigh = cur !== null && cur.seat === partnerOf(obs.seat);
  const best = rateDeclarations(hand, cfg)[0]!;
  const exp = best.score.expectedPoints;
  const danger = cfg.nello !== 'off' ? nelloDanger(hand, cfg) : 99;

  // Forced bid (no pass available): least-bad option.
  if (!pass) {
    const nelloForced = bids.filter(
      (a) => a.bid.kind === 'marks' && a.bid.special === 'nello',
    );
    if (nelloForced.length > 0 && danger <= 4 && exp < 32) {
      return minBy(nelloForced, (a) => marksValue(a.bid));
    }
    return bids.find((a) => a.bid.kind === 'points') ?? bids[0]!;
  }

  // Open Nel-O: a quiet marks bid now, the nello declaration later.
  if (cfg.nello === 'open' && danger <= 2.0 && exp < 38) {
    const v = Math.max(1, cfg.nelloMinMarks);
    const mark = bids.find(
      (a) => a.bid.kind === 'marks' && !a.bid.special && a.bid.value === v && a.bid.value <= 2,
    );
    if (mark && (danger <= 1.2 || curStr === 0) && !partnerHigh) return mark;
  }

  // Lay-down marks bids (must take all 42).
  if (best.score.estTricks >= 6.8) {
    const m1 = bids.find((a) => a.bid.kind === 'marks' && !a.bid.special && a.bid.value === 1);
    if (m1 && curStr <= 41) return m1;
    if (best.score.estTricks >= 7) {
      const m2 = bids.find(
        (a) => a.bid.kind === 'marks' && !a.bid.special && a.bid.value === 2,
      );
      if (m2) return m2;
    }
  }

  // The honest points ladder: bid the minimum needed, up to what the hand is worth.
  const willing = Math.floor(exp);
  const raisingPartnerOk = !partnerHigh || willing >= curStr + 4;
  if (willing >= 30 && raisingPartnerOk) {
    const target = Math.max(30, curStr + 1);
    if (target <= 41 && target <= willing) {
      const pb = bids.find((a) => a.bid.kind === 'points' && a.bid.value === target);
      if (pb) return pb;
    }
  }
  return pass;
}

// ---------------------------------------------------------------------------
// Declaring
// ---------------------------------------------------------------------------

export function mediumDeclare(obs: Observation, acts: readonly Action[]): Action {
  const decls = acts.filter((a): a is DeclareAction => a.type === 'declare');
  const hand = obs.hand;
  const cfg = obs.config;
  const contract = obs.contract;

  // All-or-nothing contracts care about tricks, not points.
  const allTricksNeeded = contract !== null && contract.kind !== 'points';
  const rated = rateDeclarations(hand, cfg, allTricksNeeded).filter((r) =>
    decls.some((a) => sameDecl(a.decl, r.decl)),
  );
  const best = rated[0];

  const nello = decls.find((a) => a.decl.type === 'nello');
  if (nello) {
    const danger = nelloDanger(hand, cfg);
    if (danger <= 2.0 && (best?.score.estTricks ?? 0) < 6.5) return nello;
  }
  if (best) return decls.find((a) => sameDecl(a.decl, best.decl))!;
  return decls[0]!;
}

// ---------------------------------------------------------------------------
// Trick play — normal (trump / no-trump) contracts
// ---------------------------------------------------------------------------

/** Throwaway choice: cheapest tile that isn't count and isn't a future boss. */
function duck(obs: Observation, legal: readonly DominoId[]): DominoId {
  const rules = obs.rules!;
  return minBy(legal, (id) => {
    const d = fromId(id);
    return (
      countValue(d) * 100 +
      (bossWhenLed(obs, id) ? 45 : 0) +
      (isTrump(id, rules) ? 25 : 0) +
      rank(d, rules)
    );
  });
}

/** Feed count to a won trick: biggest count first, else cheapest junk. */
function giveCount(obs: Observation, legal: readonly DominoId[]): DominoId {
  const counts = legal.filter((id) => countValue(fromId(id)) > 0);
  if (counts.length === 0) return duck(obs, legal);
  return maxBy(counts, (id) => countValue(fromId(id)) * 100 - rank(fromId(id), obs.rules!));
}

function chooseLead(obs: Observation, legal: readonly DominoId[]): DominoId {
  const rules = obs.rules!;
  const onDeclTeam = teamOf(obs.seat) === teamOf(obs.declarer!);
  const unseenTrumps = rules.powered
    ? obs.unseen.filter((u) => isCalled(fromId(u), rules)).length
    : 0;
  const myTrumps = legal
    .filter((id) => isCalled(fromId(id), rules))
    .sort((a, b) => rank(fromId(b), rules) - rank(fromId(a), rules));

  // Declaring side: pull trump while holding control.
  if (rules.powered && onDeclTeam && myTrumps.length > 0 && unseenTrumps > 0) {
    const top = myTrumps[0]!;
    const topIsBoss = !obs.unseen.some(
      (u) => isCalled(fromId(u), rules) && rank(fromId(u), rules) > rank(fromId(top), rules),
    );
    if (topIsBoss) return top;
    // No boss but a long holding: flush the boss out with a low trump.
    if (myTrumps.length >= 2 && myTrumps.length >= unseenTrumps) {
      return myTrumps[myTrumps.length - 1]!;
    }
  }

  // Cash certain winners (counts trump threats — strict boss only).
  const bosses = legal.filter((id) => bossWhenLed(obs, id));
  if (bosses.length > 0) {
    return maxBy(bosses, (id) => {
      const d = fromId(id);
      return (isDouble(d) ? 1000 : 0) + countValue(d) * 10 + rank(d, rules);
    });
  }

  // Off doubles are strong leads — only a ruff beats them.
  const offDoubles = legal.filter(
    (id) => isDouble(fromId(id)) && !isCalled(fromId(id), rules),
  );
  if (offDoubles.length > 0 && unseenTrumps <= 4) {
    return maxBy(offDoubles, (id) => fromId(id).high);
  }

  // Exit cheaply: low, non-count, not a stranded boss.
  return duck(obs, legal);
}

function chooseFollow(obs: Observation, legal: readonly DominoId[]): DominoId {
  const rules = obs.rules!;
  const trick = obs.currentTrick;
  const me = obs.seat;
  const led = ledSuitOf(fromId(trick[0]!.domino), rules);
  const winIdx = trickWinnerIndex(trick, rules);
  const winSeat = trick[winIdx]!.seat as Seat;
  const winTau = tauOf(trick[winIdx]!.domino, led, rules);
  const trickSize = obs.sittingOut === null ? 4 : 3;
  const iAmLast = trick.length === trickSize - 1;
  const trickPts =
    1 + trick.reduce((acc, p) => acc + countValue(fromId(p.domino)), 0);

  const winners = legal.filter((id) => tauOf(id, led, rules) > winTau);
  const certainWin = (id: DominoId) =>
    iAmLast || !unseenBeats(obs, tauOf(id, led, rules), led);

  if (winSeat === partnerOf(me)) {
    const partnerCertain = iAmLast || !unseenBeats(obs, winTau, led);
    if (partnerCertain) return giveCount(obs, legal);
    // Partner may be overtaken: lock down big tricks ourselves.
    const certains = winners.filter(certainWin);
    if (certains.length > 0 && trickPts >= 6) {
      return minBy(certains, (id) => tauOf(id, led, rules));
    }
    return duck(obs, legal);
  }

  // An opponent is winning (or led and still holds it).
  if (winners.length > 0) {
    const certains = winners.filter(certainWin);
    if (certains.length > 0) {
      const cheapest = minBy(certains, (id) => tauOf(id, led, rules));
      // Don't burn a stranded boss on a pointless trick.
      if (trickPts >= 2 || iAmLast || !bossWhenLed(obs, cheapest)) return cheapest;
      return duck(obs, legal);
    }
    // No certain winner: contest only big tricks, with our strongest non-count.
    if (trickPts >= 10) {
      const nonCount = winners.filter((id) => countValue(fromId(id)) === 0);
      const pool = nonCount.length > 0 ? nonCount : winners;
      return maxBy(pool, (id) => tauOf(id, led, rules));
    }
  }
  return duck(obs, legal);
}

// ---------------------------------------------------------------------------
// Nel-O play
// ---------------------------------------------------------------------------

function nelloPlay(obs: Observation, legal: readonly DominoId[]): DominoId {
  const rules = obs.rules!;
  const declarer = obs.declarer!;
  const trick = obs.currentTrick;

  if (obs.seat === declarer) {
    if (trick.length === 0) {
      // Lead the tile most likely to be covered.
      return minBy(legal, (id) => {
        const led = ledSuitOf(fromId(id), rules);
        const myTau = tauOf(id, led, rules);
        let above = 0;
        let below = 0;
        for (const u of obs.unseen) {
          const t = tauOf(u, led, rules);
          if (t < 0) continue;
          if (t > myTau) above++;
          else below++;
        }
        return below * 10 - Math.min(above, 3) * 4 + rank(fromId(id), rules);
      });
    }
    const led = ledSuitOf(fromId(trick[0]!.domino), rules);
    const winTau = tauOf(trick[trickWinnerIndex(trick, rules)]!.domino, led, rules);
    const under = legal.filter((id) => tauOf(id, led, rules) < winTau);
    // Shed the most dangerous tile that still stays under.
    if (under.length > 0) return maxBy(under, (id) => rank(fromId(id), rules));
    return minBy(legal, (id) => rank(fromId(id), rules)); // doomed — stay low
  }

  // Defender: force the bidder to win a trick.
  if (trick.length === 0) {
    // Lead low — preferably a tile that's near the floor of its suit.
    return minBy(legal, (id) => {
      const led = ledSuitOf(fromId(id), rules);
      const myTau = tauOf(id, led, rules);
      const below = obs.unseen.filter((u) => {
        const t = tauOf(u, led, rules);
        return t >= 0 && t < myTau;
      }).length;
      return rank(fromId(id), rules) + below * 3;
    });
  }

  const led = ledSuitOf(fromId(trick[0]!.domino), rules);
  const declPlay = trick.find((p) => p.seat === declarer);
  if (!declPlay) {
    // Bidder still to play: keep the trick low if following, shed if sloughing.
    const following = legal.filter((id) => follows(fromId(id), led, rules));
    if (following.length > 0) return minBy(following, (id) => tauOf(id, led, rules));
    return maxBy(legal, (id) => rank(fromId(id), rules));
  }
  const winIdx = trickWinnerIndex(trick, rules);
  if (trick[winIdx]!.seat === declarer) {
    // Bidder is winning — stay under them.
    const winTau = tauOf(trick[winIdx]!.domino, led, rules);
    const under = legal.filter((id) => tauOf(id, led, rules) < winTau);
    if (under.length > 0) return maxBy(under, (id) => tauOf(id, led, rules));
    return minBy(legal, (id) => tauOf(id, led, rules));
  }
  // Bidder escaped this trick: shed our most dangerous tile.
  return maxBy(legal, (id) => rank(fromId(id), rules));
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function mediumPlay(
  obs: Observation,
  legal: readonly DominoId[],
): DominoId {
  if (legal.length === 1) return legal[0]!;
  const contract = obs.contract!;
  if (contract.kind === 'sevens') return legal[0]!; // forced up to ties
  if (contract.kind === 'nello') return nelloPlay(obs, legal);
  if (obs.currentTrick.length === 0) return chooseLead(obs, legal);
  return chooseFollow(obs, legal);
}

/** Medium's full policy over an Observation and the legal action list. */
export function mediumAction(
  obs: Observation,
  acts: readonly Action[],
  _rand: () => number,
): Action {
  switch (obs.phase) {
    case 'bidding':
      return mediumBid(obs, acts);
    case 'declaring':
      return mediumDeclare(obs, acts);
    case 'playing': {
      const legal = acts
        .filter((a): a is PlayAction => a.type === 'play')
        .map((a) => a.domino);
      return { type: 'play', domino: mediumPlay(obs, legal) };
    }
    default:
      return acts[0]!;
  }
}
