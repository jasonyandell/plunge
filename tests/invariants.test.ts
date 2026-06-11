/**
 * Property-based tests for every invariant in docs/RULES.md §10 (items 1–11),
 * plus bonus robustness properties (immutability, legal/illegal action
 * behavior, renege rejection, determinism, independent trick-winner oracle).
 *
 * All games are driven exclusively through legalActions/applyAction with a
 * seeded mulberry32 PRNG. Actions are never hand-built for the positive
 * properties — hand-built actions appear only to verify that illegal actions
 * are rejected.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ALL_DOMINO_IDS,
  CASUAL_CONFIG,
  applyAction,
  bidStrength,
  buildRules,
  contractMarks,
  countValue,
  doublesIn,
  follows,
  fromId,
  highBid,
  isCalled,
  isDouble,
  ledSuitOf,
  legalActions,
  mulberry32,
  newGame,
  nextSeat,
  otherTeam,
  partnerOf,
  pipSum,
  PIPS,
  teamOf,
} from '../src/engine';
import type {
  Action,
  Domino,
  DominoId,
  GameConfig,
  GameState,
  LedSuit,
  PlayRecord,
  Seat,
  TrickRules,
} from '../src/engine';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function ok(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

type Rand = () => number;
type Picker = (state: GameState, actions: Action[], rand: Rand) => Action;

const uniformPick: Picker = (_state, actions, rand) =>
  actions[Math.floor(rand() * actions.length)]!;

/** Prefer marks bids so mark/special contracts actually happen. */
const preferMarksPick: Picker = (state, actions, rand) => {
  if (state.phase === 'bidding' && rand() < 0.8) {
    const marks = actions.filter((a) => a.type === 'bid' && a.bid.kind === 'marks');
    if (marks.length > 0) return marks[Math.floor(rand() * marks.length)]!;
  }
  return uniformPick(state, actions, rand);
};

const preferNelloPick: Picker = (state, actions, rand) => {
  const nello = actions.find((a) => a.type === 'declare' && a.decl.type === 'nello');
  if (nello) return nello;
  return preferMarksPick(state, actions, rand);
};

const preferSevensPick: Picker = (state, actions, rand) => {
  const sevens = actions.find((a) => a.type === 'declare' && a.decl.type === 'sevens');
  if (sevens) return sevens;
  return preferMarksPick(state, actions, rand);
};

const preferPassPick: Picker = (state, actions, rand) => {
  if (state.phase === 'bidding' && rand() < 0.9) {
    const pass = actions.find((a) => a.type === 'bid' && a.bid.kind === 'pass');
    if (pass) return pass;
  }
  return uniformPick(state, actions, rand);
};

interface HandTrace {
  readonly shaker: Seat;
  /** Live hands snapshot at deal time (independent of the engine's `dealt`). */
  readonly dealt: readonly (readonly DominoId[])[];
  readonly marksBefore: readonly [number, number];
  /** The state at hand-over / game-over, before next-hand. */
  readonly final: GameState;
}

interface RunOpts {
  maxHands?: number;
  pick?: Picker;
  onStep?: (state: GameState, action: Action, next: GameState) => void;
  freeze?: boolean;
}

interface RunResult {
  hands: HandTrace[];
  final: GameState;
}

/** Drive a game through legalActions/applyAction with a seeded PRNG. */
function runGame(cfg: GameConfig, seed: number, opts: RunOpts = {}): RunResult {
  const { maxHands = 100, pick = uniformPick, onStep, freeze = false } = opts;
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let state = newGame(cfg, seed);
  const hands: HandTrace[] = [];
  const snapshot = (s: GameState) => ({
    shaker: s.shaker,
    dealt: s.hands.map((h) => [...h]),
    marksBefore: [...s.marks] as [number, number],
  });
  let start = snapshot(state);
  let steps = 0;
  while (state.phase !== 'game-over') {
    ok(++steps <= 20000, 'runaway game');
    const actions = legalActions(state);
    ok(actions.length > 0, `no legal actions in phase ${state.phase}`);
    const action = pick(state, actions, rand);
    if (freeze) deepFreeze(state);
    const next = applyAction(state, action);
    onStep?.(state, action, next);
    const justEnded =
      state.phase !== 'hand-over' &&
      (next.phase === 'hand-over' || next.phase === 'game-over');
    if (justEnded) hands.push({ ...start, final: next });
    if (action.type === 'next-hand') start = snapshot(next);
    state = next;
    if (hands.length >= maxHands && state.phase === 'hand-over') break;
  }
  return { hands, final: state };
}

