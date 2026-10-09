// Duplicate head-to-head for Skat's play phase. Same engine modules as the browser page.
// Each deal is played twice: A declares vs two B defenders, then B declares vs two A
// defenders. Per-deal score for A = [A-declarer made] - [B-declarer made]  (in {-1,0,1}).
//
// usage: node lab/skat/h2h.mjs --a walt --b pimc --from 0 --to 100 --seed 1 \
//          --decl rotate --out lab/skat/results/walt-vs-pimc.jsonl
//        node lab/skat/h2h.mjs --summary lab/skat/results/walt-vs-pimc.jsonl
// agents: walt[:json cfg], pimc[:n], rule, random
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as S from '../../public/lab/skat/skat.js';
import { decide, DEFAULTS } from '../../public/lab/skat/walt.js';
import { pimcDecide } from '../../public/lab/skat/pimc.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, arr) => {
  if (x.startsWith('--')) acc.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

export function makeAgent(spec) {
  const [kind, rest] = spec.includes(':') ? [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)] : [spec, ''];
  if (kind === 'walt') {
    const cfg = { ...DEFAULTS, ...(rest ? JSON.parse(rest) : {}) };
    return { name: 'walt' + JSON.stringify(cfg), move: (seat, priv, pub, rng) => decide(seat, priv, pub, cfg.level, rng, cfg) };
  }
  if (kind === 'pimc') {
    const n = rest ? +rest : 20;
    return { name: `pimc(n=${n})`, move: (seat, priv, pub, rng) => pimcDecide(seat, priv, pub, rng, n) };
  }
  if (kind === 'rule') return { name: 'rule', move: (seat, priv, pub) => S.ruleMove(priv.hand, pub) };
  if (kind === 'random') return { name: 'random', move: (seat, priv, pub, rng) => S.randomMove(priv.hand, pub, rng) };
  throw new Error('unknown agent ' + spec);
}

/** play one table; agents[seat]; returns { made, declPts } and per-agent timing. */
export function playTable(setup, agents, seedBase, timing) {
  const { deal, g, decl } = setup;
  let pub = S.initialPublic(g, decl);
  while (pub.nPlayed < 30) {
    const seat = pub.turn;
    const priv = S.privateOf(deal, seat, pub);
    const rng = S.makeRng(S.hash32(seedBase, pub.nPlayed, seat) | 0);
    const t0 = performance.now();
    const c = agents[seat].move(seat, priv, pub, rng);
    const dt = performance.now() - t0;
    const L = S.legalMask(priv.hand, pub);
    if (!((L >> c) & 1)) throw new Error('illegal move');
    if (timing) { const k = agents[seat].name; const t = timing[k] || (timing[k] = { ms: 0, moves: 0, max: 0 }); t.ms += dt; t.moves++; t.max = Math.max(t.max, dt); }
    pub = S.play(pub, c);
  }
  const total = pub.declPts + deal.sp;
  return { made: total >= 61 ? 1 : 0, declPts: total };
}

export function setupFor(seed, mode) {
  if (mode === 'strongest') return S.setupDeal(seed);
  // 'rotate': declarer is the seat seed mod 3 (forced to play its best game), which gives
  // far more contested deals than "strongest hand declares" (≈85% made by rule bots).
  const rng = S.makeRng(seed);
  const { hands, skat } = S.dealCards(rng);
  const decl = ((seed % 3) + 3) % 3;
  const { g, discard } = S.chooseGameAndDiscard(hands[decl] | skat);
  const h = hands.slice(); h[decl] = (hands[decl] | skat) & ~discard;
  return { seed, decl, g, deal: { h, skat: discard, sp: S.pointsOf(discard) } };
}

function summarize(file) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const n = rows.length;
  let sum = 0, sq = 0; const cat = { both: 0, neither: 0, aOnly: 0, bOnly: 0 };
  let aMade = 0, bMade = 0;
  const timing = {};
  for (const r of rows) {
    const d = r.aDecl.made - r.bDecl.made; sum += d; sq += d * d;
    aMade += r.aDecl.made; bMade += r.bDecl.made;
    if (r.aDecl.made && r.bDecl.made) cat.both++; else if (!r.aDecl.made && !r.bDecl.made) cat.neither++;
    else if (r.aDecl.made) cat.aOnly++; else cat.bOnly++;
    for (const [k, t] of Object.entries(r.timing)) { const T = timing[k] || (timing[k] = { ms: 0, moves: 0, max: 0 }); T.ms += t.ms; T.moves += t.moves; T.max = Math.max(T.max, t.max); }
  }
  // reporting statistics only (not search values)
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, (sq - n * mean * mean) / (n - 1)));
  const half = 1.96 * sd / Math.sqrt(n);
  console.log(`${file}\n  A=${rows[0].a}\n  B=${rows[0].b}\n  deals=${n}  A-declarer made ${aMade}/${n}  B-declarer made ${bMade}/${n}`);
  console.log(`  per-deal (A made - B made): both=${cat.both} neither=${cat.neither} A-only=${cat.aOnly} B-only=${cat.bOnly}`);
  console.log(`  mean diff = ${mean.toFixed(3)}  95% CI [${(mean - half).toFixed(3)}, ${(mean + half).toFixed(3)}]  (sign test: ${cat.aOnly} vs ${cat.bOnly})`);
  for (const [k, t] of Object.entries(timing)) console.log(`  ${k}: ${(t.ms / t.moves).toFixed(1)} ms/move avg, max ${t.max.toFixed(0)} ms, ${t.moves} moves`);
}

if (args.summary) {
  summarize(args.summary);
} else if (args.a) {
  const A = makeAgent(args.a), B = makeAgent(args.b);
  const from = +(args.from || 0), to = +(args.to || 10), seed0 = +(args.seed || 1);
  const mode = args.decl || 'rotate';
  const out = args.out;
  if (out) mkdirSync(dirname(out), { recursive: true });
  for (let i = from; i < to; i++) {
    const seed = seed0 * 100003 + i;
    const setup = setupFor(seed, mode);
    const timing = {};
    const tA = setup.decl; // A declares
    const agents1 = [0, 1, 2].map((s) => (s === tA ? A : B));
    const agents2 = [0, 1, 2].map((s) => (s === tA ? B : A));
    const r1 = playTable(setup, agents1, S.hash32(seed, 1), timing);
    const r2 = playTable(setup, agents2, S.hash32(seed, 2), timing);
    const row = { i, seed, g: setup.g, decl: setup.decl, a: A.name, b: B.name, aDecl: r1, bDecl: r2, timing };
    if (out) appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(`deal ${i} g=${S.GAME_NAMES[setup.g]} A-decl ${r1.made}(${r1.declPts}) B-decl ${r2.made}(${r2.declPts})`);
  }
}
