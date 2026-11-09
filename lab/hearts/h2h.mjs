// Duplicate head-to-head for Hearts (4 seats, no partnerships).
//
//   node h2h.mjs --a walt:n=48,n0=6,h=4,r=rule --b rule --mode 1v3 --deals 100 --seed 1
//
// Players: walt[:n=,n0=,h=,r=rule|random,level=]  rule  random
//          mc[:n=] (flat Monte Carlo, random playouts)  mcr[:n=] (MC, rule-bot rollouts)
//
// mode 1v3: per deal, one all-B game gives B's score in every seat; then for
//   each seat s, A replaces B in seat s (same deal, same three B opponents).
//   delta(deal) = mean over seats of [B score − A score] in that seat.
// mode 3v1: per deal, one all-A game gives A's score in every seat; then for
//   each seat s, B replaces A in seat s among three A's.
//   delta(deal) = mean over seats of [B score − A score].
// Positive delta = A takes fewer points than B would in the same chair.
// Hand scores include shoot-the-moon. The unit for the 95% interval is the deal.
import * as E from '../../public/lab/hearts/engine.js';
import { ruleMove, mcMove, rulePass } from '../../public/lab/hearts/bots.js';
import { waltMove, DEFAULTS } from '../../public/lab/hearts/walt.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, x, i, a) => (x.startsWith('--') ? [...acc, [x.slice(2), a[i + 1]]] : acc), []),
);
const A = args.a || 'walt', B = args.b || 'rule';
const MODE = args.mode || '1v3';
const NDEALS = +(args.deals || 20), SEED = +(args.seed || 1), FIRST = +(args.first || 0);
const PASS = args.pass === '1';

function parseSpec(spec) {
  const [kind, rest] = spec.split(':');
  const kv = Object.fromEntries((rest ? rest.split(',') : []).map((x) => x.split('=')));
  if (kind === 'walt') {
    return {
      kind, level: +(kv.level || DEFAULTS.level), n: +(kv.n || DEFAULTS.n), n0: +(kv.n0 || DEFAULTS.n0),
      horizon: +(kv.h || DEFAULTS.horizon), rollout: kv.r || DEFAULTS.rollout,
    };
  }
  return { kind, n: +(kv.n || 60) };
}
const SPECS = { [A]: parseSpec(A), [B]: parseSpec(B) };
const timing = {};
function mover(name) {
  const sp = SPECS[name], kind = sp.kind;
  return (seat, hand, pub, rng, pins) => {
    const t0 = process.hrtime.bigint();
    let c;
    if (kind === 'walt') c = waltMove(seat, hand, pub, rng, sp, pins);
    else if (kind === 'rule') c = ruleMove(hand, 0, pub);
    else if (kind === 'random') c = E.randomLegal(hand, 0, pub, rng);
    else if (kind === 'mc') c = mcMove(seat, hand, pub, rng, sp.n, 'random', pins);
    else if (kind === 'mcr') c = mcMove(seat, hand, pub, rng, sp.n, 'rule', pins);
    else throw new Error('unknown player ' + kind);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    const t = (timing[name] ||= { moves: 0, ms: 0, max: 0 });
    t.moves++; t.ms += dt; t.max = Math.max(t.max, dt);
    return c;
  };
}

// Passing (optional): every seat passes by the rule heuristic (a fixed
// function of its own hand), direction rotates left/right/across by deal.
function applyPass(deal, dir) {
  const off = [1, 3, 2][dir];
  const pins = Array.from({ length: 4 }, () => new Int32Array(16));
  const out = deal.slice();
  const passes = [0, 1, 2, 3].map((s) => rulePass(deal.subarray(s * 4, s * 4 + 4)));
  for (let s = 0; s < 4; s++) for (const c of passes[s]) out[s * 4 + ((c / 13) | 0)] &= ~(1 << c % 13);
  for (let s = 0; s < 4; s++) {
    const to = (s + off) & 3;
    for (const c of passes[s]) {
      out[to * 4 + ((c / 13) | 0)] |= 1 << c % 13;
      pins[s][to * 4 + ((c / 13) | 0)] |= 1 << c % 13;
    }
  }
  return { deal: out, pins };
}

function playHand(deal, kinds, seedBase, pins) {
  const movers = kinds.map(mover);
  let pub = E.newPublic(E.seatOf2C(deal));
  while (!E.isDone(pub)) {
    const seat = pub[E.TOMOVE];
    const hand = E.privateHand(deal, seat, pub);
    const rng = new E.Rng(E.mixSeed(seedBase, seat, pub[E.NPLAYED]));
    const c = movers[seat](seat, hand, pub, rng, pins ? pins[seat] : null);
    pub = E.play(pub, c);
  }
  return [0, 1, 2, 3].map((s) => E.payoff(pub, s));
}

const deltas = [];
let moons = 0;
const t0 = Date.now();
for (let k = FIRST; k < FIRST + NDEALS; k++) {
  let deal = E.randomDeal(new E.Rng(E.mixSeed(SEED, k)));
  let pins = null;
  if (PASS) ({ deal, pins } = applyPass(deal, k % 3));
  const seedBase = E.mixSeed(SEED, k, 99);
  const base = MODE === '1v3' ? B : A, solo = MODE === '1v3' ? A : B;
  const all = playHand(deal, [base, base, base, base], seedBase, pins);
  if (all.includes(26)) moons++;
  let d = 0;
  const per = [];
  for (let s = 0; s < 4; s++) {
    const kinds = [base, base, base, base];
    kinds[s] = solo;
    const r = playHand(deal, kinds, seedBase, pins);
    if (r.includes(26)) moons++;
    const aScore = MODE === '1v3' ? r[s] : all[s];
    const bScore = MODE === '1v3' ? all[s] : r[s];
    per.push(`${bScore}-${aScore}`);
    d += bScore - aScore;
  }
  deltas.push(d / 4);
  if (args.verbose) console.log(`deal ${k}: B-A per seat ${per.join(' ')}  delta ${d / 4}`);
}
const n = deltas.length;
const mean = deltas.reduce((a, b) => a + b, 0) / n;
const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
const half = (1.96 * sd) / Math.sqrt(n);
const better = deltas.filter((x) => x > 0).length, worse = deltas.filter((x) => x < 0).length;
const tA = timing[A];
console.log(`${A} vs ${B} ${MODE}${PASS ? ' pass' : ''} seed=${SEED} deals=${n}: B-A = ${mean.toFixed(3)} [${(mean - half).toFixed(3)}, ${(mean + half).toFixed(3)}]  A better/worse/tied ${better}/${worse}/${n - better - worse}  moons ${moons}  ${tA ? 'A ms/move ' + (tA.ms / tA.moves).toFixed(1) + ' max ' + tA.max.toFixed(0) : ''}  wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (args.json) console.log(JSON.stringify({
  A, B, mode: MODE, pass: PASS, deals: n, seed: SEED, first: FIRST,
  specs: SPECS,
  meanDelta_BminusA_pointsPerHand: +mean.toFixed(3), ci95: [+(mean - half).toFixed(3), +(mean + half).toFixed(3)],
  dealsAbetter: better, dealsAworse: worse, dealsTied: n - better - worse, moonHands: moons,
  sumDelta4: deltas.reduce((a, b) => a + b * 4, 0),
  timing: Object.fromEntries(Object.entries(timing).map(([k, t]) => [k, { moves: t.moves, msPerMove: +(t.ms / t.moves).toFixed(2), maxMs: +t.max.toFixed(1) }])),
  wallSec: (Date.now() - t0) / 1000,
}));
