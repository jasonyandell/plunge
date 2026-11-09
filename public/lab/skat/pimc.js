// Baseline: PIMC (perfect-information Monte Carlo) with an exact double-dummy solve per
// sampled world. Each world is solved exactly by alpha-beta over declarer card points with
// a transposition table at trick starts and equivalent-card pruning; the root question is
// binary (declarer reaches 61 including the skat) so every solve is a null-window search.
import { EFF, ESUIT, STR, ORDER, PTS, TRUMP, orderedLegal, play, sampleDeals, outcomeDeal, beats } from './skat.js';

const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS;
const ttH0 = new Int32Array(TT_SIZE), ttH1 = new Int32Array(TT_SIZE), ttH2 = new Int32Array(TT_SIZE);
const ttMeta = new Int32Array(TT_SIZE); // gen * 4 + leader + 1 (0 = empty)
const ttLo = new Int16Array(TT_SIZE), ttHi = new Int16Array(TT_SIZE);
let gen = 0;

let G = 0, DECL = 0;
const H = new Int32Array(3);
const moveBuf = new Int8Array(32 * 12);
const scoreBuf = new Int16Array(32 * 12);
export const stats = { nodes: 0 };

function remainingPts() {
  let m = H[0] | H[1] | H[2], p = 0;
  while (m) { const b = m & -m; p += PTS[31 - Math.clz32(b)]; m ^= b; }
  return p;
}

// Fill moveBuf[base..] with ordered, equivalence-pruned moves; return count.
function genMoves(p, legal, trick0, trick1, n, base) {
  const others = (H[0] | H[1] | H[2]) & ~H[p];
  let blockers = others;
  if (n >= 1) blockers |= 1 << trick0;
  if (n >= 2) blockers |= 1 << trick1;
  let cnt = 0;
  const ord = ORDER[G];
  for (let s = 0; s <= 4; s++) {
    if (!(legal & EFF[G][s])) continue;
    const list = ord[s];
    let prev = -1;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if ((blockers >> c) & 1) { prev = -1; continue; }
      if (!((legal >> c) & 1)) continue; // already played earlier: transparent
      if (prev !== -1 && PTS[prev] === PTS[c]) { prev = c; continue; } // equivalent to prev (keep lower)
      moveBuf[base + cnt++] = c; prev = c;
    }
  }
  // ordering: score moves, insertion sort descending
  const maxer = p === DECL;
  // current winning card of the trick (relative position)
  let w = trick0, wpos = 0;
  if (n === 2 && beats(G, trick1, trick0)) { w = trick1; wpos = 1; }
  const myTeamWinning = n > 0 && ((((p - n + 3) % 3 + wpos) % 3 === DECL) === maxer);
  for (let i = 0; i < cnt; i++) {
    const c = moveBuf[base + i];
    let sc;
    if (n === 0) {
      sc = STR[G][c] * 2 + (ESUIT[G][c] === TRUMP ? (maxer ? 30 : -10) : 0) + PTS[c];
    } else {
      const wins = beats(G, c, w);
      if (wins) sc = 100 + PTS[c] * 2 - STR[G][c];
      else if (myTeamWinning) sc = 60 + PTS[c] * 3; // smear points on partner's trick
      else sc = 40 - PTS[c] * 3 - STR[G][c];
    }
    scoreBuf[base + i] = sc;
  }
  for (let i = 1; i < cnt; i++) {
    const c = moveBuf[base + i], sc = scoreBuf[base + i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[base + j] < sc) { scoreBuf[base + j + 1] = scoreBuf[base + j]; moveBuf[base + j + 1] = moveBuf[base + j]; j--; }
    scoreBuf[base + j + 1] = sc; moveBuf[base + j + 1] = c;
  }
  return cnt;
}

