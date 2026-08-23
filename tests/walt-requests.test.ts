/**
 * walt request/response mapping (src/ai/walt/requests.ts): pure functions
 * from Observation to walt's wire shapes and back. No wasm here — this pins
 * the load-bearing details: originally-dealt hand reconstruction, the
 * chronological play record, decl/bid id mapping, per-hand seed stability,
 * scope rejection, and legality filtering of walt's responses.
 */

import { describe, expect, it } from 'vitest';
import {
  type GameState,
  type Seat,
  CASUAL_CONFIG,
  applyAction,
  legalActions,
  mulberry32,
  newGame,
  toSeed,
} from '../src/engine';
import { chooseAction } from '../src/ai';
import { observe } from '../src/ai/observation';
import {
  WALT_THETA,
  bidActionOf,
  bidNeedOf,
  bidRequestOf,
  conformanceFailure,
  dealtHandTiles,
  declareActionOf,
  declareRequestOf,
  idOfTile,
  playActionOf,
  playRequestOf,
  tileOfId,
  waltContractBid,
  waltDeclId,
} from '../src/ai/walt/requests';
import type { BidResponse, PlayResponse } from '../src/ai/walt/walt';

const TUNING = { n: 4, n0: 2 };

/** Drive a game with medium until `until` holds (or game over). */
function drive(seed: string, until: (g: GameState) => boolean): GameState {
  let st = newGame(CASUAL_CONFIG, seed);
  const rand = mulberry32(toSeed(seed));
  let steps = 0;
  while (!until(st) && st.phase !== 'game-over') {
    if (++steps > 10_000) throw new Error('drive did not reach the target state');
    if (st.phase === 'hand-over') {
      st = applyAction(st, { type: 'next-hand' });
      continue;
    }
    st = applyAction(st, chooseAction(st, st.turn!, 'medium', rand));
  }
  return st;
}

const straightPlaying = (g: GameState): boolean =>
  g.phase === 'playing' && waltDeclId(g.declaration) !== null && g.sittingOut === null;

describe('tile id conversion', () => {
  it('round-trips all 28 dominoes', () => {
    for (let h = 0; h <= 6; h++) {
      for (let l = 0; l <= h; l++) {
        const id = `${h}${l}`;
        expect(idOfTile(tileOfId(id))).toBe(id);
      }
    }
    expect(tileOfId('00')).toBe(0);
    expect(tileOfId('66')).toBe(27);
  });
});

describe('bid requests', () => {
  it('opens at need 30 with the full sorted hand and calibrated theta', () => {
    const st = newGame(CASUAL_CONFIG, 'walt-bid-open');
    const obs = observe(st, st.turn! as Seat);
    const req = bidRequestOf(obs, TUNING);
    expect(req).not.toBeNull();
    expect(req!.need).toBe(30);
    expect(req!.hand).toHaveLength(7);
    expect([...req!.hand].sort((a, b) => a - b)).toEqual(req!.hand);
    expect(req!.theta).toEqual([WALT_THETA[0], WALT_THETA[1]]);
  });

  it('need is current high + 1 after a points bid', () => {
    let st = newGame(CASUAL_CONFIG, 'walt-bid-need');
    const bid31 = legalActions(st).find(
      (a) => a.type === 'bid' && a.bid.kind === 'points' && a.bid.value === 31,
    );
    expect(bid31).toBeDefined();
    st = applyAction(st, bid31!);
    const obs = observe(st, st.turn! as Seat);
    expect(bidNeedOf(obs)).toBe(32);
    expect(bidRequestOf(obs, TUNING)!.need).toBe(32);
  });

  it('goes out of scope (null) once the auction passes 42', () => {
    const st = newGame(CASUAL_CONFIG, 'walt-bid-marks');
    const obs = observe(st, st.turn! as Seat);
    const marked = {
      ...obs,
      bids: [{ seat: 0 as Seat, bid: { kind: 'marks' as const, value: 1 } }],
    };
    expect(bidNeedOf(marked)).toBe(43);
    expect(bidRequestOf(marked, TUNING)).toBeNull();
  });

  it('maps bid responses onto legal actions only', () => {
    const st = newGame(CASUAL_CONFIG, 'walt-bid-map');
    const acts = legalActions(st);
    const resp = (action: 'bid' | 'pass', bid?: number): BidResponse =>
      bid === undefined ? { action, prices: [] } : { action, bid, prices: [] };
    expect(bidActionOf(resp('pass'), acts)).toEqual({ type: 'bid', bid: { kind: 'pass' } });
    expect(bidActionOf(resp('bid', 30), acts)).toEqual({
      type: 'bid',
      bid: { kind: 'points', value: 30 },
    });
    // 42 means a plain 1-mark bid, never plunge/splash/nello.
    const marks = bidActionOf(resp('bid', 42), acts);
    expect(marks).not.toBeNull();
    expect(marks).toMatchObject({ type: 'bid', bid: { kind: 'marks', value: 1 } });
    expect((marks as { bid: { special?: string } }).bid.special).toBeUndefined();
    // Out of walt's range → no action → caller falls back to hard.
    expect(bidActionOf(resp('bid', 84), acts)).toBeNull();
  });
});

