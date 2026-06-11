/**
 * Pointed scenario tests:
 *  - a lay-down plunge hand (5 doubles, found by seed scan) gets a Plunge bid,
 *  - the declarer holding the trump double pulls trump,
 *  - a defender feeds count onto partner's certain winner,
 *  - count is never sloughed onto an opponent-won trick when junk exists,
 *  - a stone-cold low hand bids marks and declares Nel-O.
 */

import { describe, expect, it } from 'vitest';
import {
  CASUAL_CONFIG,
  type DominoId,
  type GameState,
  type Seat,
  applyAction,
  buildRules,
  countValue,
  doublesIn,
  fromId,
  hasPip,
  mulberry32,
  newGame,
  toSeed,
} from '../src/engine';
import { chooseAction } from '../src/ai/index';

const rand = () => mulberry32(toSeed('ai-sanity'));

/** Craft a full GameState around the interesting fields. */
function crafted(over: Partial<GameState> & { hands: DominoId[][] }): GameState {
  return {
    config: CASUAL_CONFIG,
    rngState: 1,
    marks: [0, 0],
    handNumber: 1,
    shaker: 0,
    phase: 'playing',
    dealt: over.hands.map((h) => [...h]),
    bids: [],
    turn: null,
    declarer: null,
    contract: null,
    declaration: null,
    rules: null,
    sittingOut: null,
    forcedBid: false,
    leader: null,
    currentTrick: [],
    tricks: [],
    points: [0, 0],
    thrownIn: false,
    handResult: null,
    winner: null,
    ...over,
  };
}

describe('AI sanity scenarios', () => {
  it('bids Plunge on a lay-down plunge hand (5+ doubles)', () => {
    // Scan seeds for a dealt hand with 5+ doubles — an unambiguous plunge.
    let found: { seed: string; seat: Seat } | null = null;
    for (let i = 0; i < 4000 && !found; i++) {
      const seed = `plunge-scan-${i}`;
      const st = newGame(CASUAL_CONFIG, seed);
      for (const s of [0, 1, 2, 3] as Seat[]) {
        if (doublesIn(st.hands[s]!) >= 5) {
          found = { seed, seat: s };
          break;
        }
      }
    }
    expect(found, 'no 5-double deal found in scan').not.toBeNull();

    let st = newGame(CASUAL_CONFIG, found!.seed);
    while (st.turn !== found!.seat) {
      st = applyAction(st, { type: 'bid', bid: { kind: 'pass' } });
    }
    for (const difficulty of ['medium', 'hard'] as const) {
      const a = chooseAction(st, found!.seat, difficulty, rand());
      expect(a.type).toBe('bid');
      if (a.type === 'bid') {
        expect(a.bid.kind).toBe('marks');
        if (a.bid.kind === 'marks') expect(a.bid.special).toBe('plunge');
      }
    }
  });

  it('declarer holding the trump double pulls trump on the opening lead', () => {
    const st = crafted({
      hands: [
        ['00', '10', '11', '20', '22', '31', '32'],
        ['55', '51', '50', '64', '40', '30', '21'], // declarer: 5s trump, boss 5-5
        ['33', '41', '42', '43', '44', '52', '53'],
        ['54', '60', '61', '62', '63', '65', '66'],
      ],
      phase: 'playing',
      declarer: 1,
      contract: { kind: 'points', value: 30 },
      declaration: { type: 'pip', pip: 5 },
      rules: buildRules({ type: 'pip', pip: 5 }, CASUAL_CONFIG),
      leader: 1,
      turn: 1,
    });
    const a = chooseAction(st, 1, 'medium', rand());
    expect(a).toEqual({ type: 'play', domino: '55' });
    // Hard agrees that pulling the boss trump is right here.
    const h = chooseAction(st, 1, 'hard', rand());
    expect(h.type).toBe('play');
    if (h.type === 'play') expect(hasPip(fromId(h.domino), 5)).toBe(true);
  });

  it('defender feeds the 10-count to partner certain winner', () => {
    // 1s are trump; partner (seat 1) has the 6-6 on top, I am last to play.
    const st = crafted({
      hands: [
        ['10', '11', '21', '22', '31', '32'],
        ['33', '40', '42', '43', '44', '50'],
        ['51', '53', '54', '55', '60', '61'],
        ['64', '65', '41', '30', '20', '52', '00'],
      ],
      phase: 'playing',
      declarer: 0,
      contract: { kind: 'points', value: 30 },
      declaration: { type: 'pip', pip: 1 },
      rules: buildRules({ type: 'pip', pip: 1 }, CASUAL_CONFIG),
      leader: 0,
      turn: 3,
      currentTrick: [
        { seat: 0, domino: '62' },
        { seat: 1, domino: '66' },
        { seat: 2, domino: '63' },
      ],
    });
    for (const difficulty of ['medium', 'hard'] as const) {
      const a = chooseAction(st, 3, difficulty, rand());
      expect(a, difficulty).toEqual({ type: 'play', domino: '64' });
    }
  });

  it('never sloughs count onto an opponent-won trick when junk exists', () => {
    // Declarer (seat 0) led the boss trump 1-1; seat 1 is void in trump and
    // holds the 5-5 and 6-4 — it must not donate them.
    const st = crafted({
      hands: [
        ['10', '21', '31', '41', '51', '61'],
        ['55', '64', '62', '20', '30', '42', '53'],
        ['00', '22', '32', '33', '40', '43', '44'],
        ['50', '52', '54', '60', '63', '65', '66'],
      ],
      phase: 'playing',
      declarer: 0,
      contract: { kind: 'points', value: 30 },
      declaration: { type: 'pip', pip: 1 },
      rules: buildRules({ type: 'pip', pip: 1 }, CASUAL_CONFIG),
      leader: 0,
      turn: 1,
      currentTrick: [{ seat: 0, domino: '11' }],
    });
    for (const difficulty of ['medium', 'hard'] as const) {
      const a = chooseAction(st, 1, difficulty, rand());
      expect(a.type).toBe('play');
      if (a.type === 'play') {
        expect(countValue(fromId(a.domino)), difficulty).toBe(0);
      }
    }
  });

  it('bids marks and declares Nel-O on a stone-cold low hand', () => {
    let st = crafted({
      hands: [
        ['00', '10', '20', '21', '30', '31', '41'], // near-perfect nello
        ['11', '22', '32', '33', '40', '42', '43'],
        ['44', '50', '51', '52', '53', '54', '55'],
        ['60', '61', '62', '63', '64', '65', '66'],
      ],
      phase: 'bidding',
      shaker: 3,
      turn: 0,
    });
    const bid = chooseAction(st, 0, 'medium', rand());
    expect(bid.type).toBe('bid');
    if (bid.type === 'bid') {
      expect(bid.bid).toEqual({ kind: 'marks', value: 1 });
    }
    st = applyAction(st, bid);
    for (let i = 0; i < 3; i++) st = applyAction(st, { type: 'bid', bid: { kind: 'pass' } });
    expect(st.phase).toBe('declaring');
    const decl = chooseAction(st, 0, 'medium', rand());
    expect(decl).toEqual({ type: 'declare', decl: { type: 'nello' } });
  });
});