// Declarer's future card points from here (current trick included), fail-soft alpha-beta.
// p = player to move, leader = trick leader, n = cards already in trick (t0, t1).
function search(p, leader, t0, t1, n, alpha, beta, ply) {
  stats.nodes++;
  let idx = -1, a0 = alpha, b0 = beta;
  if (n === 0) {
    if ((H[0] | H[1] | H[2]) === 0) return 0;
    const rem = remainingPts();
    if (rem <= alpha) return rem;
    if (beta <= 0) return 0;
    let h = Math.imul(H[0], 0x9e3779b1) ^ Math.imul(H[1] ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(H[2] ^ 0x27d4eb2f, 0xc2b2ae35) ^ leader;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    idx = (h ^ (h >>> 13)) >>> (32 - TT_BITS);
    if (ttMeta[idx] === gen * 4 + leader + 1 && ttH0[idx] === H[0] && ttH1[idx] === H[1] && ttH2[idx] === H[2]) {
      const lo = ttLo[idx], hi = ttHi[idx];
      if (lo >= beta) return lo;
      if (hi <= alpha) return hi;
      if (lo === hi) return lo;
      if (lo > alpha) alpha = lo;
      if (hi < beta) beta = hi;
    }
    a0 = alpha; b0 = beta;
  }
  const hand = H[p];
  let legal = hand;
  if (n > 0) { const f = hand & EFF[G][ESUIT[G][t0]]; if (f) legal = f; }
  const base = ply * 12;
  const cnt = genMoves(p, legal, t0, t1, n, base);
  const maxer = p === DECL;
  let best = maxer ? -1 : 1000;
  for (let i = 0; i < cnt; i++) {
    const c = moveBuf[base + i];
    H[p] ^= 1 << c;
    let v;
    if (n === 2) {
      let w = t0, wi = 0;
      if (beats(G, t1, w)) { w = t1; wi = 1; }
      if (beats(G, c, w)) { wi = 2; }
      const ws = (leader + wi) % 3;
      if (ws === DECL) {
        const pts = PTS[t0] + PTS[t1] + PTS[c];
        v = pts + search(ws, ws, 0, 0, 0, alpha - pts, beta - pts, ply + 1);
      } else {
        v = search(ws, ws, 0, 0, 0, alpha, beta, ply + 1);
      }
    } else if (n === 1) {
      v = search((p + 1) % 3, leader, t0, c, 2, alpha, beta, ply + 1);
    } else {
      v = search((p + 1) % 3, leader, c, 0, 1, alpha, beta, ply + 1);
    }
    H[p] ^= 1 << c;
    if (maxer) {
      if (v > best) { best = v; if (v > alpha) alpha = v; }
    } else if (v < best) { best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  if (idx >= 0) {
    let lo = 0, hi = 120;
    const meta = gen * 4 + leader + 1;
    if (ttMeta[idx] === meta && ttH0[idx] === H[0] && ttH1[idx] === H[1] && ttH2[idx] === H[2]) { lo = ttLo[idx]; hi = ttHi[idx]; }
    if (best <= a0) { if (best < hi) hi = best; } else if (best >= b0) { if (best > lo) lo = best; } else { lo = best; hi = best; }
    ttMeta[idx] = meta; ttH0[idx] = H[0]; ttH1[idx] = H[1]; ttH2[idx] = H[2]; ttLo[idx] = lo; ttHi[idx] = hi;
  }
  return best;
}

/** Load a world (full deal) at public state `pub` into the solver. */
function loadWorld(deal, pub) {
  G = pub.g; DECL = pub.decl;
  for (let s = 0; s < 3; s++) H[s] = deal.h[s] & ~pub.played;
  gen++;
  if (gen > 0x1fffffff) { gen = 1; ttMeta.fill(0); }
}

/** exact: does declarer (playing double dummy) reach 61 in this world from `pub`? */
function solveWin(pub, sp) {
  const o = outcomeDeal(pub, sp);
  if (o !== null) return o;
  const need = 61 - pub.declPts - sp;
  const t = pub.trick;
  const v = search(pub.turn, pub.leader, t.length > 0 ? t[0] : 0, t.length > 1 ? t[1] : 0, t.length, need - 1, need, 0);
  return v >= need;
}

/** exact double-dummy win/loss of a whole deal (for analysis). */
export function ddValue(deal, pub) {
  loadWorld(deal, pub);
  return solveWin(pub, deal.sp);
}

/** PIMC: sample n worlds from seat's chair, solve each exactly per candidate move, pick
 *  the move with most declarer wins (declarer) / fewest (defender). Ties: first in order. */
export function pimcDecide(seat, priv, pub, rng, n) {
  const opts = orderedLegal(priv.hand, pub); // same tie order as Walt
  if (opts.length === 1) return opts[0];
  const deals = sampleDeals(seat, priv, pub, n, rng);
  const score = new Array(opts.length).fill(0);
  const kids = opts.map((a) => play(pub, a));
  for (const d of deals) {
    loadWorld(d, pub);
    for (let i = 0; i < opts.length; i++) {
      H[seat] ^= 1 << opts[i]; // solver hands = cards still held after the move
      if (solveWin(kids[i], d.sp)) score[i]++;
      H[seat] ^= 1 << opts[i];
    }
  }
  const maxi = seat === pub.decl;
  let bi = 0;
  for (let i = 1; i < opts.length; i++) if (maxi ? score[i] > score[bi] : score[i] < score[bi]) bi = i;
  return opts[bi];
}