// ---------------------------------------------------------------------------
// Randomized configuration (docs/RULES.md §9 matrix)
// ---------------------------------------------------------------------------

const configArb: fc.Arbitrary<GameConfig> = fc.record({
  targetMarks: fc.constant(7),
  allPass: fc.constantFrom<GameConfig['allPass']>('reshake', 'force-30', 'force-30-or-nello'),
  nello: fc.constantFrom<GameConfig['nello']>('off', 'open', 'forced-only'),
  nelloMinMarks: fc.constantFrom<GameConfig['nelloMinMarks']>(1, 2),
  nelloDoubles: fc.constantFrom<GameConfig['nelloDoubles']>(
    'own-suit', 'high', 'low', 'own-suit-inverted',
  ),
  plunge: fc.boolean(),
  plungeMarks: fc.constantFrom<GameConfig['plungeMarks']>(2, 3, 4),
  plungeFirstLead: fc.constantFrom<GameConfig['plungeFirstLead']>('partner', 'declarer'),
  splash: fc.boolean(),
  splashMarks: fc.constantFrom<GameConfig['splashMarks']>(2, 3, '2or3'),
  sevens: fc.constantFrom<GameConfig['sevens']>('off', 'on', 'forced-only'),
  noTrumpDoubles: fc.constantFrom<GameConfig['noTrumpDoubles']>('high', 'low', 'own-suit'),
  // Invariant 11 requires the sweep-bonus house rule to be off.
  forced30SweepBonus: fc.constant(false),
});

const seedArb = fc.integer({ min: 0, max: 0x7fffffff });

// ---------------------------------------------------------------------------
// Independent trick-winner oracle (re-derived from docs/SUIT_ALGEBRA_PURE.md,
// without using the engine's follows/rank/tier).
// ---------------------------------------------------------------------------

function refWinner(plays: readonly PlayRecord[], rules: TrickRules): number {
  const called = (d: Domino): boolean =>
    rules.called.kind === 'pip'
      ? d.high === rules.called.pip || d.low === rules.called.pip
      : rules.called.kind === 'doubles'
        ? d.high === d.low
        : false;
  const lead = fromId(plays[0]!.domino);
  const led = called(lead) ? 7 : lead.high;
  const rk = (d: Domino): number => {
    if (rules.called.kind === 'doubles' && d.high === d.low) {
      return rules.calledDoublesOrder === 'normal' ? d.high : 6 - d.high;
    }
    if (d.high === d.low) return rules.pipSuitDoubles === 'high' ? 1000 : -1000;
    return d.high + d.low;
  };
  const score = (d: Domino): number => {
    if (rules.powered && called(d)) return 20000 + rk(d); // tier 2
    const inSuit = led === 7 ? called(d) : !called(d) && (d.high === led || d.low === led);
    return inSuit ? 10000 + rk(d) : -Infinity; // tier 1 / slough
  };
  let bestSeat = plays[0]!.seat;
  let bestScore = score(lead);
  for (let i = 1; i < plays.length; i++) {
    const s = score(fromId(plays[i]!.domino));
    if (s > bestScore) {
      bestScore = s;
      bestSeat = plays[i]!.seat;
    }
  }
  return bestSeat;
}

// ---------------------------------------------------------------------------
// §10 invariants 1–11
// ---------------------------------------------------------------------------

