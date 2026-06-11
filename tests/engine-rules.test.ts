/**
 * Pointed unit tests taken directly from the rules text (docs/RULES.md):
 * suit ranking examples, count dominoes, lead semantics, follow/renege rules,
 * trick-winner examples, forced-bid configs, Nel-O / Plunge / Splash flows,
 * early hand termination, and game end at 7 marks.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_DOMINO_IDS,
  CASUAL_CONFIG,
  TOURNAMENT_CONFIG,
  TOTAL_HAND_POINTS,
  applyAction,
  buildRules,
  countValue,
  doublesIn,
  follows,
  fromId,
  isCalled,
  ledSuitOf,
  legalActions,
  legalPlays,
  mulberry32,
  newGame,
  nextSeat,
  otherTeam,
  partnerOf,
  rank,
  tier,
  toSeed,
  trickWinnerIndex,
} from '../src/engine';
import type {
  Action, Bid, GameConfig, GameState, Seat,
} from '../src/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bidA = (bid: Bid): Action => ({ type: 'bid', bid });
const passA: Action = { type: 'bid', bid: { kind: 'pass' } };

function passUntil(state: GameState, seat: Seat): GameState {
  let st = state;
  while (st.turn !== seat) st = applyAction(st, passA);
  return st;
}

function passOutBidding(state: GameState): GameState {
  let st = state;
  while (st.phase === 'bidding') st = applyAction(st, passA);
  return st;
}

function offeredBids(state: GameState): Bid[] {
  return legalActions(state).flatMap((a) => (a.type === 'bid' ? [a.bid] : []));
}

/** Play random legal actions until the hand (or game) is over. */
function playOut(state: GameState, seed: string): GameState {
  const rand = mulberry32(toSeed(seed));
  let st = state;
  while (st.phase === 'playing' || st.phase === 'declaring') {
    const as = legalActions(st);
    st = applyAction(st, as[Math.floor(rand() * as.length)]!);
  }
  return st;
}

/** Bidding order for a fresh hand: left of shaker, clockwise, shaker last. */
function biddingOrder(state: GameState): Seat[] {
  const first = nextSeat(state.shaker);
  return [first, nextSeat(first), nextSeat(nextSeat(first)), state.shaker];
}

// ---------------------------------------------------------------------------
// §4.1 — suit membership and ranking
// ---------------------------------------------------------------------------

describe('§4.1 pip trump ranking', () => {
  it('threes trump: 3-3 > 6-3 > 5-3 > 4-3 > 3-2 > 3-1 > 3-0', () => {
    const rules = buildRules({ type: 'pip', pip: 3 }, CASUAL_CONFIG)!;
    const order = ['33', '63', '53', '43', '32', '31', '30'];
    // All seven are trumps, in every trick a tier-2 (powered) play.
    for (const id of order) {
      expect(isCalled(fromId(id), rules)).toBe(true);
      expect(tier(fromId(id), 0, rules)).toBe(2);
    }
    // Ranks strictly descending along the documented order.
    const ranks = order.map((id) => rank(fromId(id), rules));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeLessThan(ranks[i - 1]!);
    // And pairwise, the higher trump wins regardless of play order.
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        expect(
          trickWinnerIndex([{ seat: 0, domino: order[i]! }, { seat: 1, domino: order[j]! }], rules),
        ).toBe(0);
        expect(
          trickWinnerIndex([{ seat: 0, domino: order[j]! }, { seat: 1, domino: order[i]! }], rules),
        ).toBe(1);
      }
    }
  });

  it('threes trump: the effective sixes suit ranks 6-6 > 6-5 > 6-4 > 6-2 > 6-1 > 6-0 (6-3 is a trump)', () => {
    const rules = buildRules({ type: 'pip', pip: 3 }, CASUAL_CONFIG)!;
    const suit6 = ALL_DOMINO_IDS.filter((id) => follows(fromId(id), 6, rules));
    expect([...suit6].sort()).toEqual(['60', '61', '62', '64', '65', '66'].sort());
    const order = ['66', '65', '64', '62', '61', '60'];
    const ranks = order.map((id) => rank(fromId(id), rules));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeLessThan(ranks[i - 1]!);
  });

  it('any trump beats every non-trump, even the top of the led suit', () => {
    const rules = buildRules({ type: 'pip', pip: 3 }, CASUAL_CONFIG)!;
    // 6-6 led; 3-0 (lowest trump) still wins the trick.
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '66' },
          { seat: 1, domino: '65' },
          { seat: 2, domino: '30' },
          { seat: 3, domino: '64' },
        ],
        rules,
      ),
    ).toBe(2);
  });
});

