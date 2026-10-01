// Euchre engine: rules, public state, deals, legal moves, lawful sampler.
// Shared verbatim by the browser page (worker) and the Node h2h harness.
//
// Cards 0..23: suit = c / 6 | 0, rank = c % 6 (0=9, 1=10, 2=J, 3=Q, 4=K, 5=A).
// Suits 0=clubs 1=diamonds 2=spades 3=hearts, so the same-colour suit is s ^ 2.
// Seats 0=South 1=West 2=North 3=East (clockwise); team = seat & 1
// (team 0 = South/North). All values are integers; payoffs are team-0 points.

export const SUIT_SYM = ['♣', '♦', '♠', '♥'];
export const SUIT_NAME = ['Clubs', 'Diamonds', 'Spades', 'Hearts'];
export const RANK_SYM = ['9', '10', 'J', 'Q', 'K', 'A'];
export const SEAT_NAME = ['South', 'West', 'North', 'East'];

export const BID1 = 0, DISCARD = 1, BID2 = 2, PLAY = 3, DONE = 4;
export const ALL = (1 << 24) - 1;
export const HAND_MASK = ALL;

export const suitOf = (c) => (c / 6) | 0;
export const rankOf = (c) => c % 6;
export const bit = (c) => 1 << c;
export const cardName = (c) => RANK_SYM[rankOf(c)] + SUIT_SYM[suitOf(c)];