describe('declare requests', () => {
  it('builds from a declaring state and maps decl ids onto legal declarations', () => {
    const st = drive('walt-declare', (g) => g.phase === 'declaring');
    expect(st.phase).toBe('declaring');
    const obs = observe(st, st.turn! as Seat);
    if (waltContractBid(st.contract) !== null) {
      const req = declareRequestOf(obs, TUNING);
      expect(req).not.toBeNull();
      expect(req!.hand).toHaveLength(7);
      expect(req!.bid).toBe(waltContractBid(st.contract));
    }
    const acts = legalActions(st);
    const declOf = (decl: number) => declareActionOf({ decl, prices: [] }, acts);
    expect(declOf(9)).toEqual({ type: 'declare', decl: { type: 'no-trump' } });
    expect(declOf(3)).toEqual({ type: 'declare', decl: { type: 'pip', pip: 3 } });
    expect(declOf(7)).toEqual({ type: 'declare', decl: { type: 'doubles' } });
    expect(declOf(8)).toBeNull(); // 8 is not a walt declaration id
  });
});

describe('play requests', () => {
  it('reconstructs the originally dealt hand and the chronological record', () => {
    const st = drive('walt-play-req', (g) => straightPlaying(g) && g.tricks.length >= 2);
    expect(straightPlaying(st)).toBe(true);
    const seat = st.turn! as Seat;
    const obs = observe(st, seat);
    const req = playRequestOf(obs, TUNING);
    expect(req).not.toBeNull();

    // Dealt hand: remaining hand + own plays, exactly 7, sorted, no dupes.
    expect(req!.hand).toHaveLength(7);
    expect(new Set(req!.hand).size).toBe(7);
    for (const id of obs.hand) expect(req!.hand).toContain(tileOfId(id));
    const played = st.tricks
      .flatMap((t) => t.plays)
      .concat(st.currentTrick)
      .filter((p) => p.seat === seat);
    for (const p of played) expect(req!.hand).toContain(tileOfId(p.domino));
    expect(obs.hand.length + played.length).toBe(7);

    // Play record: flat (seat, tile) pairs, full chronology.
    const total = st.tricks.reduce((n, t) => n + t.plays.length, 0) + st.currentTrick.length;
    expect(req!.plays).toHaveLength(2 * total);
    const first = st.tricks[0]!.plays[0]!;
    expect(req!.plays[0]).toBe(first.seat);
    expect(req!.plays[1]).toBe(tileOfId(first.domino));

    // Contract mapping.
    expect(req!.decl).toBe(waltDeclId(st.declaration));
    expect(req!.bid).toBe(waltContractBid(st.contract));
    expect(req!.bidder).toBe(st.declarer);
    expect(req!.race).toBe(true);
  });

  it('seed is stable across decisions of the same hand', () => {
    const st1 = drive('walt-seed', straightPlaying);
    const st2 = drive('walt-seed', (g) => straightPlaying(g) && g.tricks.length >= 3);
    const r1 = playRequestOf(observe(st1, st1.turn! as Seat), TUNING)!;
    const r2 = playRequestOf(observe(st2, st2.turn! as Seat), TUNING)!;
    expect(r1.seed).toBe(r2.seed);
  });

  it('rejects out-of-scope contracts and the sat-out-partner rule', () => {
    const st = drive('walt-scope', straightPlaying);
    const obs = observe(st, st.turn! as Seat);
    expect(playRequestOf(obs, TUNING)).not.toBeNull();
    expect(
      playRequestOf({ ...obs, declaration: { type: 'nello' } }, TUNING),
    ).toBeNull();
    expect(
      playRequestOf({ ...obs, contract: { kind: 'sevens', value: 1 } }, TUNING),
    ).toBeNull();
    expect(playRequestOf({ ...obs, sittingOut: 1 as Seat }, TUNING)).toBeNull();
  });

  it('maps play responses onto legal actions only', () => {
    const st = drive('walt-play-map', straightPlaying);
    const acts = legalActions(st);
    const legal = acts.find((a) => a.type === 'play')!;
    const resp = (choice: number): PlayResponse => ({
      choice,
      forced: false,
      opts: [],
      leader: 0,
      points: [0, 0],
    });
    expect(playActionOf(resp(tileOfId(legal.domino)), acts)).toEqual(legal);
    // A tile the seat cannot play (already on the table or not held) → null.
    const held = new Set(
      acts.filter((a) => a.type === 'play').map((a) => tileOfId(a.domino)),
    );
    const outside = Array.from({ length: 28 }, (_, t) => t).find((t) => !held.has(t))!;
    expect(playActionOf(resp(outside), acts)).toBeNull();
  });
});

describe('conformance check', () => {
  it('accepts agreement and reports leader/points mismatches', () => {
    const st = drive('walt-conform', straightPlaying);
    const obs = observe(st, st.turn! as Seat);
    const leader = obs.currentTrick.length > 0 ? obs.currentTrick[0]!.seat : obs.leader!;
    const agree: PlayResponse = {
      choice: 0,
      forced: false,
      opts: [],
      leader,
      points: [obs.points[0]!, obs.points[1]!],
    };
    expect(conformanceFailure(obs, agree)).toBeNull();
    expect(
      conformanceFailure(obs, { ...agree, leader: ((leader + 1) % 4) as Seat }),
    ).toMatch(/leader/);
    expect(
      conformanceFailure(obs, { ...agree, points: [obs.points[0]! + 5, obs.points[1]!] }),
    ).toMatch(/points/);
  });
});
