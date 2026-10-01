import * as E from '../../public/lab/spades/engine.js';
import { waltMove } from '../../public/lab/spades/walt.js';
const rng = E.makeRng(7);
let tot = [0,0], made=[0,0], bidsum=0, tricks=0;
for (let i = 0; i < 2000; i++) {
  const d = E.dealRandom(rng);
  const rule = (h, p) => E.ruleMove(h, p);
  const r = E.playHand(d, i & 3, [rule, rule, rule, rule]);
  const p = r.pub;
  for (const t of [0,1]) { const b=E.teamBid(p,t), w=p[E.P_WON+t]; bidsum+=b; if (w>=b) made[t]++; }
  tot[0]+=E.payoff(p);
}
console.log('rule selfplay 2000: makes', made, 'avg team bid', bidsum/4000, 'mean payoff0', tot[0]/2000);
// random players
let mr=[0,0];
for (let i = 0; i < 2000; i++) {
  const d = E.dealRandom(rng);
  const rnd = (h, p) => E.randomMove(h, p, rng);
  const rule = (h, p) => E.ruleMove(h, p);
  const r = E.playHand(d, i & 3, [rule, rnd, rule, rnd]);
  for (const t of [0,1]) { const b=E.teamBid(r.pub,t), w=r.pub[E.P_WON+t]; if (w>=b) mr[t]++; }
}
console.log('rule NS vs random EW makes', mr);
// walt timing
for (const cfg of [{n:8,n0:2,horizon:4},{n:16,n0:3,horizon:4},{n:16,n0:3,horizon:6},{n:24,n0:4,horizon:4}]) {
  const t0 = Date.now(); let moves=0, ro=0, mx=0;
  for (let i = 0; i < 2; i++) {
    const d = E.dealRandom(E.makeRng(100+i));
    const rule = (h, p) => E.ruleMove(h, p);
    const w = (h, p, seat) => { const s=Date.now(); const r = waltMove(seat, h, p, cfg, E.mix(i, p[E.P_NTRICKS]*4+p[E.P_TLEN])); moves++; ro+=r.rollouts; mx=Math.max(mx,Date.now()-s); return r.card; };
    E.playHand(d, 0, [w, rule, w, rule]);
  }
  const ms = Date.now()-t0;
  console.log(JSON.stringify(cfg), 'ms/move', (ms/moves).toFixed(1), 'max', mx, 'rollouts/move', (ro/moves)|0);
}