describe('doubles trump', () => {
  const rules = buildRules({ type: 'doubles' }, CASUAL_CONFIG)!;

  it('ranks 6-6 high down to 0-0 low', () => {
    const order = ['66', '55', '44', '33', '22', '11', '00'];
    const ranks = order.map((id) => rank(fromId(id), rules));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeLessThan(ranks[i - 1]!);
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        expect(
          trickWinnerIndex([{ seat: 0, domino: order[i]! }, { seat: 1, domino: order[j]! }], rules),
        ).toBe(0);
      }
    }
  });

  it('a led double calls for doubles; the lowest double trumps any non-double', () => {
    expect(ledSuitOf(fromId('33'), rules)).toBe(7);
    expect(legalPlays(['65', '22', '40'], '33', rules)).toEqual(['22']);
    expect(
      trickWinnerIndex([{ seat: 0, domino: '65' }, { seat: 1, domino: '00' }], rules),
    ).toBe(1);
  });

  it('non-doubles still follow both pip suits; a led non-double calls its higher end', () => {
    expect(follows(fromId('65'), 6, rules)).toBe(true);
    expect(follows(fromId('65'), 5, rules)).toBe(true);
    expect(ledSuitOf(fromId('65'), rules)).toBe(6);
  });
});

describe('no-trump ("follow me") doubles variants', () => {
  const nt = (mode: GameConfig['noTrumpDoubles']) =>
    buildRules({ type: 'no-trump' }, { ...CASUAL_CONFIG, noTrumpDoubles: mode })!;

  it('doubles high (default): the double tops its suit', () => {
    const rules = nt('high');
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '60' },
          { seat: 1, domino: '66' },
          { seat: 2, domino: '65' },
          { seat: 3, domino: '21' },
        ],
        rules,
      ),
    ).toBe(1);
  });

  it('doubles low: the 6-0 beats the 6-6', () => {
    const rules = nt('low');
    expect(
      trickWinnerIndex([{ seat: 0, domino: '66' }, { seat: 1, domino: '60' }], rules),
    ).toBe(1);
    // ...and the suit otherwise ranks by the other end.
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '61' },
          { seat: 1, domino: '66' },
          { seat: 2, domino: '64' },
        ],
        rules,
      ),
    ).toBe(2);
  });

  it('doubles own suit: a double cannot follow its pip suit and a led double calls for doubles', () => {
    const rules = nt('own-suit');
    expect(follows(fromId('66'), 6, rules)).toBe(false);
    expect(legalPlays(['66', '62'], '65', rules)).toEqual(['62']);
    expect(ledSuitOf(fromId('55'), rules)).toBe(7);
    expect(legalPlays(['66', '54'], '55', rules)).toEqual(['66']);
    // Doubles rank among themselves by pip; no power: a sloughed double never wins.
    expect(
      trickWinnerIndex([{ seat: 0, domino: '55' }, { seat: 1, domino: '66' }], rules),
    ).toBe(1);
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '65' },
          { seat: 1, domino: '66' }, // called away — slough
          { seat: 2, domino: '63' },
        ],
        rules,
      ),
    ).toBe(0);
  });

  it('no trump: the highest of the led suit wins every trick — nothing can trump', () => {
    const rules = nt('high');
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '20' },
          { seat: 1, domino: '66' }, // sloughs, however big
          { seat: 2, domino: '55' },
          { seat: 3, domino: '21' },
        ],
        rules,
      ),
    ).toBe(3);
  });
});

