// Heads-up limit Texas hold'em, as a Walt game (the card's seven functions plus
// the hooks the chip-payoff generalization needs).
//
// Seats: 0 = button = small blind (acts first preflop, last after), 1 = big blind.
// Chips: SB 1, BB 2; small bet 2 (preflop, flop), big bet 4 (turn, river);
// at most 4 bets per street (the big blind counts as the first preflop bet).
// Each hand is independent: both players cover the maximum 48 chips a hand
// can cost, so stacks never constrain a hand.
// Actions: 0 = fold, 1 = check/call, 2 = bet/raise.
// A deal is Int8Array(9): [h0a, h0b, h1a, h1b, flop0, flop1, flop2, turn, river].
import { score7 } from './cards.js';

export const FOLD = 0, CALL = 1, RAISE = 2;
export const BET_SIZE = [2, 2, 4, 4];
export const CAP = 4;
export const BOARD_VISIBLE = [0, 3, 4, 5, 5];
export const MAX_LOSS = 48;

// Public state: everything both players have seen (betting record; the board
// cards themselves are read from the deal via `visibleBoard`).
export function initial() {
  return { street: 0, c0: 1, c1: 2, bets: 1, acted: 0, actor: 0, folded: -1, done: false, fresh: false, hist: '' };
}

export function toMove(pub) { return pub.actor; }
export function isTerminal(pub) { return pub.done; }
export function maximizes() { return true; } // every seat maximizes its own chips

export function legal(pub) {
  const facing = pub.actor === 0 ? pub.c1 > pub.c0 : pub.c0 > pub.c1;
  if (facing) return pub.bets < CAP ? [FOLD, CALL, RAISE] : [FOLD, CALL];
  return pub.bets < CAP ? [CALL, RAISE] : [CALL];
}

export function play(pub, a) {
  const s = pub.actor, o = 1 - s;
  let { street, c0, c1, bets, acted } = pub;
  const ch = a === FOLD ? 'f' : a === CALL ? 'c' : 'r';
  if (a === FOLD) {
    return { street, c0, c1, bets, acted: acted + 1, actor: o, folded: s, done: true, fresh: false, hist: pub.hist + ch };
  }
  const mine = s === 0 ? c0 : c1, theirs = s === 0 ? c1 : c0;
  let next = a === CALL ? theirs : theirs + BET_SIZE[street];
  if (a === RAISE) bets++;
  if (s === 0) c0 = next; else c1 = next;
  acted++;
  if (a === CALL && acted >= 2 && c0 === c1) { // street closes
    if (street === 3) return { street: 4, c0, c1, bets, acted, actor: -1, folded: -1, done: true, fresh: false, hist: pub.hist + ch };
    return { street: street + 1, c0, c1, bets: 0, acted: 0, actor: 1, folded: -1, done: false, fresh: true, hist: pub.hist + ch + '/' };
  }
  void mine;
  return { street, c0, c1, bets, acted, actor: o, folded: -1, done: false, fresh: false, hist: pub.hist + ch };
}

// Net chips won by `seat` at a terminal state, given the showdown sign sd
// (+1 seat 0 wins, -1 seat 1 wins, 0 split).
export function payoff(pub, seat, sd) {
  if (pub.folded >= 0) {
    const lost = pub.folded === 0 ? pub.c0 : pub.c1;
    return pub.folded === seat ? -lost : lost;
  }
  const v = sd * pub.c0; // contributions are equal at showdown
  return seat === 0 ? v : -v;
}

export function showdownSign(deal) {
  const b = deal.subarray(4, 9);
  const s0 = score7(deal[0], deal[1], b), s1 = score7(deal[2], deal[3], b);
  return s0 > s1 ? 1 : s0 < s1 ? -1 : 0;
}

// ---- search-side deal records -------------------------------------------
// { c: Int8Array(9), sd, k: [_, flopKey, turnKey, riverKey] }
export function makeDeal(c) {
  const k1 = (c[4] * 52 + c[5]) * 52 + c[6], k2 = k1 * 52 + c[7], k3 = k2 * 52 + c[8];
  return { c, sd: showdownSign(c), k1, k2, k3 };
}
export function boardKey(deal, street) {
  return street === 0 ? 0 : street === 1 ? deal.k1 : street === 2 ? deal.k2 : deal.k3;
}

