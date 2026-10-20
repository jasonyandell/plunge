// ms/move benchmark for Walt (Node): Walt plays all three seats on seeded deals.
// usage: node lab/skat/bench.mjs [cfgName=std|fast|<json>] [deals=10] [seed=7]
import * as S from '../../public/lab/skat/skat.js';
import { decide, DEFAULTS } from '../../public/lab/skat/walt.js';

const NAMED = {
  std: { level: 1, n: 32, n0: 6, horizon: [3, 6], endgame: 15, rollout: 'rule' },
  fast: { level: 1, n: 16, n0: 4, horizon: [3, 5], endgame: 12, rollout: 'rule' },
};
const arg = process.argv[2] || 'std';
const cfg = { ...DEFAULTS, ...(NAMED[arg] || JSON.parse(arg)) };
const N = +(process.argv[3] || 10), seed0 = +(process.argv[4] || 7);
const times = [];
const byTrick = Array.from({ length: 10 }, () => []);
for (let i = 0; i < N; i++) {
  const d = S.setupDeal(seed0 * 1000 + i);
  let pub = S.initialPublic(d.g, d.decl);
  while (pub.nPlayed < 30) {
    const seat = pub.turn;
    const priv = S.privateOf(d.deal, seat, pub);
    const rng = S.makeRng(S.hash32(seed0, i, pub.nPlayed));
    const t0 = performance.now();
    const c = decide(seat, priv, pub, cfg.level, rng, cfg);
    const dt = performance.now() - t0;
    times.push(dt); byTrick[Math.floor(pub.nPlayed / 3)].push(dt);
    pub = S.play(pub, c);
  }
}
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`cfg ${JSON.stringify(cfg)}  deals=${N} moves=${times.length}`);
console.log(`ms/move: mean ${avg(times).toFixed(1)}  median ${pct(times, 0.5).toFixed(1)}  p95 ${pct(times, 0.95).toFixed(0)}  p99 ${pct(times, 0.99).toFixed(0)}  max ${Math.max(...times).toFixed(0)}`);
console.log('by trick (mean / max ms): ' + byTrick.map((a, k) => `${k + 1}:${avg(a).toFixed(0)}/${Math.max(...a).toFixed(0)}`).join('  '));
