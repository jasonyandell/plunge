// Duplicate head-to-head for bridge card play. EXPLORATORY tier.
// Each board is played at several tables on the same deal and contract. Table "AB"
// means A declares (declarer + dummy) against B defending. The duplicate pair is
// AB + BA: per board, diff = made(AB) - made(BA) in {-1,0,1}; > 0 favours A.
// Play stops once the contract is decided (made or defeated). Decision noise seeds
// depend only on (--seed, board index, table), never on the cards.
//   DDS_PYTHON=<venv>/bin/python node lab/bridge/h2h.mjs --a walt --b pimc --from 0 --to 20 \
//     --walt '{"n":16,"n0":4,"horizon":8}' --W 20 --out lab/bridge/results/walt-pimc.jsonl
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Pub, mix, visibleSeats, cardText } from '../../public/lab/bridge/engine.js';
import { agentOf } from '../../public/lab/bridge/walt.js';
import { waltPlayer, rulePlayer, randomPlayer, pimcPlayer } from './players.mjs';
import { DDS } from './dds.mjs';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const dealsFile = arg('deals', new URL('./deals.json', import.meta.url).pathname);
const from = Number(arg('from', 0)), to = Number(arg('to', 10));
const seed = Number(arg('seed', 1));
const waltCfg = JSON.parse(arg('walt', '{"level":1,"n":16,"n0":4,"horizon":8,"rollout":0}'));
const W = Number(arg('W', 20));
const out = arg('out', null);
const { deals } = JSON.parse(readFileSync(dealsFile, 'utf8'));

let dds = null;
const make = (k) => {
  if (k === 'walt') return waltPlayer(waltCfg);
  if (k === 'walt2') return waltPlayer(JSON.parse(arg('walt2', '{}')));
  if (k === 'rule') return rulePlayer();
  if (k === 'random') return randomPlayer();
  if (k === 'pimc') { dds ??= new DDS(); return pimcPlayer(dds, W); }
  throw new Error('unknown player ' + k);
};
const A = make(arg('a', 'walt')), B = make(arg('b', 'pimc'));

function parsePBN(pbn) {
  const d = new Uint16Array(16);
  const R = '23456789TJQKA';
  pbn.slice(2).split(' ').forEach((hand, s) => hand.split('.').forEach((cards, k) => {
    const u = 3 - k; for (const ch of cards) d[s * 4 + u] |= 1 << R.indexOf(ch);
  }));
  return d;
}

async function playTable(deal, ct, declP, defP, base) {
  const pub = new Pub(ct.decl, ct.strain, ct.level);
  const times = { decl: [], def: [] };
  const record = [];
  while (pub.outcome() < 0) {
    const seat = pub.toMove(), agent = agentOf(pub, seat);
    const vis = visibleSeats(agent, pub);
    const known = new Uint16Array(16);
    for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = deal[s * 4 + u];
    const p = pub.isDeclSide(seat) ? declP : defP;
    const t0 = performance.now();
    const c = await p.choose(pub, agent, known, mix(base, pub.n));
    const dt = performance.now() - t0;
    (pub.isDeclSide(seat) ? times.decl : times.def).push(Math.round(dt));
    if (!(deal[seat * 4 + ((c / 13) | 0)] & (1 << (c % 13))) || pub.played[(c / 13) | 0] & (1 << (c % 13))) throw new Error('illegal card ' + c);
    record.push(cardText(c));
    pub.apply(c);
  }
  return { made: pub.outcome(), decl: pub.declTricks, def: pub.defTricks, plays: record.join(' '), times };
}

// --tables: which pairings to play per board, e.g. "AB,BA" (the duplicate pair; default),
// "AB,BA,BB,AA" (adds the same-player tables that split declarer play from defence).
const tables = arg('tables', 'AB,BA').split(',');
const P = { A, B };
if (out) mkdirSync(dirname(out), { recursive: true });
for (let b = from; b < Math.min(to, deals.length); b++) {
  const D = deals[b];
  const deal = parsePBN(D.pbn), ct = { decl: D.decl, strain: D.strain, level: D.level };
  const row = { board: b, contract: D.contract, dd: D.dd, a: A.name, b: B.name, seed, tables: {} };
  const line = [];
  for (const t of tables) {
    const r = await playTable(deal, ct, P[t[0]], P[t[1]], mix(mix(seed, b), t.charCodeAt(0) * 4 + t.charCodeAt(1)));
    row.tables[t] = r;
    line.push(`${t}:${r.made ? 'made' : 'down'}(${r.decl})`);
  }
  console.log(`board ${b} ${D.contract} dd=${D.dd} ${line.join(' ')}`);
  if (out) appendFileSync(out, JSON.stringify(row) + '\n');
}
if (dds) dds.close();