// The card's `private(deal, seat, public)`: what `seat` holds and sees.
export function privateOf(deal, seat, pub) {
  const c = deal.c, nb = BOARD_VISIBLE[pub.street];
  return { seat, hole: [c[2 * seat], c[2 * seat + 1]], board: Array.from(c.subarray(4, 4 + nb)) };
}
// Memo key for a modeled seat's decision: its holding + the public record.
export function privKey(deal, seat, pub) {
  const c = deal.c, a = c[2 * seat], b = c[2 * seat + 1];
  return (a < b ? a * 52 + b : b * 52 + a) + ':' + boardKey(deal, pub.street) + ':' + pub.hist;
}

// The card's `sample(seat, private, public, n, rng)`. Walt's deals respect only
// what is lawful: the seat's own hole cards and the visible board. Unknown
// cards (opponent hole cards, future board) are uniform over the unseen deck;
// no inference is drawn from the betting.
//
// Structured (hierarchical) sample: within `horizon` future streets each new
// street's cards branch `branch` ways, so every later information set of the
// decider holds many deals (otherwise each sampled board would be its own
// singleton group and the search would read the opponent's cards). The leaves
// draw opponent hole cards + any remaining board jointly.
export function sample(seat, priv, pub, n, horizon, branch, rng) {
  const used = new Uint8Array(52);
  for (const x of priv.hole) used[x] = 1;
  for (const x of priv.board) used[x] = 1;
  const street = pub.street;
  const levels = Math.max(0, Math.min(3, street + horizon) - street); // chance levels searched
  let prod = 1; for (let i = 0; i < levels; i++) prod *= branch;
  const leaves = Math.max(1, Math.ceil(n / prod));
  const base = new Int8Array(9);
  base[2 * seat] = priv.hole[0]; base[2 * seat + 1] = priv.hole[1];
  for (let i = 0; i < priv.board.length; i++) base[4 + i] = priv.board[i];
  const out = [];
  const draw = () => { let x; do { x = rng.int(52); } while (used[x]); used[x] = 1; return x; };
  const rec = (st, lvl, cards, fresh) => {
    if (lvl === levels) {
      for (let h = 0; h < leaves; h++) {
        const c = Int8Array.from(cards), got = [];
        const o = 1 - seat;
        c[2 * o] = draw(); c[2 * o + 1] = draw(); got.push(c[2 * o], c[2 * o + 1]);
        for (let i = 4 + BOARD_VISIBLE[st]; i < 9; i++) { c[i] = draw(); got.push(c[i]); }
        for (const x of got) used[x] = 0;
        out.push(makeDeal(c));
      }
      return;
    }
    for (let b = 0; b < branch; b++) {
      const c = Int8Array.from(cards), got = [];
      for (let i = 4 + BOARD_VISIBLE[st]; i < 4 + BOARD_VISIBLE[st + 1]; i++) { c[i] = draw(); got.push(c[i]); }
      rec(st + 1, lvl + 1, c, true);
      for (const x of got) used[x] = 0;
    }
    void fresh;
  };
  rec(street, 0, base, false);
  return out;
}

// Sum of net chips for `me` over `deals` at a terminal state.
export function payoffSum(deals, me, pub) {
  if (pub.folded >= 0) return payoff(pub, me, 0) * deals.length;
  let s = 0;
  for (let i = 0; i < deals.length; i++) s += deals[i].sd;
  return (me === 0 ? s : -s) * pub.c0;
}
// Beyond the search horizon: check the hand down (no more betting) and show down.
export function rolloutSum(deals, me, pub) {
  let s = 0;
  for (let i = 0; i < deals.length; i++) s += deals[i].sd;
  return (me === 0 ? s : -s) * pub.c0;
}

export const game = {
  toMove, isTerminal, legal, play, privateOf, privKey, sample, payoffSum, rolloutSum, boardKey, maximizes,
};
