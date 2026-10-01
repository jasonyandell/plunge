// Spades engine: rules, public state, deals, sampling, scoring, the shared
// heuristic bidder and the rule-based card player. Plain ES module, shared by
// the page, the worker and the Node h2h harness (lab/spades/). Integers only.
//
// Cards: c = suit*13 + rank, rank 0 = '2' .. 12 = 'A'. Suits 0=C 1=D 2=H 3=S.
// Seats clockwise: 0 = South, 1 = West, 2 = North, 3 = East.
// Teams: seat & 1 -> team 0 = North/South, team 1 = East/West.

export const SPADE = 3;
export const FULL = 0x1fff;
export const SUIT_CH = ['♣', '♦', '♥', '♠'];
export const RANK_CH = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SEAT_NAME = ['South', 'West', 'North', 'East'];

export const suitOf = (c) => (c / 13) | 0;
export const rankOf = (c) => c % 13;
export const cardName = (c) => RANK_CH[rankOf(c)] + SUIT_CH[suitOf(c)];
export const hiBit = (m) => 31 - Math.clz32(m);
export const loBit = (m) => 31 - Math.clz32(m & -m);
export const popcnt = (m) => {
  m = m - ((m >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

// ---------------------------------------------------------------- rng
// mulberry32: integer-only PRNG. Noise independent of any deal.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { next, int: (n) => next() % n };
}
export function mix(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------- public state
// Int32Array layout (copy-on-play via slice()).
export const P_PLAYED = 0; // 0..3 played masks per suit (includes current trick)
export const P_TRICK = 4; // 4..7 current trick cards in play order
export const P_TLEN = 8;
export const P_LEADER = 9;
export const P_NTRICKS = 10;
export const P_WON = 11; // 11,12 tricks won per team
export const P_BROKEN = 13;
export const P_VOIDS = 14; // bit seat*4+suit
export const P_BID = 15; // 15..18 bids per seat
export const P_WINSEAT = 19;
export const P_WINCARD = 20;
export const P_LEN = 21;

export function newPublic(leader, bids) {
  const p = new Int32Array(P_LEN);
  p[P_LEADER] = leader;
  for (let s = 0; s < 4; s++) p[P_BID + s] = bids[s];
  p[P_WINSEAT] = -1;
  p[P_WINCARD] = -1;
  return p;
}
export const toMove = (p) => (p[P_LEADER] + p[P_TLEN]) & 3;
export const isOver = (p) => p[P_NTRICKS] === 13;
export const teamBid = (p, t) => p[P_BID + t] + p[P_BID + t + 2];
export const isVoid = (p, seat, suit) => (p[P_VOIDS] >>> (seat * 4 + suit)) & 1;
/** Cards seat still holds (count), from public info only. */
export function handCount(p, seat) {
  const pos = (seat - p[P_LEADER]) & 3;
  return 13 - p[P_NTRICKS] - (pos < p[P_TLEN] ? 1 : 0);
}
/** Played mask for suit s excluding the current trick's cards. */
export function priorMask(p, s) {
  let m = p[P_PLAYED + s];
  for (let i = 0; i < p[P_TLEN]; i++) {
    const c = p[P_TRICK + i];
    if (suitOf(c) === s) m &= ~(1 << rankOf(c));
  }
  return m;
}

/** Does card c beat the current winning card w (led suit = suit of first card)? */
function beats(c, w) {
  const sc = suitOf(c), sw = suitOf(w);
  if (sc === sw) return rankOf(c) > rankOf(w);
  return sc === SPADE;
}

/** Public state after the player to move plays card c. Pure. */
export function play(p, c) {
  const q = p.slice();
  applyPlay(q, c);
  return q;
}
/** In-place version of play() (rollouts). */
export function applyPlay(q, c) {
  const s = suitOf(c);
  const seat = (q[P_LEADER] + q[P_TLEN]) & 3;
  const tlen = q[P_TLEN];
  if (tlen > 0) {
    const led = suitOf(q[P_TRICK]);
    if (s !== led) q[P_VOIDS] |= 1 << (seat * 4 + led);
  } else if (s === SPADE && !q[P_BROKEN]) {
    q[P_VOIDS] |= 7 << (seat * 4); // led spades unbroken -> held only spades
  }
  if (s === SPADE) q[P_BROKEN] = 1;
  q[P_PLAYED + s] |= 1 << rankOf(c);
  q[P_TRICK + tlen] = c;
  if (tlen === 0 || beats(c, q[P_WINCARD])) {
    q[P_WINSEAT] = seat;
    q[P_WINCARD] = c;
  }
  if (tlen === 3) {
    q[P_WON + (q[P_WINSEAT] & 1)]++;
    q[P_NTRICKS]++;
    q[P_LEADER] = q[P_WINSEAT];
    q[P_TLEN] = 0;
    q[P_WINSEAT] = -1;
    q[P_WINCARD] = -1;
  } else q[P_TLEN] = tlen + 1;
}

// ---------------------------------------------------------------- hands & legality
// A hand is 4 suit masks; deals are Int32Array(16) at [seat*4 + suit] holding
// the cards each seat held when the deal was made/sampled. private() strips
// whatever has been played since.
export function privateHand(deal, seat, p) {
  const o = seat * 4;
  return [
    deal[o] & ~p[P_PLAYED],
    deal[o + 1] & ~p[P_PLAYED + 1],
    deal[o + 2] & ~p[P_PLAYED + 2],
    deal[o + 3] & ~p[P_PLAYED + 3],
  ];
}

/** Legal suit masks for hand h (4 masks) as [m0,m1,m2,m3]. */
export function legalMasks(h, p) {
  if (p[P_TLEN] > 0) {
    const led = suitOf(p[P_TRICK]);
    if (h[led]) {
      const r = [0, 0, 0, 0];
      r[led] = h[led];
      return r;
    }
    return [h[0], h[1], h[2], h[3]];
  }
  if (!p[P_BROKEN] && (h[0] | h[1] | h[2])) return [h[0], h[1], h[2], 0];
  return [h[0], h[1], h[2], h[3]];
}
export function legal(h, p) {
  const m = legalMasks(h, p);
  const out = [];
  for (let s = 0; s < 4; s++) {
    let x = m[s];
    while (x) {
      const r = loBit(x);
      x &= x - 1;
      out.push(s * 13 + r);
    }
  }
  return out;
}
/** Legal moves reduced by touching-card equivalence (lowest of each run, where
 *  cards between two held cards are gone in earlier tricks). Computed from the
 *  decider's hand and the public record only. */
export function options(h, p) {
  const m = legalMasks(h, p);
  const out = [];
  for (let s = 0; s < 4; s++) {
    const x = m[s];
    if (!x) continue;
    const gone = priorMask(p, s);
    let inRun = false;
    let runLow = -1;
    for (let r = 12; r >= 0; r--) {
      const bit = 1 << r;
      if (x & bit) {
        runLow = r;
        inRun = true;
      } else if (gone & bit) {
        // transparent: keeps the run going
      } else {
        if (inRun) out.push(s * 13 + runLow);
        inRun = false;
      }
    }
    if (inRun) out.push(s * 13 + runLow);
  }
  return out;
}

// ---------------------------------------------------------------- scoring
/** Hand score with the bag penalty amortized: a made contract scores 10*bid,
 *  each overtrick nets +1 - 10 = -9 (100 points per 10 bags, spread evenly);
 *  a set contract scores -10*bid. This is the objective every searcher here
 *  optimizes and the h2h measures. */
export const BAG_NET = 9;
export function handScore(bid, tricks) {
  return tricks >= bid ? 10 * bid - BAG_NET * (tricks - bid) : -10 * bid;
}
/** Zero-sum payoff from team 0's point of view once all 13 tricks are played. */
export function payoff(p) {
  const t0 = p[P_WON];
  return handScore(teamBid(p, 0), t0) - handScore(teamBid(p, 1), 13 - t0);
}
/** Best payoff team 0 / team 1 could still reach (bound for early exits). */
export function payoffRange(p) {
  const left = 13 - p[P_NTRICKS];
  const b0 = teamBid(p, 0), b1 = teamBid(p, 1);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k <= left; k++) {
    const t0 = p[P_WON] + k;
    const v = handScore(b0, t0) - handScore(b1, 13 - t0);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

// ---------------------------------------------------------------- deals
export function dealRandom(rng) {
  const cards = [];
  for (let c = 0; c < 52; c++) cards.push(c);
  for (let i = 51; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = cards[i];
    cards[i] = cards[j];
    cards[j] = t;
  }
  const d = new Int32Array(16);
  for (let i = 0; i < 52; i++) {
    const c = cards[i];
    const seat = (i / 13) | 0;
    d[seat * 4 + suitOf(c)] |= 1 << rankOf(c);
  }
  return d;
}

/** n deals consistent with what `seat` can see: its own hand h, the played
 *  cards, every seat's hand size, and revealed voids (failure to follow; a
 *  spade lead before spades broke reveals a spades-only hand). Bids are NOT
 *  used (no inference). Uniform by rejection; after 30 failed tries a
 *  constrained constructive deal (mildly non-uniform) is used. Each deal gets
 *  a deal-independent noise tag in deal.tag. */
export function sample(seat, h, p, n, rng) {
  const unknown = [];
  for (let s = 0; s < 4; s++) {
    let x = FULL & ~p[P_PLAYED + s] & ~h[s];
    while (x) {
      const r = loBit(x);
      x &= x - 1;
      unknown.push(s * 13 + r);
    }
  }
  const others = [(seat + 1) & 3, (seat + 2) & 3, (seat + 3) & 3];
  const cap = others.map((o) => handCount(p, o));
  const vmask = others.map((o) => (p[P_VOIDS] >>> (o * 4)) & 15);
  const anyVoid = vmask[0] | vmask[1] | vmask[2];
  const out = [];
  const u = unknown.slice();
  const N = u.length;
  for (let k = 0; k < n; k++) {
    let d = null;
    for (let tries = 0; tries < 30 && !d; tries++) {
      for (let i = N - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = u[i];
        u[i] = u[j];
        u[j] = t;
      }
      let ok = true;
      if (anyVoid) {
        let i = 0;
        for (let a = 0; a < 3 && ok; a++) {
          const vm = vmask[a];
          for (let e = i + cap[a]; i < e; i++) {
            if ((vm >>> suitOf(u[i])) & 1) {
              ok = false;
              break;
            }
          }
        }
      }
      if (ok) {
        d = new Int32Array(16);
        let i = 0;
        for (let a = 0; a < 3; a++) {
          const o = others[a] * 4;
          for (let e = i + cap[a]; i < e; i++) d[o + suitOf(u[i])] |= 1 << rankOf(u[i]);
        }
      }
    }
    if (!d) d = constructive(u, others, cap, vmask, rng);
    for (let s = 0; s < 4; s++) d[seat * 4 + s] = h[s];
    d.tag = rng.next();
    out.push(d);
  }
  return out;
}

function constructive(u, others, cap, vmask, rng) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const order = u.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    // most-constrained suits first
    const elig = (c) => {
      let k = 0;
      for (let a = 0; a < 3; a++) if (!((vmask[a] >>> suitOf(c)) & 1)) k++;
      return k;
    };
    order.sort((x, y) => elig(x) - elig(y));
    const left = cap.slice();
    const d = new Int32Array(16);
    let ok = true;
    for (const c of order) {
      const s = suitOf(c);
      let tot = 0;
      for (let a = 0; a < 3; a++) if (left[a] > 0 && !((vmask[a] >>> s) & 1)) tot += left[a];
      if (tot === 0) {
        ok = false;
        break;
      }
      let r = rng.int(tot);
      let a = 0;
      for (; a < 3; a++) {
        if (left[a] > 0 && !((vmask[a] >>> s) & 1)) {
          if (r < left[a]) break;
          r -= left[a];
        }
      }
      left[a]--;
      d[others[a] * 4 + s] |= 1 << rankOf(c);
    }
    if (ok) return d;
  }
  throw new Error('sample: no consistent deal');
}

// ---------------------------------------------------------------- bidding
/** Shared heuristic bidder (all seats, every searcher): honor tricks, long
 *  spades, ruffing values, counted in quarter-tricks. Nil disabled; 1..13. */
export function heuristicBid(h) {
  const len = h.map(popcnt);
  let q = 0;
  const A = 1 << 12, K = 1 << 11, Q = 1 << 10;
  for (let s = 0; s < 3; s++) {
    if (h[s] & A) q += 4;
    if (h[s] & K) q += len[s] >= 2 ? (len[s] <= 5 ? 3 : 2) : 1;
    if (h[s] & Q && len[s] >= 3 && len[s] <= 4) q += 1;
  }
  const sl = len[SPADE];
  if (h[SPADE] & A) q += 4;
  if (h[SPADE] & K) q += sl >= 2 ? 4 : 1;
  if (h[SPADE] & Q) q += sl >= 3 ? 3 : 1;
  if (sl >= 4) q += 4 * (sl - 3);
  // ruffing values for spades not already counted as length
  const spareTrumps = Math.min(sl, 3) - (h[SPADE] & (A | K | Q) ? 1 : 0);
  if (spareTrumps > 0) {
    let ruff = 0;
    for (let s = 0; s < 3; s++) {
      if (len[s] === 0) ruff += 4;
      else if (len[s] === 1) ruff += 2;
      else if (len[s] === 2) ruff += 1;
    }
    q += Math.min(ruff, spareTrumps * 3);
  }
  let b = (q + 2) >> 2;
  if (b < 1) b = 1;
  if (b > 13) b = 13;
  return b;
}

// ---------------------------------------------------------------- rule-based player
/** Standard spades heuristics; reads only its own hand and the public record.
 *  Wants tricks while its side still needs them or the opponents can still be
 *  set; otherwise ducks to avoid bags. Lead bosses, 2nd hand low, 3rd/4th hand
 *  win cheaply, don't overtake a partner who is winning securely, trump low,
 *  overtrump cheaply, discard low (or shed high cards when ducking). */
export function ruleMove(h, p, o = 0) {
  const seat = toMove(p);
  const tm = seat & 1;
  const need = teamBid(p, tm) - p[P_WON + tm];
  const oppNeed = teamBid(p, tm ^ 1) - p[P_WON + (tm ^ 1)];
  const want = need > 0 || oppNeed > 0;
  const tlen = p[P_TLEN];
  const out = (s) => FULL & ~p[P_PLAYED + s] & ~h[o + s]; // unseen, not mine
  if (tlen === 0) {
    const canSpade = p[P_BROKEN] || !(h[o + 0] | h[o + 1] | h[o + 2]);
    if (want) {
      for (let s = 0; s < 3; s++) {
        if (h[o + s] && (out(s) === 0 || hiBit(h[o + s]) > hiBit(out(s)))) return s * 13 + hiBit(h[o + s]);
      }
      if (canSpade && h[o + SPADE] && (out(SPADE) === 0 || hiBit(h[o + SPADE]) > hiBit(out(SPADE))))
        return 39 + hiBit(h[o + SPADE]);
      let best = -1, bl = 0;
      for (let s = 0; s < 3; s++) {
        const l = popcnt(h[o + s]);
        if (l > bl) {
          bl = l;
          best = s;
        }
      }
      if (best >= 0) return best * 13 + loBit(h[o + best]);
      return 39 + loBit(h[o + SPADE]);
    }
    let best = -1, br = 99;
    for (let s = 0; s < 3; s++) if (h[o + s] && loBit(h[o + s]) < br) { br = loBit(h[o + s]); best = s; }
    if (best >= 0) return best * 13 + br;
    return 39 + loBit(h[o + SPADE]);
  }
  const led = suitOf(p[P_TRICK]);
  const wc = p[P_WINCARD];
  const ws = suitOf(wc), wr = rankOf(wc);
  const partnerWin = (p[P_WINSEAT] & 1) === tm;
  const last = tlen === 3;
  // partner's winner is secure if nothing unseen can beat it in suit and no trump risk
  const secure = partnerWin && (last || (out(ws) >>> (wr + 1)) === 0);
  if (h[o + led]) {
    const m = h[o + led];
    if (!want) {
      if (ws === led) {
        const under = m & ((1 << wr) - 1);
        if (under) return led * 13 + hiBit(under);
        return led * 13 + (last ? hiBit(m) : loBit(m));
      }
      return led * 13 + hiBit(m); // trumped: everything loses, shed high
    }
    if (secure) return led * 13 + loBit(m);
    if (ws !== led) return led * 13 + loBit(m); // trumped
    const beat = m & ~((2 << wr) - 1);
    if (!beat) return led * 13 + loBit(m);
    if (tlen === 1) {
      // 2nd hand low unless holding the boss
      const top = hiBit(m);
      if ((out(led) >>> (top + 1)) === 0 && !partnerWin) return led * 13 + top;
      return led * 13 + loBit(m);
    }
    if (partnerWin) {
      // 3rd hand with partner winning insecurely: cover only with a boss
      const top = hiBit(m);
      if ((out(led) >>> (top + 1)) === 0 && top > wr) return led * 13 + top;
      return led * 13 + loBit(m);
    }
    return led * 13 + loBit(beat);
  }
  // void in led suit
  if (want && !partnerWin && h[o + SPADE]) {
    if (ws !== SPADE) return 39 + loBit(h[o + SPADE]);
    const over = h[o + SPADE] & ~((2 << wr) - 1);
    if (over) return 39 + loBit(over);
  }
  // discard
  if (!want) {
    let best = -1, br = -1;
    for (let s = 0; s < 3; s++) if (h[o + s] && hiBit(h[o + s]) > br) { br = hiBit(h[o + s]); best = s; }
    if (best >= 0) return best * 13 + br;
    if (ws === SPADE) {
      const under = h[o + SPADE] & ((1 << wr) - 1);
      if (under) return 39 + hiBit(under);
    }
    return 39 + loBit(h[o + SPADE]);
  }
  let best = -1, br = 99, bl = 99;
  for (let s = 0; s < 3; s++) {
    if (!h[o + s]) continue;
    const r = loBit(h[o + s]);
    const l = popcnt(h[o + s]);
    if (r < br || (r === br && l < bl)) {
      br = r;
      bl = l;
      best = s;
    }
  }
  if (best >= 0) return best * 13 + br;
  return 39 + loBit(h[o + SPADE]);
}

/** Uniform random legal card (noise from rng). */
export function randomMove(h, p, rng) {
  const l = legal(h, p);
  return l[rng.int(l.length)];
}

// ---------------------------------------------------------------- whole-hand driver
/** Play one hand. players[seat](hand, public, deal-free info) -> card.
 *  Returns {pub, plays}. Bids are produced by bidFn(seat, hand). */
export function playHand(deal, dealer, players, bidFn = (s, h) => heuristicBid(h)) {
  const bids = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) bids[s] = bidFn(s, privateHand(deal, s, newPublic(0, bids)));
  let p = newPublic((dealer + 1) & 3, bids);
  const plays = [];
  while (!isOver(p)) {
    const seat = toMove(p);
    const h = privateHand(deal, seat, p);
    const c = players[seat](h, p, seat);
    if (!legal(h, p).includes(c)) throw new Error(`illegal ${cardName(c)} by ${seat}`);
    plays.push(c);
    p = play(p, c);
  }
  return { pub: p, plays, bids };
}

/** Finish the hand from public state p in world d with every seat playing
 *  ruleMove (or uniform random when rng is given); returns the integer payoff. */
const RQ = new Int32Array(P_LEN);
const RH = new Int32Array(16);
export function rollout(d, p, rng = null) {
  const q = RQ;
  q.set(p);
  for (let i = 0; i < 16; i++) RH[i] = d[i] & ~q[P_PLAYED + (i & 3)];
  while (q[P_NTRICKS] < 13) {
    const seat = (q[P_LEADER] + q[P_TLEN]) & 3;
    const o = seat * 4;
    let c;
    if (rng) {
      const l = legal([RH[o], RH[o + 1], RH[o + 2], RH[o + 3]], q);
      c = l[rng.int(l.length)];
    } else c = ruleMove(RH, q, o);
    RH[o + suitOf(c)] &= ~(1 << rankOf(c));
    applyPlay(q, c);
  }
  return payoff(q);
}