export function popcount(m) {
  m = m - ((m >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function lowBit(m) { return 31 - Math.clz32(m & -m); }
export function cardsOf(m) {
  const out = [];
  while (m) { const c = lowBit(m); out.push(c); m &= m - 1; }
  return out;
}

// ---- trump tables --------------------------------------------------------
// EFF[t][c]: effective suit of c when t is trump (t = 4 means no trump yet).
// POW[t][c]: trump power (0 if not trump): right 20, left 19, A 17, K 16, Q 15, 10 13, 9 12.
// SUITMASK[t][s]: cards whose effective suit is s.
export const EFF = [], POW = [], SUITMASK = [];
for (let t = 0; t <= 4; t++) {
  const eff = new Int8Array(24), pow = new Int8Array(24), sm = [0, 0, 0, 0];
  for (let c = 0; c < 24; c++) {
    let s = suitOf(c);
    const r = rankOf(c);
    if (t < 4) {
      if (r === 2 && s === t) pow[c] = 20;
      else if (r === 2 && s === (t ^ 2)) { s = t; pow[c] = 19; }
      else if (s === t) pow[c] = 12 + r;
    }
    eff[c] = s;
    sm[s] |= 1 << c;
  }
  EFF.push(eff); POW.push(pow); SUITMASK.push(sm);
}

// Strength of card c in a trick led with effective suit `led` under trump t.
export function trickPower(c, t, led) {
  const p = POW[t][c];
  if (p) return p;
  return EFF[t][c] === led ? rankOf(c) + 1 : 0;
}

// Ascending "cheapness" order key under trump t (used for option order /
// tie-breaking: cheaper cards first).
export function cardKey(c, t) {
  if (t < 4 && POW[t][c]) return 100 + POW[t][c];
  return rankOf(c) * 4 + suitOf(c);
}

// ---- public state --------------------------------------------------------
// Fields: dealer, up, phase, turn, passes, trump (4 = none), maker (-1),
// picked (1 if the dealer picked up the up card), played (mask), leader,
// tc (current trick cards, 5 bits each as card+1, in play order), tl (trick len),
// t0/t1 (tricks won by team 0/1), trick (number of completed tricks),
// voids (bit seat*4+suit: seat revealed void in effective suit).
export function newPublic(dealer, up) {
  return {
    dealer, up, phase: BID1, turn: (dealer + 1) & 3, passes: 0, trump: 4, maker: -1,
    picked: 0, played: 0, leader: (dealer + 1) & 3, tc: 0, tl: 0, t0: 0, t1: 0, trick: 0, voids: 0,
  };
}

function clone(p) {
  return {
    dealer: p.dealer, up: p.up, phase: p.phase, turn: p.turn, passes: p.passes, trump: p.trump,
    maker: p.maker, picked: p.picked, played: p.played, leader: p.leader, tc: p.tc, tl: p.tl,
    t0: p.t0, t1: p.t1, trick: p.trick, voids: p.voids,
  };
}

export const trickCard = (p, i) => ((p.tc >>> (5 * i)) & 31) - 1;

export function toMove(p) { return p.turn; }
export function isHidden(p) { return p.phase === DISCARD; }
export function maximizes(seat) { return (seat & 1) === 0; }

// Maker payoff (maker's own points; negative = euchred) for final maker tricks.
const MAKER_PAY = [-2, -2, -2, 1, 1, 2];

// [lo, hi] team-0 payoff still reachable from public state p (public only).
export function bounds(p) {
  if (p.phase === DONE && p.maker < 0) return [0, 0];
  if (p.phase !== PLAY && p.phase !== DONE) return [-2, 2];
  const mk = (p.maker & 1) === 0 ? p.t0 : p.t1;
  const rem = 5 - p.t0 - p.t1;
  const lo = MAKER_PAY[mk], hi = MAKER_PAY[mk + rem];
  return (p.maker & 1) === 0 ? [lo, hi] : [-hi, -lo];
}

// Integer team-0 payoff once it is fixed (play may still continue), else null.
export function outcome(p) {
  if (p.phase === DONE) {
    if (p.maker < 0) return 0; // passed out: redeal, no points
  } else if (p.phase !== PLAY) return null;
  const [lo, hi] = bounds(p);
  return lo === hi ? lo : null;
}

// Hand sizes now (cards still held), by seat, from public information only.
export function handSize(p, seat) {
  if (p.phase === BID1 || p.phase === BID2) return 5;
  if (p.phase === DISCARD) return seat === p.dealer ? 6 : 5;
  let n = 5 - p.trick;
  const off = (seat - p.leader) & 3;
  if (off < p.tl) n -= 1;
  return n;
}

// private(deal, seat, public): cards held now (low 24 bits); the dealer's
// private holding also carries its own discard as (x+1) << 24.
// deal = [h0, h1, h2, h3, kitty(3 buried), x(discard or -1)]; hands are the
// holdings net of pickup/discard; played cards are masked out here.
export function privateOf(deal, seat, p) {
  let m = deal[seat] & ~p.played;
  if (seat === p.dealer) {
    if (p.phase === DISCARD) m |= 1 << p.up;
    if (deal[5] >= 0) m |= (deal[5] + 1) << 24;
  }
  return m;
}

export function legal(priv, p) {
  const hand = priv & HAND_MASK;
  switch (p.phase) {
    case BID1: return [0, 1];
    case DISCARD: return ordered(hand, p.trump);
    case BID2: {
      const out = [0];
      for (let s = 0; s < 4; s++) if (s !== suitOf(p.up)) out.push(1 + s);
      return out;
    }
    case PLAY: {
      if (p.tl === 0) return ordered(hand, p.trump);
      const led = EFF[p.trump][trickCard(p, 0)];
      const follow = hand & SUITMASK[p.trump][led];
      return ordered(follow || hand, p.trump);
    }
    default: return [];
  }
}

// Uniform random legal action (same distribution as choice(legal(...))).
export function randomLegal(priv, p, rng) {
  let m = priv & HAND_MASK;
  switch (p.phase) {
    case BID1: return randBelow(rng, 2);
    case BID2: { const r = randBelow(rng, 4); if (r === 0) return 0; const s = r - 1; return 1 + (s >= suitOf(p.up) ? s + 1 : s); }
    case PLAY:
      if (p.tl > 0) { const f = m & SUITMASK[p.trump][EFF[p.trump][trickCard(p, 0)]]; if (f) m = f; }
    // fallthrough
    case DISCARD: {
      let k = randBelow(rng, popcount(m));
      while (k-- > 0) m &= m - 1;
      return lowBit(m);
    }
    default: throw new Error('randomLegal');
  }
}

// ORDER[t]: all cards in ascending cheapness under trump t.
export const ORDER = [];
for (let t = 0; t <= 4; t++) ORDER.push([...Array(24).keys()].sort((a, b) => cardKey(a, t) - cardKey(b, t)));
function ordered(m, t) {
  const out = [];
  for (const c of ORDER[t]) if ((m >>> c) & 1) out.push(c);
  return out;
}

// play(public, action) -> new public. For the hidden discard the action is
// ignored (the public record only learns that the dealer discarded).
export function play(p, a) {
  const q = clone(p);
  switch (p.phase) {
    case BID1:
      if (a === 1) {
        q.trump = suitOf(p.up); q.maker = p.turn; q.picked = 1;
        q.phase = DISCARD; q.turn = p.dealer;
      } else {
        q.passes = p.passes + 1; q.turn = (p.turn + 1) & 3;
        if (q.passes === 4) { q.phase = BID2; q.passes = 0; q.turn = (p.dealer + 1) & 3; }
      }
      return q;
    case DISCARD:
      q.phase = PLAY; q.turn = q.leader = (p.dealer + 1) & 3;
      return q;
    case BID2:
      if (a > 0) {
        q.trump = a - 1; q.maker = p.turn; q.phase = PLAY;
        q.turn = q.leader = (p.dealer + 1) & 3;
      } else {
        q.passes = p.passes + 1; q.turn = (p.turn + 1) & 3;
        if (q.passes === 4) q.phase = DONE; // passed out
      }
      return q;
    case PLAY: {
      const t = p.trump;
      q.played = p.played | (1 << a);
      if (p.tl > 0) {
        const led = EFF[t][trickCard(p, 0)];
        if (EFF[t][a] !== led) q.voids = p.voids | (1 << (p.turn * 4 + led));
      }
      q.tc = p.tc | ((a + 1) << (5 * p.tl));
      q.tl = p.tl + 1;
      if (q.tl < 4) { q.turn = (p.turn + 1) & 3; return q; }
      // trick complete
      const led = EFF[t][trickCard(q, 0)];
      let best = -1, win = 0;
      for (let i = 0; i < 4; i++) {
        const pw = trickPower(trickCard(q, i), t, led);
        if (pw > best) { best = pw; win = i; }
      }
      const w = (p.leader + win) & 3;
      if (w & 1) q.t1 = p.t1 + 1; else q.t0 = p.t0 + 1;
      q.trick = p.trick + 1; q.leader = w; q.turn = w; q.tc = 0; q.tl = 0;
      if (q.trick === 5) q.phase = DONE;
      return q;
    }
    default:
      throw new Error('play in finished state');
  }
}

// Winner seat of the (complete) trick given leader and 4 cards.
export function trickWinner(leader, cards, t) {
  const led = EFF[t][cards[0]];
  let best = -1, win = 0;
  for (let i = 0; i < 4; i++) {
    const pw = trickPower(cards[i], t, led);
    if (pw > best) { best = pw; win = i; }
  }
  return (leader + win) & 3;
}

// Apply the dealer's hidden discard of card a to a deal (returns a new deal).
export function applyHidden(deal, p, a) {
  const d = deal.slice();
  d[p.dealer] = (deal[p.dealer] | (1 << p.up)) & ~(1 << a);
  d[5] = a;
  return d;
}

// ---- random numbers (uint32 stream; no floats) ----------------------------
export function rngFrom(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
export function hash32(...xs) {
  let h = 0x811c9dc5 | 0;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
// Uniform integer in [0, n) for n <= 2^53 (exact rejection sampling).
const TWO53 = 9007199254740992;
export function randBelow(rng, n) {
  if (n <= 0x100000000) {
    const lim = 0x100000000 - (0x100000000 % n);
    for (;;) { const u = rng(); if (u < lim) return u % n; }
  }
  const lim = TWO53 - (TWO53 % n);
  for (;;) {
    const u = (rng() & 0x1fffff) * 0x100000000 + rng();
    if (u < lim) return u % n;
  }
}
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randBelow(rng, i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
export const choice = (arr, rng) => arr[randBelow(rng, arr.length)];

export function publicKey(p) {
  return hash32(p.phase, p.turn, p.passes, p.trump, p.played, p.tc, p.leader, p.trick, p.dealer, p.up);
}

// ---- dealing ---------------------------------------------------------------
export function randomDeal(rng) {
  const cards = shuffle([...Array(24).keys()], rng);
  const d = [0, 0, 0, 0, 0, -1];
  for (let s = 0; s < 4; s++) for (let i = 0; i < 5; i++) d[s] |= 1 << cards[s * 5 + i];
  for (let i = 20; i < 23; i++) d[4] |= 1 << cards[i];
  return { deal: d, up: cards[23] };
}

// ---- lawful sampler --------------------------------------------------------
// sample(seat, priv, p, n, rng): n deals uniform over the hidden histories
// consistent with what `seat` can see: its own holding (and, for the dealer,
// its own discard), the public record (up card, plays, hand sizes, revealed
// voids). The dealer's hidden discard is treated like the deal itself: every
// history (original deal, discard) consistent with the record is equally
// likely. So for a non-dealer after a pickup, the unplayed up card lies in the
// dealer's hand or is the discard slot `x`, and the discard slot is a distinct
// 1-card slot (not merged with the 3 buried cards). Exact uniform via a
// counting DP over (card class x slot) tables; integer weights < 2^53.
export const SAMPLER = { maxTries: 64 }; // test hook: 0 forces the exact DP
const FACT = [1];
for (let i = 1; i <= 24; i++) FACT.push(FACT[i - 1] * i);

export function sample(seat, priv, p, n, rng) {
  const hand = priv & HAND_MASK;
  const myX = (priv >>> 24) - 1; // own discard if I am the dealer and discarded
  const t = p.trump;
  const upBit = 1 << p.up;
  // Slots: other seats, then kitty (3 buried), then optional x slot.
  const slotSeat = [], caps = [];
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    let c = handSize(p, s);
    if (p.phase === DISCARD && s === p.dealer) c = 5; // up card placed separately
    slotSeat.push(s); caps.push(c);
  }
  const kitSlot = caps.length; caps.push(3);
  let unknown = ALL & ~hand & ~p.played;
  let upClass = false;
  let xSlot = -1;
  const afterDiscard = p.picked && p.phase !== DISCARD;
  if (p.phase === BID1 || p.phase === DISCARD || !p.picked) {
    unknown &= ~upBit; // on the table, picked up publicly, or turned down
  }
  if (afterDiscard) {
    if (seat === p.dealer) unknown &= ~(1 << myX);
    else {
      xSlot = caps.length; caps.push(1);
      if (unknown & upBit) { upClass = true; unknown &= ~upBit; }
    }
  }
  const nslot = caps.length;
  const dj = slotSeat.indexOf(p.dealer);
  function base() {
    const d = [0, 0, 0, 0, 0, -1];
    d[seat] = hand & ~(p.phase === DISCARD && seat === p.dealer ? upBit : 0);
    if (seat === p.dealer && myX >= 0) d[5] = myX;
    return d;
  }
  function fill(d, cs, cv) {
    let ci = 0;
    for (let j = 0; j < nslot; j++) {
      for (let x = 0; x < cv[j]; x++) {
        const c = cs[ci++];
        if (j < slotSeat.length) d[slotSeat[j]] |= 1 << c;
        else if (j === kitSlot) d[4] |= 1 << c;
        else d[5] = c;
      }
    }
    return d;
  }
  // Proposal: uniform over histories ignoring revealed voids. The up card (if
  // its place is unknown) goes to the dealer or the discard slot with weight
  // equal to those slots' capacities (cd : 1), then the rest are dealt.
  const pool = cardsOf(unknown);
  function propose() {
    const d = base();
    const cs = shuffle(pool.slice(), rng);
    if (!upClass) return fill(d, cs, caps);
    const cv = caps.slice();
    if (randBelow(rng, caps[dj] + 1) < caps[dj]) { cv[dj]--; fill(d, cs, cv); d[p.dealer] |= upBit; }
    else { cv[xSlot]--; fill(d, cs, cv); d[5] = p.up; }
    return d;
  }
  const vm = [0, 0, 0, 0];
  let anyV = false;
  if (p.phase === PLAY && p.voids) {
    for (const s of slotSeat) {
      for (let su = 0; su < 4; su++) if ((p.voids >>> (s * 4 + su)) & 1) vm[s] |= SUITMASK[t][su];
      if (vm[s]) anyV = true;
    }
  }
  const out = [];
  if (!anyV) { for (let i = 0; i < n; i++) out.push(propose()); return out; }
  // Rejection against revealed voids (exactly uniform on acceptance); after 64
  // straight rejections switch to the exact counting DP (also uniform), so the
  // mixture stays exactly uniform.
  let i = 0;
  for (; i < n; i++) {
    let ok = false;
    for (let tries = 0; tries < SAMPLER.maxTries; tries++) {
      const d = propose();
      if ((d[slotSeat[0]] & vm[slotSeat[0]]) || (d[slotSeat[1]] & vm[slotSeat[1]]) || (d[slotSeat[2]] & vm[slotSeat[2]])) continue;
      out.push(d); ok = true; break;
    }
    if (!ok) break;
  }
  if (i === n) return out;
  // Exact DP fallback. Classes: effective suits, plus the up card.
  const classes = [], allow = [];
  for (let s = 0; s < 4; s++) {
    const cs = unknown & SUITMASK[t][s];
    if (!cs) continue;
    let a = 0;
    for (let j = 0; j < nslot; j++) {
      if (j < slotSeat.length && (p.voids >>> (slotSeat[j] * 4 + s)) & 1) continue;
      a |= 1 << j;
    }
    classes.push(cardsOf(cs)); allow.push(a);
  }
  if (upClass) {
    let a = 1 << xSlot;
    if (!((p.voids >>> (p.dealer * 4 + EFF[t][p.up])) & 1)) a |= 1 << dj;
    classes.push([p.up]); allow.push(a);
  }
  const K = classes.length;
  const sizes = classes.map((c) => c.length);
  const plan = makePlan(sizes, allow, caps);
  if (!plan.total) throw new Error('sampler: no consistent deal');
  for (; i < n; i++) {
    const d = base();
    let cv = caps.slice();
    for (let k = 0; k < K; k++) {
      const { opts, ws, sum } = plan.entry(k, cv);
      let r = randBelow(rng, sum);
      let pick = 0;
      while (r >= ws[pick]) { r -= ws[pick]; pick++; }
      const tv = opts[pick];
      const cs = shuffle(classes[k].slice(), rng);
      let ci = 0;
      for (let j = 0; j < nslot; j++) {
        for (let x = 0; x < tv[j]; x++) {
          const c = cs[ci++];
          if (j < slotSeat.length) d[slotSeat[j]] |= 1 << c;
          else if (j === kitSlot) d[4] |= 1 << c;
          else d[5] = c;
        }
        cv[j] -= tv[j];
      }
    }
    out.push(d);
  }
  return out;
}

// Exact counting tables for (class sizes, allowed slots, capacities).
function makePlan(sizes, allow, caps) {
  const K = sizes.length, nslot = caps.length;
  const memo = new Map(), ememo = new Map();
  const enc = (k, cv) => { let e = k; for (let j = 0; j < nslot; j++) e = e * 8 + cv[j]; return e; };
  function dists(k, cv) {
    const nk = sizes[k], a = allow[k];
    const out = [];
    const tvec = new Array(nslot).fill(0);
    (function rec(j, left) {
      if (j === nslot) { if (left === 0) out.push(tvec.slice()); return; }
      const mx = ((a >>> j) & 1) ? Math.min(left, cv[j]) : 0;
      for (let x = 0; x <= mx; x++) { tvec[j] = x; rec(j + 1, left - x); }
      tvec[j] = 0;
    })(0, nk);
    return out;
  }
  function W(k, cv) {
    if (k === K) { for (let j = 0; j < nslot; j++) if (cv[j]) return 0; return 1; }
    const key = enc(k, cv);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const tot = entry(k, cv).sum;
    memo.set(key, tot);
    return tot;
  }
  // entry(k, cv): the distributions of class k over slots, with integer weights
  // multinomial * W(k+1, rest).
  function entry(k, cv) {
    const key = enc(k, cv);
    let ent = ememo.get(key);
    if (ent) return ent;
    const nk = sizes[k];
    const opts = [], ws = [];
    let sum = 0;
    for (const tv of dists(k, cv)) {
      let mult = FACT[nk];
      const nv = cv.slice();
      for (let j = 0; j < nslot; j++) { mult /= FACT[tv[j]]; nv[j] -= tv[j]; }
      const w = mult * W(k + 1, nv);
      if (w) { opts.push(tv); ws.push(w); sum += w; }
    }
    ent = { opts, ws, sum };
    ememo.set(key, ent);
    return ent;
  }
  return { entry, total: W(0, caps) };
}
