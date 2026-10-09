// Collect exact pmake vectors from Walt self-play. EXPLORATORY tier.
//
// Walt plays all four seats (vector mode: every root candidate evaluated
// exactly — the output is the per-candidate make-count vector, not fail-soft
// bounds). One jsonl row per board: the contract, the full play sequence, and
// for every non-forced decision the pmake vector [card, makes, deals].
// Positions are reconstructible by replaying `plays` to `ply`.
//
//   node lab/bridge/collect.mjs --cfg '{"tape":true,...,"vector":true}' \
//     --from 0 --to 60 --out lab/bridge/results/pmake/selfplay.jsonl
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Pub, mix, visibleSeats, cardText, SUIT, RANK } from '../../public/lab/bridge/engine.js';
import { agentOf } from '../../public/lab/bridge/walt.js';
import { waltPlayer } from './players.mjs';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const cfg = JSON.parse(arg('cfg', '{"tape":true,"n":64,"n0":32,"horizon":52,"margin":false,"selfs":"mind","l0":"flat","l0Tail":28,"k":2,"field":true,"vector":true}'));
const from = Number(arg('from', 0)), to = Number(arg('to', 60));
const seed = Number(arg('seed', 1));
const out = arg('out', null);
const { deals } = JSON.parse(readFileSync(new URL(arg('deals', './deals-test.json'), import.meta.url), 'utf8'));

function parsePBN(pbn) {
  const d = new Uint16Array(16);
  const R = '23456789TJQKA';
  pbn.slice(2).split(' ').forEach((hand, s) => hand.split('.').forEach((cards, k) => {
    const u = 3 - k; for (const ch of cards) d[s * 4 + u] |= 1 << R.indexOf(ch);
  }));
  return d;
}

if (out) mkdirSync(dirname(out), { recursive: true });
for (let b = from; b < Math.min(to, deals.length); b++) {
  const D = deals[b];
  const deal = parsePBN(D.pbn);
  const P = waltPlayer(cfg);
  const pub = new Pub(D.decl, D.strain, D.level);
  const base = mix(seed, b);
  const plays = [], vectors = [];
  const t0 = performance.now();
  while (pub.outcome() < 0) {
    const seat = pub.toMove(), agent = agentOf(pub, seat);
    const vis = visibleSeats(agent, pub);
    const known = new Uint16Array(16);
    for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = deal[s * 4 + u];
    P.last = null;
    const c = P.choose(pub, agent, known, mix(base, pub.n));
    if (P.last && !P.last.forced) vectors.push({ ply: pub.n, seat, pick: c, v: P.last.values });
    if (!(deal[seat * 4 + SUIT[c]] & (1 << RANK[c]))) throw new Error('illegal card');
    plays.push(cardText(c));
    pub.apply(c);
  }
  const row = {
    board: b, contract: D.contract, dd: D.dd, decl: D.decl, strain: D.strain, level: D.level,
    seed, cfg: P.name, made: pub.outcome(), declTricks: pub.declTricks,
    plays: plays.join(' '), vectors,
  };
  console.log(`board ${b} ${D.contract}: ${row.made ? 'made' : 'down'}(${row.declTricks}) ${vectors.length} vectors ${(performance.now() - t0).toFixed(0)} ms`);
  if (out) appendFileSync(out, JSON.stringify(row) + '\n');
}
