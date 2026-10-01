// Leduc hold'em as a Walt game, to measure exactly how exploitable Walt's pure
// one-action-per-information-set policy is (exploitability computed by
// OpenSpiel in leduc_exploit.py). Rules = OpenSpiel leduc_poker: 6 cards
// (J J Q Q K K; card id / 2 = rank), ante 1, bets 2 then 4, at most 2 raises
// per round, player 0 acts first each round; pair with the board wins, else
// higher card, else split. Walt plays from the same generic walt.js.
// Usage: node leduc.mjs <level> <seed> <reps>   -> JSON policy on stdout
import { Rng } from '../../public/lab/holdem/cards.js';
import { decide } from '../../public/lab/holdem/walt.js';

const BET = [2, 4];
const initial = () => ({ round: 0, c0: 1, c1: 1, raises: 0, acted: 0, actor: 0, folded: -1, done: false, fresh: false, h: ['', ''] });
const legal = (p) => {
  const facing = p.actor === 0 ? p.c1 > p.c0 : p.c0 > p.c1;
  if (facing) return p.raises < 2 ? [0, 1, 2] : [0, 1];
  return [1, 2];
};
function play(p, a) {
  const s = p.actor, o = 1 - s;
  const h = [p.h[0], p.h[1]];
  h[p.round] += String(a);
  if (a === 0) return { ...p, h, folded: s, done: true, fresh: false, actor: o };
  let { c0, c1, raises, acted } = p;
  const theirs = s === 0 ? c1 : c0;
  const next = a === 1 ? theirs : theirs + BET[p.round];
  if (a === 2) raises++;
  if (s === 0) c0 = next; else c1 = next;
  acted++;
  if (a === 1 && acted >= 2 && c0 === c1) {
    if (p.round === 1) return { ...p, h, c0, c1, raises, acted, done: true, fresh: false, actor: -1 };
    return { round: 1, c0, c1, raises: 0, acted: 0, actor: 0, folded: -1, done: false, fresh: true, h };
  }
  return { ...p, h, c0, c1, raises, acted, actor: o, fresh: false };
}
const rank = (c) => c >> 1;
function sdSign(c) {
  const b = rank(c[2]), r0 = rank(c[0]), r1 = rank(c[1]);
  const p0 = r0 === b, p1 = r1 === b;
  if (p0 !== p1) return p0 ? 1 : -1;
  return r0 > r1 ? 1 : r0 < r1 ? -1 : 0;
}
const mk = (c) => ({ c, sd: sdSign(c) });
function payoff(p, seat, sd) {
  if (p.folded >= 0) { const lost = p.folded === 0 ? p.c0 : p.c1; return p.folded === seat ? -lost : lost; }
  const v = sd * p.c0; return seat === 0 ? v : -v;
}
export const leduc = {
  toMove: (p) => p.actor, isTerminal: (p) => p.done, legal, play, maximizes: () => true,
  privateOf: (d, seat, p) => ({ seat, card: d.c[seat], board: p.round ? d.c[2] : -1 }),
  boardKey: (d, round) => (round ? d.c[2] : 0),
  privKey: (d, seat, p) => d.c[seat] + ':' + (p.round ? d.c[2] : -1) + ':' + p.h.join('/'),
  // Every deal consistent with the seat's view, each repeated `n` times (the
  // repeats give the bottom rung's random choices room to average out).
  sample(seat, priv, p, n) {
    const out = [];
    for (let o = 0; o < 6; o++) for (let b = 0; b < 6; b++) {
      if (o === priv.card || b === priv.card || b === o) continue;
      if (priv.board >= 0 && b !== priv.board) continue;
      const c = new Int8Array(3); c[seat] = priv.card; c[1 - seat] = o; c[2] = b;
      for (let r = 0; r < n; r++) out.push(mk(c));
    }
    return out;
  },
  payoffSum(deals, me, p) { let s = 0; for (const d of deals) s += payoff(p, me, d.sd); return s; },
  rolloutSum(deals, me, p) { let s = 0; for (const d of deals) s += d.sd; return (me === 0 ? s : -s) * p.c0; },
};

// Walt's policy at every information set reachable in the game.
export function waltPolicy(level, seed, reps) {
  const cfg = { n: reps, n0: reps, horizon: 1, horizon0: 1, branch: 1, branch0: 1 };
  const pol = {};
  let k = 0;
  const walk = (c, p) => {
    if (p.done) return;
    const s = p.actor;
    const key = `${s}|${c[s]}|${p.round ? c[2] : '-'}|${p.h[0]}|${p.h[1]}`;
    if (!(key in pol)) {
      const r = decide(leduc, s, leduc.privateOf({ c }, s, p), p, level, new Rng(seed * 7919 + k++), cfg);
      pol[key] = r.action;
    }
    for (const a of legal(p)) walk(c, play(p, a));
  };
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let x = 0; x < 6; x++) {
    if (a === b || a === x || b === x) continue;
    walk(Int8Array.of(a, b, x), initial());
  }
  return pol;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [lvl, seed, reps] = process.argv.slice(2).map(Number);
  const t0 = Date.now();
  const pol = waltPolicy(lvl, seed, reps);
  process.stderr.write(`level ${lvl} seed ${seed} reps ${reps}: ${Object.keys(pol).length} infosets, ${Date.now() - t0} ms\n`);
  console.log(JSON.stringify(pol));
}