describe('Nel-O doubles variants', () => {
  const nello = (mode: GameConfig['nelloDoubles']) =>
    buildRules({ type: 'nello' }, { ...CASUAL_CONFIG, nelloDoubles: mode })!;

  it('own suit (default): 6-6 high … 0-0 low, doubles called away from pip suits, no power', () => {
    const rules = nello('own-suit');
    expect(rules.powered).toBe(false);
    expect(ledSuitOf(fromId('44'), rules)).toBe(7);
    expect(follows(fromId('44'), 4, rules)).toBe(false);
    expect(
      trickWinnerIndex([{ seat: 0, domino: '22' }, { seat: 1, domino: '55' }], rules),
    ).toBe(1);
    // A double sloughed on a pip lead can never win.
    expect(
      trickWinnerIndex([{ seat: 0, domino: '21' }, { seat: 1, domino: '66' }], rules),
    ).toBe(0);
  });

  it('own suit inverted: 0-0 high … 6-6 low', () => {
    const rules = nello('own-suit-inverted');
    expect(
      trickWinnerIndex([{ seat: 0, domino: '66' }, { seat: 1, domino: '00' }], rules),
    ).toBe(1);
    expect(
      trickWinnerIndex([{ seat: 0, domino: '11' }, { seat: 1, domino: '33' }], rules),
    ).toBe(0);
  });

  it('doubles high in suit: the 6-6 tops the sixes', () => {
    const rules = nello('high');
    expect(
      trickWinnerIndex([{ seat: 0, domino: '60' }, { seat: 1, domino: '66' }], rules),
    ).toBe(1);
  });

  it('doubles low in suit: the 6-6 loses to every six', () => {
    const rules = nello('low');
    expect(
      trickWinnerIndex([{ seat: 0, domino: '66' }, { seat: 1, domino: '61' }], rules),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Count dominoes and leads
// ---------------------------------------------------------------------------

describe('count dominoes', () => {
  it('exactly 5-5 and 6-4 are 10; 5-0, 4-1, 3-2 are 5; everything else is 0', () => {
    const expected: Record<string, number> = { '55': 10, '64': 10, '50': 5, '41': 5, '32': 5 };
    for (const id of ALL_DOMINO_IDS) {
      expect(countValue(fromId(id))).toBe(expected[id] ?? 0);
    }
    const total = ALL_DOMINO_IDS.reduce((a, id) => a + countValue(fromId(id)), 0);
    expect(total).toBe(35);
    expect(TOTAL_HAND_POINTS).toBe(42);
  });
});

describe('lead semantics', () => {
  it('a led 6-4 calls for sixes (when neither end is trump)', () => {
    const rules = buildRules({ type: 'pip', pip: 2 }, CASUAL_CONFIG)!;
    expect(ledSuitOf(fromId('64'), rules)).toBe(6);
    // Holding a six, you must follow with it; fours don't count.
    expect(legalPlays(['65', '40', '21'], '64', rules)).toEqual(['65']);
  });

  it('a led 6-4 is a trump lead when 4s or 6s are trump', () => {
    expect(ledSuitOf(fromId('64'), buildRules({ type: 'pip', pip: 4 }, CASUAL_CONFIG)!)).toBe(7);
    expect(ledSuitOf(fromId('64'), buildRules({ type: 'pip', pip: 6 }, CASUAL_CONFIG)!)).toBe(7);
  });
});

describe('following and renege prevention', () => {
  const rules = buildRules({ type: 'pip', pip: 3 }, CASUAL_CONFIG)!;

  it('a trump never follows its other suit', () => {
    expect(follows(fromId('63'), 6, rules)).toBe(false);
    expect(legalPlays(['63', '61'], '65', rules)).toEqual(['61']);
  });

  it('a player void in the led suit may play anything, including a trump', () => {
    expect(legalPlays(['63', '33', '20'], '65', rules)).toEqual(['63', '33', '20']);
  });

  it('a trump played when void wins over the followers', () => {
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '65' },
          { seat: 1, domino: '61' },
          { seat: 2, domino: '30' },
        ],
        rules,
      ),
    ).toBe(2);
  });
});

describe('trick-winner examples', () => {
  it('the highest trump played wins', () => {
    const rules = buildRules({ type: 'pip', pip: 5 }, CASUAL_CONFIG)!;
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '64' },
          { seat: 1, domino: '53' },
          { seat: 2, domino: '52' },
          { seat: 3, domino: '50' },
        ],
        rules,
      ),
    ).toBe(1);
  });

  it('with no trump played, the highest of the led suit wins', () => {
    const rules = buildRules({ type: 'pip', pip: 5 }, CASUAL_CONFIG)!;
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '62' },
          { seat: 1, domino: '63' },
          { seat: 2, domino: '60' },
          { seat: 3, domino: '41' },
        ],
        rules,
      ),
    ).toBe(1);
  });

  it('a slough can never win, even the 6-6', () => {
    const rules = buildRules({ type: 'pip', pip: 0 }, CASUAL_CONFIG)!;
    expect(
      trickWinnerIndex(
        [
          { seat: 0, domino: '21' },
          { seat: 1, domino: '66' }, // slough — top rank, tier 0
          { seat: 2, domino: '65' }, // slough
          { seat: 3, domino: '42' }, // follows the deuces
        ],
        rules,
      ),
    ).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Bidding ladder pointed checks
// ---------------------------------------------------------------------------

describe('bid ladder', () => {
  it('opening: pass, 30–41, 1 and 2 marks — never a plain 3-mark opening', () => {
    const st = newGame(CASUAL_CONFIG, 'ladder-open');
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'pass')).toBe(true);
    for (let v = 30; v <= 41; v++) {
      expect(bids.some((b) => b.kind === 'points' && b.value === v)).toBe(true);
    }
    for (const m of [1, 2]) {
      expect(bids.some((b) => b.kind === 'marks' && b.value === m && !b.special)).toBe(true);
    }
    expect(bids.some((b) => b.kind === 'marks' && !b.special && b.value > 2)).toBe(false);
    expect(() => applyAction(st, bidA({ kind: 'marks', value: 3 }))).toThrow();
  });

  it('above 2 marks only +1-mark raises; below, any higher rung', () => {
    let st = newGame(CASUAL_CONFIG, 'ladder-raise');
    st = applyAction(st, bidA({ kind: 'marks', value: 2 }));
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'points')).toBe(false);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 3 && !b.special)).toBe(true);
    const plain = bids.filter((b) => b.kind === 'marks' && !b.special);
    expect(plain.every((b) => b.kind === 'marks' && b.value === 3)).toBe(true);
    expect(() => applyAction(st, bidA({ kind: 'marks', value: 4 }))).toThrow(); // jump
    st = applyAction(st, bidA({ kind: 'marks', value: 3 }));
    const next = offeredBids(st).filter((b) => b.kind === 'marks' && !b.special);
    expect(next.every((b) => b.kind === 'marks' && b.value === 4)).toBe(true);
  });

  it('over a 41 bid, only 1 mark and up remain', () => {
    let st = newGame(CASUAL_CONFIG, 'ladder-41');
    st = applyAction(st, bidA({ kind: 'points', value: 41 }));
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'points')).toBe(false);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 1 && !b.special)).toBe(true);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 2 && !b.special)).toBe(true);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 3 && !b.special)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Forced-bid configs (§8.5, §9 option 2)
// ---------------------------------------------------------------------------

