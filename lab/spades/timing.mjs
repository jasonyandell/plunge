import * as E from '../../public/lab/spades/engine.js';
import { waltMove } from '../../public/lab/spades/walt.js';
const cfgs = JSON.parse(process.argv[2]);
const deals = +(process.argv[3]||2);
for (const cfg of cfgs) {
  const t0 = Date.now(); let moves=0, ro=0, mx=0;
  for (let i = 0; i < deals; i++) {
    const d = E.dealRandom(E.makeRng(100+i));
    const rule = (h, p) => E.ruleMove(h, p);
    const w = (h, p, seat) => { const s=Date.now(); const r = waltMove(seat, h, p, cfg, E.mix(i, p[E.P_NTRICKS]*4+p[E.P_TLEN])); moves++; ro+=r.rollouts; mx=Math.max(mx,Date.now()-s); return r.card; };
    E.playHand(d, 0, [w, rule, w, rule]);
  }
  const ms = Date.now()-t0;
  console.log(JSON.stringify(cfg), 'ms/move', (ms/moves).toFixed(1), 'max', mx, 'rollouts/move', (ro/moves)|0);
}