describe('RULES.md §10 invariants (property-based)', () => {
  it('invariant 1 — every deal partitions the 28-domino set into 4 hands of 7', () => {
    const allSorted = [...ALL_DOMINO_IDS].sort();
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, { maxHands: 3 });
        ok(hands.length > 0, 'at least one hand was dealt');
        for (const h of hands) {
          ok(h.dealt.length === 4, 'four hands');
          ok(h.dealt.every((x) => x.length === 7), 'seven dominoes per hand');
          expect([...h.dealt.flat()].sort()).toEqual(allSorted);
          // The engine's own `dealt` record matches the live hands at deal time.
          for (let s = 0; s < 4; s++) {
            expect([...h.final.dealt[s]!].sort()).toEqual([...h.dealt[s]!].sort());
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('invariant 2 — 42 points at stake: trick points = 1 + count, totals add up', () => {
    // Static: the count dominoes are worth exactly 35 of the 42.
    const totalCount = ALL_DOMINO_IDS.reduce((a, id) => a + countValue(fromId(id)), 0);
    expect(totalCount).toBe(35);
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, { maxHands: 4 });
        for (const h of hands) {
          const f = h.final;
          let total = 0;
          for (const t of f.tricks) {
            const counts = t.plays.reduce((a, p) => a + countValue(fromId(p.domino)), 0);
            ok(t.points === 1 + counts, 'trick points = 1 + count captured');
            total += t.points;
          }
          ok(total === f.points[0] + f.points[1], 'team points = sum of trick points');
          ok(total <= 42, 'never more than 42 points in a hand');
          if (f.tricks.length === 7 && f.sittingOut === null) {
            ok(total === 42, 'a full 4-handed hand captures all 42 points');
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('invariant 3 — pip trump: exactly 7 trumps, membership is exclusive (pure)', () => {
    for (const t of PIPS) {
      const rules = buildRules({ type: 'pip', pip: t }, CASUAL_CONFIG)!;
      const trumps = ALL_DOMINO_IDS.filter((id) => isCalled(fromId(id), rules));
      expect(trumps.length).toBe(7);
      for (const id of trumps) {
        // A trump never follows any pip-suit lead — only the called suit.
        for (let led = 0; led < 7; led++) {
          expect(follows(fromId(id), led as LedSuit, rules)).toBe(false);
        }
        expect(follows(fromId(id), 7, rules)).toBe(true);
      }
      // Non-trumps never follow the called suit.
      for (const id of ALL_DOMINO_IDS) {
        if (!trumps.includes(id)) expect(follows(fromId(id), 7, rules)).toBe(false);
      }
    }
  });

  it('invariant 3 — in game, a trump is only played on a pip lead when void', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 3,
          onStep: (state, action) => {
            if (state.phase !== 'playing' || action.type !== 'play') return;
            if (state.contract!.kind === 'sevens') return;
            if (state.currentTrick.length === 0) return;
            const rules = state.rules!;
            const led = ledSuitOf(fromId(state.currentTrick[0]!.domino), rules);
            if (led === 7) return;
            if (isCalled(fromId(action.domino), rules)) {
              const hand = state.hands[state.turn!]!;
              ok(
                hand.every((id) => !follows(fromId(id), led, rules)),
                'a trump was played on a pip-suit lead while holding a follower',
              );
            }
          },
        });
      }),
      { numRuns: 40 },
    );
  });

  it('invariant 4 — a led non-trump, non-double belongs to its higher suit', () => {
    const ruleSets: TrickRules[] = [
      ...PIPS.map((p) => buildRules({ type: 'pip', pip: p }, CASUAL_CONFIG)!),
      buildRules({ type: 'doubles' }, CASUAL_CONFIG)!,
      buildRules({ type: 'no-trump' }, CASUAL_CONFIG)!,
      buildRules({ type: 'no-trump' }, { ...CASUAL_CONFIG, noTrumpDoubles: 'own-suit' })!,
      buildRules({ type: 'nello' }, CASUAL_CONFIG)!,
    ];
    for (const rules of ruleSets) {
      for (const id of ALL_DOMINO_IDS) {
        const d = fromId(id);
        if (!isCalled(d, rules) && !isDouble(d)) {
          expect(ledSuitOf(d, rules)).toBe(d.high);
        }
      }
    }
    // And in live games, every uncalled non-double lead calls its higher end.
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 2,
          onStep: (state, action) => {
            if (state.phase !== 'playing' || action.type !== 'play') return;
            if (state.contract!.kind === 'sevens') return;
            if (state.currentTrick.length !== 0) return;
            const rules = state.rules!;
            const d = fromId(action.domino);
            if (!isCalled(d, rules) && !isDouble(d)) {
              ok(ledSuitOf(d, rules) === d.high, 'lead must call its higher suit');
            }
          },
        });
      }),
      { numRuns: 30 },
    );
  });

  it('invariant 5 — points bids: made/set mutually exclusive and exhaustive', () => {
    let seen = 0;
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, { maxHands: 4 });
        for (const h of hands) {
          const f = h.final;
          const r = f.handResult;
          if (!r || r.contract.kind !== 'points') continue;
          seen++;
          const bid = r.contract.value;
          ok(bid >= 30 && bid <= 41, 'points contract value in 30..41');
          const declTeam = teamOf(r.declarer);
          const declPts = f.points[declTeam]!;
          const defPts = f.points[otherTeam(declTeam)]!;
          const made = declPts >= bid;
          const set = defPts >= 43 - bid;
          ok(made !== set, 'made and set are mutually exclusive; a decided hand is exactly one');
          ok(r.made === made, 'the recorded result matches the points');
          if (f.tricks.length === 7) ok(made || set, 'exhaustive once all 7 tricks are played');
          ok(r.marks === 1, 'a points bid is worth exactly 1 mark');
          ok(r.team === (made ? declTeam : otherTeam(declTeam)), 'mark goes to the right team');
        }
      }),
      { numRuns: 60 },
    );
    expect(seen).toBeGreaterThan(0);
  });

  it('invariant 6 — mark bids made iff all 7 tricks; set the moment defenders win one', () => {
    let seen = 0;
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, { maxHands: 4, pick: preferMarksPick });
        for (const h of hands) {
          const f = h.final;
          const r = f.handResult;
          if (!r) continue;
          const k = r.contract.kind;
          if (k !== 'marks' && k !== 'plunge' && k !== 'splash') continue;
          seen++;
          const declTeam = teamOf(r.declarer);
          const defTricks = f.tricks.filter((t) => teamOf(t.winner) !== declTeam);
          if (r.made) {
            ok(f.tricks.length === 7 && defTricks.length === 0, 'made = all 7 tricks');
            ok(f.points[declTeam] === 42, 'all 7 tricks necessarily means all 42 points');
          } else {
            ok(defTricks.length === 1, 'the hand ends the moment defenders win a trick');
            ok(
              teamOf(f.tricks[f.tricks.length - 1]!.winner) !== declTeam,
              'the defender trick is the final trick',
            );
          }
          ok(r.marks === r.contract.value, 'marks awarded = marks bid');
        }
      }),
      { numRuns: 60 },
    );
    expect(seen).toBeGreaterThan(0);
  });

  it('invariant 7 — Nel-O: set on first declarer trick; sat-out hand never enters play', () => {
    let seen = 0;
    const arb = configArb.map((c) => ({ ...c, nello: 'open' as const }));
    fc.assert(
      fc.property(arb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, { maxHands: 3, pick: preferNelloPick });
        for (const h of hands) {
          const f = h.final;
          const r = f.handResult;
          if (!r || r.contract.kind !== 'nello') continue;
          seen++;
          const sit = partnerOf(r.declarer);
          ok(f.sittingOut === sit, "the declarer's partner sits out");
          for (const t of f.tricks) {
            ok(t.plays.length === 3, 'Nel-O tricks are three-handed');
            ok(t.plays.every((p) => p.seat !== sit), 'the sat-out partner never plays');
          }
          const played = new Set(f.tricks.flatMap((t) => t.plays.map((p) => p.domino)));
          ok(
            h.dealt[sit]!.every((id) => !played.has(id)),
            "the sat-out partner's dominoes never appear in any trick",
          );
          expect([...f.hands[sit]!].sort()).toEqual([...h.dealt[sit]!].sort());
          const declWins = f.tricks.filter((t) => t.winner === r.declarer).length;
          if (r.made) {
            ok(f.tricks.length === 7 && declWins === 0, 'made iff declarer won zero tricks');
          } else {
            ok(declWins === 1, 'set the instant the declarer wins a trick');
            ok(f.tricks[f.tricks.length - 1]!.winner === r.declarer, 'it ends on that trick');
          }
          ok(r.marks === r.contract.value, 'Nel-O pays the marks bid');
        }
      }),
      { numRuns: 50 },
    );
    expect(seen).toBeGreaterThan(0);
  });

  it('invariant 8 — Sevens: forced plays; closest to 7 wins, earliest breaks ties', () => {
    let sevensTricks = 0;
    const arb = configArb.map((c) => ({ ...c, sevens: 'on' as const }));
    const dist = (id: DominoId) => Math.abs(pipSum(fromId(id)) - 7);
    fc.assert(
      fc.property(arb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 3,
          pick: preferSevensPick,
          onStep: (state, action, next) => {
            if (state.contract?.kind !== 'sevens') return;
            if (state.phase === 'playing' && action.type === 'play' && state.turn !== null) {
              const hand = state.hands[state.turn]!;
              const best = Math.min(...hand.map(dist));
              ok(dist(action.domino) === best, 'every play must be closest to 7');
              const legal = legalActions(state)
                .flatMap((a) => (a.type === 'play' ? [a.domino] : []))
                .sort();
              expect(legal).toEqual(hand.filter((id) => dist(id) === best).sort());
            }
            if (next.tricks.length > state.tricks.length) {
              sevensTricks++;
              const t = next.tricks[next.tricks.length - 1]!;
              const dists = t.plays.map((p) => dist(p.domino));
              const winIdx = dists.indexOf(Math.min(...dists));
              ok(
                t.winner === t.plays[winIdx]!.seat,
                'sevens trick winner = closest to 7, earliest played on ties',
              );
            }
          },
        });
      }),
      { numRuns: 40 },
    );
    expect(sevensTricks).toBeGreaterThan(0);
  });

  it('invariant 9 — bid ladder legality at every bidding turn', () => {
    const checkLadder = (state: GameState): void => {
      const actions = legalActions(state);
      const offered = actions.flatMap((a) => (a.type === 'bid' ? [a.bid] : []));
      ok(offered.length === actions.length, 'bidding offers only bids');
      const cur = highBid(state.bids);
      const curStr = cur ? bidStrength(cur.bid) : 0;
      const curMarks = cur && cur.bid.kind === 'marks' ? cur.bid.value : 0;
      const forced =
        state.config.allPass !== 'reshake' &&
        state.bids.length === 3 &&
        state.bids.every((b) => b.bid.kind === 'pass');
      ok(
        offered.some((b) => b.kind === 'pass') === !forced,
        'pass is available exactly when the bid is not forced',
      );
      for (const b of offered) {
        if (b.kind === 'pass') continue;
        ok(bidStrength(b) > curStr, 'every offered bid strictly raises the high bid');
        if (b.kind === 'points') {
          ok(
            Number.isInteger(b.value) && b.value >= 30 && b.value <= 41,
            'points bids are 30..41',
          );
        } else {
          ok(Number.isInteger(b.value) && b.value >= 1, 'marks bids are whole marks ≥ 1');
          if (b.special === 'plunge') {
            // The sole jump: open/jump to ≥4 (default), or a plain ladder slot.
            ok(
              b.value <= 2 || b.value >= 4 || b.value === curMarks + 1,
              `plunge bid ${b.value} breaks even the plunge ladder (over ${curMarks})`,
            );
          } else if (b.value > 2) {
            // Opening cap 2 marks; above 2 marks only +1-mark raises.
            ok(
              b.value === curMarks + 1,
              `non-plunge marks bid ${b.value} must be a +1 raise over ${curMarks}`,
            );
          }
        }
      }
    };
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, {
          maxHands: 3,
          onStep: (state) => {
            if (state.phase === 'bidding') checkLadder(state);
          },
        });
        for (const h of hands) {
          const bids = h.final.bids;
          ok(bids.length <= 4, 'one bid per player: at most four bids');
          bids.forEach((sb, i) =>
            ok(sb.seat === (h.shaker + 1 + i) % 4, 'bidding goes clockwise from left of shaker'),
          );
          ok(new Set(bids.map((sb) => sb.seat)).size === bids.length, 'each seat bids once');
          let last = 0;
          for (const sb of bids) {
            if (sb.bid.kind === 'pass') continue;
            const s = bidStrength(sb.bid);
            ok(s > last, 'placed bids are strictly increasing in strength');
            last = s;
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('invariant 10 — Plunge needs ≥4 doubles, Splash ≥3; the engine refuses otherwise', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 3,
          onStep: (state) => {
            if (state.phase !== 'bidding' || state.turn === null) return;
            const hand = state.hands[state.turn]!;
            const dbl = doublesIn(hand);
            const offered = legalActions(state).flatMap((a) =>
              a.type === 'bid' ? [a.bid] : [],
            );
            for (const b of offered) {
              if (b.kind !== 'marks') continue;
              if (b.special === 'plunge') ok(dbl >= 4, 'plunge offered with fewer than 4 doubles');
              if (b.special === 'splash') ok(dbl >= 3, 'splash offered with fewer than 3 doubles');
            }
            // Hand-built special bids without the doubles must throw.
            const cur = highBid(state.bids);
            const curMarks = cur && cur.bid.kind === 'marks' ? cur.bid.value : 0;
            if (dbl < 4) {
              expect(() =>
                applyAction(state, {
                  type: 'bid',
                  bid: { kind: 'marks', value: Math.max(4, curMarks + 1), special: 'plunge' },
                }),
              ).toThrow();
            }
            if (dbl < 3) {
              expect(() =>
                applyAction(state, {
                  type: 'bid',
                  bid: { kind: 'marks', value: 2, special: 'splash' },
                }),
              ).toThrow();
            }
          },
        });
      }),
      { numRuns: 50 },
    );
  });

  it('invariant 11 — every decided hand awards exactly one team exactly the contract marks', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const { hands } = runGame(cfg, seed, { maxHands: 4 });
        for (const h of hands) {
          const f = h.final;
          if (f.thrownIn) {
            ok(f.handResult === null, 'thrown-in hands have no result');
            expect([...f.marks]).toEqual([...h.marksBefore]);
            continue;
          }
          const r = f.handResult;
          ok(r !== null, 'every non-thrown hand ends decided');
          ok(r.marks === contractMarks(r.contract), 'marks awarded = contract value');
          ok(r.marks >= 1, 'at least one mark changes hands');
          const expected = [...h.marksBefore] as [number, number];
          expected[r.team] += r.marks;
          expect([...f.marks]).toEqual(expected);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('invariant 11 — thrown-in hands award nothing and the shake rotates every hand', () => {
    let thrown = 0;
    fc.assert(
      fc.property(seedArb, (seed) => {
        const { hands } = runGame(CASUAL_CONFIG, seed, { maxHands: 5, pick: preferPassPick });
        for (let i = 0; i < hands.length; i++) {
          const h = hands[i]!;
          if (h.final.thrownIn) {
            thrown++;
            ok(h.final.handResult === null, 'no result on a throw-in');
            ok(h.final.tricks.length === 0, 'no tricks on a throw-in');
            ok(h.final.contract === null, 'no contract on a throw-in');
            expect([...h.final.marks]).toEqual([...h.marksBefore]);
          }
          if (i > 0) {
            ok(h.shaker === nextSeat(hands[i - 1]!.shaker), 'the shake rotates clockwise');
          }
        }
      }),
      { numRuns: 50 },
    );
    expect(thrown).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Bonus robustness properties
// ---------------------------------------------------------------------------

describe('engine robustness (property-based)', () => {
  it('applyAction never mutates its input (deep-frozen states throughout)', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        // Strict-mode modules: any mutation of a frozen object throws.
        runGame(cfg, seed, { maxHands: 3, freeze: true });
      }),
      { numRuns: 40 },
    );
    // Belt and braces: a serialized snapshot is unchanged by applyAction.
    const st = newGame(CASUAL_CONFIG, 'no-mutate');
    const before = JSON.stringify(st);
    applyAction(st, legalActions(st)[0]!);
    expect(JSON.stringify(st)).toBe(before);
  });

  it('every action in legalActions applies without throwing', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 2,
          onStep: (state) => {
            for (const a of legalActions(state)) applyAction(state, a);
          },
        });
      }),
      { numRuns: 30 },
    );
  });

  it('actions outside legalActions always throw', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 2,
          onStep: (state) => {
            // Wrong-phase actions.
            if (state.phase !== 'bidding') {
              expect(() =>
                applyAction(state, { type: 'bid', bid: { kind: 'pass' } }),
              ).toThrow();
            }
            if (state.phase !== 'declaring') {
              expect(() =>
                applyAction(state, { type: 'declare', decl: { type: 'pip', pip: 0 } }),
              ).toThrow();
            }
            if (state.phase !== 'playing') {
              expect(() => applyAction(state, { type: 'play', domino: '00' })).toThrow();
            }
            if (state.phase !== 'hand-over') {
              expect(() => applyAction(state, { type: 'next-hand' })).toThrow();
            }
            // Bad bids.
            if (state.phase === 'bidding') {
              expect(() =>
                applyAction(state, { type: 'bid', bid: { kind: 'points', value: 29 } }),
              ).toThrow();
              expect(() =>
                applyAction(state, { type: 'bid', bid: { kind: 'points', value: 42 } }),
              ).toThrow();
              const cur = highBid(state.bids);
              if (cur) {
                // Re-bidding the current high bid is never a raise.
                expect(() => applyAction(state, { type: 'bid', bid: cur.bid })).toThrow();
              }
            }
            // Bad plays: not in hand, or in hand but illegal.
            if (state.phase === 'playing' && state.turn !== null) {
              const hand = state.hands[state.turn]!;
              const legal = new Set(
                legalActions(state).flatMap((a) => (a.type === 'play' ? [a.domino] : [])),
              );
              const inHandIllegal = hand.find((id) => !legal.has(id));
              if (inHandIllegal !== undefined) {
                expect(() =>
                  applyAction(state, { type: 'play', domino: inHandIllegal }),
                ).toThrow();
              }
              const other = nextSeat(state.turn);
              const foreign = state.hands[other]!.find((id) => !hand.includes(id));
              if (foreign !== undefined) {
                expect(() => applyAction(state, { type: 'play', domino: foreign })).toThrow();
              }
            }
          },
        });
      }),
      { numRuns: 25 },
    );
  });

  it('a renege (off-suit play while holding the led suit) is always rejected', () => {
    let reneges = 0;
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 3,
          onStep: (state) => {
            if (state.phase !== 'playing' || state.turn === null) return;
            if (state.contract!.kind === 'sevens') return;
            if (state.currentTrick.length === 0) return;
            const rules = state.rules!;
            const led = ledSuitOf(fromId(state.currentTrick[0]!.domino), rules);
            const hand = state.hands[state.turn]!;
            if (!hand.some((id) => follows(fromId(id), led, rules))) return;
            const offSuit = hand.find((id) => !follows(fromId(id), led, rules));
            if (offSuit === undefined) return;
            reneges++;
            expect(() => applyAction(state, { type: 'play', domino: offSuit })).toThrow();
            // ...and every offered play follows the led suit.
            for (const a of legalActions(state)) {
              ok(
                a.type === 'play' && follows(fromId(a.domino), led, rules),
                'all legal plays must follow when following is possible',
              );
            }
          },
        });
      }),
      { numRuns: 40 },
    );
    expect(reneges).toBeGreaterThan(0);
  });

  it('trick winners match an independent reimplementation of the suit algebra', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        runGame(cfg, seed, {
          maxHands: 3,
          onStep: (state, _action, next) => {
            if (state.contract?.kind === 'sevens' || state.rules === null) return;
            if (next.tricks.length > state.tricks.length) {
              const t = next.tricks[next.tricks.length - 1]!;
              ok(
                t.winner === refWinner(t.plays, state.rules),
                `trick winner mismatch: engine says ${t.winner}, oracle says ${refWinner(
                  t.plays,
                  state.rules,
                )} for ${JSON.stringify(t.plays)}`,
              );
            }
          },
        });
      }),
      { numRuns: 50 },
    );
  });

  it('the same config and seed always produce the same game', () => {
    fc.assert(
      fc.property(configArb, seedArb, (cfg, seed) => {
        const a = runGame(cfg, seed, { maxHands: 3 });
        const b = runGame(cfg, seed, { maxHands: 3 });
        expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final));
      }),
      { numRuns: 20 },
    );
  });
});