describe('all-pass handling', () => {
  it('reshake (default): four passes throw the hand in and rotate the shake', () => {
    let st = newGame(CASUAL_CONFIG, 'reshake');
    const shaker = st.shaker;
    st = passOutBidding(st);
    expect(st.phase).toBe('hand-over');
    expect(st.thrownIn).toBe(true);
    expect(st.handResult).toBeNull();
    expect([...st.marks]).toEqual([0, 0]);
    expect(legalActions(st)).toEqual([{ type: 'next-hand' }]);
    st = applyAction(st, { type: 'next-hand' });
    expect(st.shaker).toBe(nextSeat(shaker));
    expect(st.handNumber).toBe(2);
    expect(st.phase).toBe('bidding');
    expect(st.thrownIn).toBe(false);
  });

  it('force-30: after three passes the shaker cannot pass and may bid 30', () => {
    const cfg: GameConfig = { ...CASUAL_CONFIG, allPass: 'force-30' };
    let st = newGame(cfg, 'force30');
    const shaker = st.shaker;
    st = passUntil(st, shaker);
    expect(st.bids.length).toBe(3);
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'pass')).toBe(false);
    expect(bids.some((b) => b.kind === 'points' && b.value === 30)).toBe(true);
    expect(() => applyAction(st, passA)).toThrow();
    st = applyAction(st, bidA({ kind: 'points', value: 30 }));
    expect(st.forcedBid).toBe(true);
    expect(st.declarer).toBe(shaker);
    expect(st.contract).toEqual({ kind: 'points', value: 30 });
    expect(st.phase).toBe('declaring');
  });

  it('force-30-or-nello: the forced shaker may bid 1 or 2 marks of Nel-O', () => {
    const cfg: GameConfig = { ...CASUAL_CONFIG, allPass: 'force-30-or-nello' };
    let st = newGame(cfg, 'force-nello');
    const shaker = st.shaker;
    st = passUntil(st, shaker);
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 1 && b.special === 'nello')).toBe(true);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 2 && b.special === 'nello')).toBe(true);
    st = applyAction(st, bidA({ kind: 'marks', value: 1, special: 'nello' }));
    // Forced Nel-O skips the declaring phase: doubles treatment is fixed by config.
    expect(st.phase).toBe('playing');
    expect(st.contract).toEqual({ kind: 'nello', value: 1 });
    expect(st.declaration).toEqual({ type: 'nello' });
    expect(st.declarer).toBe(shaker);
    expect(st.sittingOut).toBe(partnerOf(shaker));
    expect(st.leader).toBe(shaker);
    expect(st.turn).toBe(shaker);
    expect(st.rules).toEqual({
      called: { kind: 'doubles' },
      powered: false,
      pipSuitDoubles: 'high',
      calledDoublesOrder: 'normal',
    });
  });

  it('force-30-or-nello respects nelloMinMarks = 2', () => {
    const cfg: GameConfig = { ...CASUAL_CONFIG, allPass: 'force-30-or-nello', nelloMinMarks: 2 };
    let st = newGame(cfg, 'force-nello-min2');
    st = passUntil(st, st.shaker);
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 1 && b.special === 'nello')).toBe(false);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 2 && b.special === 'nello')).toBe(true);
  });

  it('force-30-or-nello offers no Nel-O when nello is off', () => {
    const cfg: GameConfig = { ...CASUAL_CONFIG, allPass: 'force-30-or-nello', nello: 'off' };
    let st = newGame(cfg, 'force-nello-off');
    st = passUntil(st, st.shaker);
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'marks' && b.special === 'nello')).toBe(false);
    expect(bids.some((b) => b.kind === 'pass')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Nel-O three-handed flow (§8.1)
// ---------------------------------------------------------------------------

describe('Nel-O play', () => {
  function nelloHand(seed: string): GameState {
    let st = newGame(CASUAL_CONFIG, seed);
    const bidder = st.turn!;
    st = applyAction(st, bidA({ kind: 'marks', value: 1 }));
    st = passOutBidding(st);
    expect(st.phase).toBe('declaring');
    expect(st.declarer).toBe(bidder);
    const nello = legalActions(st).find(
      (a) => a.type === 'declare' && a.decl.type === 'nello',
    );
    expect(nello).toBeDefined();
    return applyAction(st, nello!);
  }

  it('plays three-handed: partner sits out, tricks have three plays', () => {
    let st = nelloHand('nello-flow');
    const declarer = st.declarer!;
    const sit = partnerOf(declarer);
    expect(st.sittingOut).toBe(sit);
    expect(st.contract).toEqual({ kind: 'nello', value: 1 });
    expect(st.leader).toBe(declarer);
    expect(st.turn).toBe(declarer);
    const rand = mulberry32(toSeed('nello-drive'));
    while (st.phase === 'playing') {
      expect(st.turn).not.toBe(sit);
      const as = legalActions(st);
      st = applyAction(st, as[Math.floor(rand() * as.length)]!);
    }
    expect(st.tricks.length).toBeGreaterThan(0);
    for (const t of st.tricks) {
      expect(t.plays.length).toBe(3);
      for (const p of t.plays) expect(p.seat).not.toBe(sit);
    }
    // The sat-out hand never enters play.
    expect([...st.hands[sit]!].sort()).toEqual([...st.dealt[sit]!].sort());
    const r = st.handResult!;
    const declWins = st.tricks.filter((t) => t.winner === declarer).length;
    if (r.made) {
      expect(st.tricks.length).toBe(7);
      expect(declWins).toBe(0);
    } else {
      expect(declWins).toBe(1);
      expect(st.tricks[st.tricks.length - 1]!.winner).toBe(declarer);
    }
  });

  it('ends the instant the declarer wins a trick (early termination found by search)', () => {
    for (let i = 0; i < 60; i++) {
      let st = nelloHand(`nello-set-${i}`);
      const declarer = st.declarer!;
      const rand = mulberry32(toSeed(`nello-set-drive-${i}`));
      while (st.phase === 'playing') {
        const as = legalActions(st);
        st = applyAction(st, as[Math.floor(rand() * as.length)]!);
      }
      const r = st.handResult!;
      if (!r.made && st.tricks.length < 7) {
        // Found a set before trick 7: the very trick the declarer won ended it.
        expect(st.tricks[st.tricks.length - 1]!.winner).toBe(declarer);
        expect(r.team).toBe(otherTeam((declarer % 2) as 0 | 1));
        expect(r.marks).toBe(1);
        return;
      }
    }
    throw new Error('no early Nel-O set found in 60 seeded hands');
  });
});

// ---------------------------------------------------------------------------
// Plunge and Splash (§8.2–8.3)
// ---------------------------------------------------------------------------

describe('Plunge and Splash', () => {
  function findSpecialSeed(minDoubles: number, tag: string): { seed: string; seat: Seat } {
    for (let i = 0; i < 3000; i++) {
      const seed = `${tag}-${i}`;
      const st = newGame(CASUAL_CONFIG, seed);
      const seat = biddingOrder(st).find((s) => doublesIn(st.hands[s]!) >= minDoubles);
      if (seat !== undefined) return { seed, seat };
    }
    throw new Error(`no ${tag} seed found`);
  }

  it('Plunge: 4-mark jump bid; partner names trump and (default) leads', () => {
    const { seed, seat } = findSpecialSeed(4, 'plunge-seek');
    let st = newGame(CASUAL_CONFIG, seed);
    st = passUntil(st, seat);
    expect(
      offeredBids(st).some((b) => b.kind === 'marks' && b.value === 4 && b.special === 'plunge'),
    ).toBe(true);
    st = applyAction(st, bidA({ kind: 'marks', value: 4, special: 'plunge' }));
    st = passOutBidding(st);
    expect(st.phase).toBe('declaring');
    expect(st.declarer).toBe(seat);
    expect(st.contract).toEqual({ kind: 'plunge', value: 4 });
    // The partner — not the declarer — names trump, from pips and doubles only.
    const partner = partnerOf(seat);
    expect(st.turn).toBe(partner);
    const decls = legalActions(st).flatMap((a) => (a.type === 'declare' ? [a.decl] : []));
    expect(decls.length).toBe(8);
    expect(decls.every((d) => d.type === 'pip' || d.type === 'doubles')).toBe(true);
    st = applyAction(st, { type: 'declare', decl: { type: 'pip', pip: 6 } });
    expect(st.phase).toBe('playing');
    expect(st.leader).toBe(partner); // default: partner names trump *and* leads
    expect(st.turn).toBe(partner);
  });

  it('Plunge with plungeFirstLead: declarer — partner still names trump, declarer leads', () => {
    const { seed, seat } = findSpecialSeed(4, 'plunge-seek'); // same deal: deal depends only on seed
    const cfg: GameConfig = { ...CASUAL_CONFIG, plungeFirstLead: 'declarer' };
    let st = newGame(cfg, seed);
    st = passUntil(st, seat);
    st = applyAction(st, bidA({ kind: 'marks', value: 4, special: 'plunge' }));
    st = passOutBidding(st);
    expect(st.turn).toBe(partnerOf(seat));
    st = applyAction(st, { type: 'declare', decl: { type: 'doubles' } });
    expect(st.leader).toBe(seat);
    expect(st.turn).toBe(seat);
  });

  it('Plunge can jump over a points bid and be raised to 5 marks by another plunge-holder', () => {
    const { seed, seat } = findSpecialSeed(4, 'plunge-seek');
    let st = newGame(CASUAL_CONFIG, seed);
    // Someone bids points first if possible (only when the plunge seat is not first).
    const order = biddingOrder(st);
    if (order[0] !== seat) {
      st = applyAction(st, bidA({ kind: 'points', value: 35 }));
      st = passUntil(st, seat);
      expect(
        offeredBids(st).some((b) => b.kind === 'marks' && b.value === 4 && b.special === 'plunge'),
      ).toBe(true);
    }
  });

  it('Splash: 2 or 3 marks (bidder choice), needs ≥3 doubles; partner names trump and leads', () => {
    const { seed, seat } = findSpecialSeed(3, 'splash-seek');
    let st = newGame(CASUAL_CONFIG, seed);
    st = passUntil(st, seat);
    const bids = offeredBids(st);
    expect(bids.some((b) => b.kind === 'marks' && b.value === 2 && b.special === 'splash')).toBe(true);
    st = applyAction(st, bidA({ kind: 'marks', value: 2, special: 'splash' }));
    st = passOutBidding(st);
    expect(st.phase).toBe('declaring');
    expect(st.contract).toEqual({ kind: 'splash', value: 2 });
    const partner = partnerOf(seat);
    expect(st.turn).toBe(partner);
    const decls = legalActions(st).flatMap((a) => (a.type === 'declare' ? [a.decl] : []));
    expect(decls.every((d) => d.type === 'pip' || d.type === 'doubles')).toBe(true);
    st = applyAction(st, { type: 'declare', decl: { type: 'pip', pip: 0 } });
    expect(st.leader).toBe(partner);
  });

  it('Plunge is refused without 4 doubles', () => {
    for (let i = 0; i < 100; i++) {
      const st = newGame(CASUAL_CONFIG, `no-plunge-${i}`);
      const first = st.turn!;
      if (doublesIn(st.hands[first]!) < 4) {
        expect(
          offeredBids(st).some((b) => b.kind === 'marks' && b.special === 'plunge'),
        ).toBe(false);
        expect(() =>
          applyAction(st, bidA({ kind: 'marks', value: 4, special: 'plunge' })),
        ).toThrow();
        return;
      }
    }
    throw new Error('every first bidder had 4 doubles?!');
  });
});

// ---------------------------------------------------------------------------
// Sevens flow (§8.4)
// ---------------------------------------------------------------------------

describe('Sevens', () => {
  it('is fully forced and won only by the declarer taking all 7 tricks', () => {
    const cfg: GameConfig = { ...CASUAL_CONFIG, sevens: 'on' };
    let st = newGame(cfg, 'sevens-flow');
    const bidder = st.turn!;
    st = applyAction(st, bidA({ kind: 'marks', value: 1 }));
    st = passOutBidding(st);
    const sevens = legalActions(st).find(
      (a) => a.type === 'declare' && a.decl.type === 'sevens',
    );
    expect(sevens).toBeDefined();
    st = applyAction(st, sevens!);
    expect(st.contract).toEqual({ kind: 'sevens', value: 1 });
    expect(st.rules).toBeNull(); // no suit structure
    expect(st.leader).toBe(bidder);
    const rand = mulberry32(toSeed('sevens-drive'));
    while (st.phase === 'playing') {
      const hand = st.hands[st.turn!]!;
      const dist = (id: string) => Math.abs(fromId(id).high + fromId(id).low - 7);
      const best = Math.min(...hand.map(dist));
      const as = legalActions(st);
      for (const a of as) {
        expect(a.type).toBe('play');
        if (a.type === 'play') expect(dist(a.domino)).toBe(best);
      }
      st = applyAction(st, as[Math.floor(rand() * as.length)]!);
    }
    const r = st.handResult!;
    const declWins = st.tricks.filter((t) => t.winner === bidder).length;
    if (r.made) {
      expect(st.tricks.length).toBe(7);
      expect(declWins).toBe(7);
    } else {
      expect(st.tricks[st.tricks.length - 1]!.winner).not.toBe(bidder);
    }
  });

  it('is never offered when sevens is off', () => {
    let st = newGame(CASUAL_CONFIG, 'sevens-off');
    st = applyAction(st, bidA({ kind: 'marks', value: 1 }));
    st = passOutBidding(st);
    const decls = legalActions(st).flatMap((a) => (a.type === 'declare' ? [a.decl] : []));
    expect(decls.some((d) => d.type === 'sevens')).toBe(false);
    expect(() =>
      applyAction(st, { type: 'declare', decl: { type: 'sevens' } }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Early termination, game end, tournament purity
// ---------------------------------------------------------------------------

describe('hand and game termination', () => {
  it('a hand ends early once the outcome is decided', () => {
    for (let g = 0; g < 40; g++) {
      const rand = mulberry32(toSeed(`early-${g}`));
      let st = newGame(CASUAL_CONFIG, `early-${g}`);
      while (st.phase !== 'game-over') {
        const as = legalActions(st);
        st = applyAction(st, as[Math.floor(rand() * as.length)]!);
        if (
          (st.phase === 'hand-over' || st.phase === 'game-over') &&
          st.handResult !== null &&
          st.tricks.length < 7
        ) {
          // Unplayed dominoes remain in hand — the hand really stopped early.
          const played = st.tricks.reduce((n, t) => n + t.plays.length, 0);
          expect(st.hands.flat().length).toBe(28 - played);
          expect(st.tricks.length).toBeGreaterThan(0);
          return;
        }
      }
    }
    throw new Error('no early-terminated hand found in 40 games');
  });

  it('the game ends when a team reaches 7 marks', () => {
    const rand = mulberry32(toSeed('to-seven'));
    let st = newGame(CASUAL_CONFIG, 'to-seven');
    while (st.phase !== 'game-over') {
      const as = legalActions(st);
      st = applyAction(st, as[Math.floor(rand() * as.length)]!);
    }
    expect(st.winner).not.toBeNull();
    expect(st.marks[st.winner!]).toBeGreaterThanOrEqual(7);
    expect(st.marks[otherTeam(st.winner!)]).toBeLessThan(7);
    expect(legalActions(st)).toEqual([]);
    expect(() => applyAction(st, passA)).toThrow();
    expect(() => applyAction(st, { type: 'next-hand' })).toThrow();
  });

  it('the tournament preset never offers special bids or declarations', () => {
    expect(TOURNAMENT_CONFIG.nello).toBe('off');
    expect(TOURNAMENT_CONFIG.plunge).toBe(false);
    expect(TOURNAMENT_CONFIG.splash).toBe(false);
    expect(TOURNAMENT_CONFIG.sevens).toBe('off');
    expect(TOURNAMENT_CONFIG.noTrumpDoubles).toBe('high');
    expect(TOURNAMENT_CONFIG.allPass).toBe('reshake');
    const rand = mulberry32(toSeed('tourney'));
    let st = newGame(TOURNAMENT_CONFIG, 'tourney');
    while (st.phase !== 'game-over') {
      for (const a of legalActions(st)) {
        if (a.type === 'bid' && a.bid.kind === 'marks') expect(a.bid.special).toBeUndefined();
        if (a.type === 'declare') {
          expect(['pip', 'doubles', 'no-trump']).toContain(a.decl.type);
        }
      }
      if (st.contract) expect(['points', 'marks']).toContain(st.contract.kind);
      const as = legalActions(st);
      st = applyAction(st, as[Math.floor(rand() * as.length)]!);
    }
  });
});
