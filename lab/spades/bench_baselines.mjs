// Baseline ms/move benchmark: node lab/spades/bench_baselines.mjs '[{"kind":"flat","n":64},{"n":24,"depthTricks":1,"exactTricks":5}]'
import * as E from '../../public/lab/spades/engine.js';
import { pimcPlayer, flatMcPlayer } from './baselines.js';
const cfgs = JSON.parse(process.argv[2]);
for (const cfg of cfgs) {
  const t0 = Date.now(); let moves=0, mx=0; const stats={nodes:0}; const byTrick = new Array(13).fill(0);
  for (let i = 0; i < 2; i++) {
    const d = E.dealRandom(E.makeRng(100+i));
    const rule = (h, p) => E.ruleMove(h, p);
    const P = cfg.kind==='flat' ? flatMcPlayer(cfg, 5) : pimcPlayer(cfg, 5, stats);
    const w = (h, p, seat) => { const s=Date.now(); const c = P(h,p,seat); moves++; const dt=Date.now()-s; byTrick[p[E.P_NTRICKS]]+=dt; mx=Math.max(mx,dt); return c; };
    E.playHand(d, 0, [w, rule, w, rule]);
  }
  console.log(JSON.stringify(cfg), 'ms/move', ((Date.now()-t0)/moves).toFixed(1), 'max', mx, 'nodes/move', (stats.nodes/moves)|0, 'byTrick', byTrick.join(' '));
}
