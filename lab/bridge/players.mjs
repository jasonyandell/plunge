// Players for the bridge h2h. Each `choose` receives only what its agent may
// see: `known` holds the visible seats' hands, every other seat is zeroed by
// the harness before the call. EXPLORATORY tier.
import {
  Rng, SUIT, RANK, legalCards, legalReduced, canon, ruleCard, sampleDeals, visibleSeats, toPBN,
} from '../../public/lab/bridge/engine.js';
import { waltDecide } from '../../public/lab/bridge/walt.js';

const handOf = (d, seat, pub) => { const h = new Uint16Array(4); for (let u = 0; u < 4; u++) h[u] = d[seat * 4 + u] & ~pub.played[u]; return h; };

export function waltPlayer(cfg) {
  const tag = (c) => `n${c.n},n0${c.n0}${c.l0Tail ? ',tail' + c.l0Tail : ''}${c.draws > 1 ? ',d' + c.draws : ''}`;
  const name = `walt(L${cfg.level ?? 1},n${cfg.n},n0${cfg.n0},h${cfg.horizon}${cfg.margin === false ? ',nomargin' : ''}${cfg.rollout ? ',dice' : ''}${cfg.tape ? ',tape' : ''}${cfg.k ? ',k' + cfg.k : ''}${cfg.kFrom ? ',kf' + cfg.kFrom : ''}${cfg.selfs === 'mind' ? ',selfmind' : ''}${cfg.l0 === 'flat' ? ',flat' : cfg.l0 === 'scorer' ? ',scorer' : ''}${cfg.l0Tail ? ',tail' + cfg.l0Tail : ''}${cfg.draws > 1 ? ',d' + cfg.draws : ''}${cfg.vector ? ',vec' : ''}${cfg.refine ? ',ref(' + tag({ ...cfg, ...cfg.refine }) + ')' : ''}${cfg.field ? ',field' : ''}${cfg.ruleOrder === false ? ',noruleorder' : ''})`;
  // field: persistent mind cache across this player's decisions (cleared when
  // the record restarts, i.e. a new table). Separate map for the refine pass,
  // whose settings make it a different pure function.
  const f1 = cfg.field ? new Map() : null;
  const f2 = cfg.field && cfg.refine ? new Map() : null;
  let lastN = Infinity;
  return { name, kind: 'walt', last: null,
    choose(pub, agent, known, seed) {
      if (f1 && pub.n <= lastN) { f1.clear(); if (f2) f2.clear(); }
      lastN = pub.n;
      const c = { ...cfg, seed };
      if (f1) c.fieldMap = f1;
      if (f2) c.refine = { ...cfg.refine, fieldMap: f2 };
      const r = waltDecide(pub, agent, known, c);
      this.last = r;
      return r.card;
    } };
}

export function rulePlayer() {
  return { name: 'rule', kind: 'rule',
    choose(pub, agent, known) {
      const seat = pub.toMove();
      const ph = agent === pub.decl ? handOf(known, (seat + 2) & 3, pub) : null;
      return ruleCard(pub, seat, handOf(known, seat, pub), ph);
    } };
}

export function randomPlayer() {
  return { name: 'random', kind: 'random',
    choose(pub, agent, known, seed) {
      const all = legalCards(handOf(known, pub.toMove(), pub), pub);
      return all[new Rng(seed).int(all.length)];
    } };
}

/** PIMC: sample W worlds from the agent's chair, solve each double dummy (DDS),
 *  pick the card that makes (declarer) / defeats (defence) the contract in the
 *  most worlds; ties by total DD declarer tricks, then the rule bot's card. */
export function pimcPlayer(dds, W) {
  return { name: `pimc(W${W})`, kind: 'pimc',
    async choose(pub, agent, known, seed) {
      const seat = pub.toMove();
      const h = handOf(known, seat, pub);
      const opts = legalReduced(h, pub);
      if (opts.length === 1) return opts[0];
      const ph = agent === pub.decl ? handOf(known, (seat + 2) & 3, pub) : null;
      const rc = canon(ruleCard(pub, seat, h, ph), h, pub);
      const k = opts.indexOf(rc);
      if (k > 0) { opts.splice(k, 1); opts.unshift(rc); }
      const worlds = sampleDeals(pub, visibleSeats(agent, pub), known, W, new Rng(seed));
      const trick = [];
      for (let i = 0; i < pub.tl; i++) trick.push(pub.tc[i]);
      const pbns = worlds.map((w) => {
        const d = new Uint16Array(16);
        for (let i = 0; i < 16; i++) d[i] = w[i] & ~pub.played[i & 3];
        for (let i = 0; i < pub.tl; i++) { const s = (pub.leader + i) & 3, c = pub.tc[i]; d[s * 4 + SUIT[c]] |= 1 << RANK[c]; }
        return toPBN(d);
      });
      const res = await dds.call({ op: 'solve', trump: pub.strain, leader: pub.leader, trick, pbns });
      const rem = 13 - pub.declTricks - pub.defTricks;
      const moverDecl = pub.isDeclSide(seat);
      const makes = new Map(), tricks = new Map();
      for (const a of opts) { makes.set(a, 0); tricks.set(a, 0); }
      for (const per of res) {
        const seen = new Set();
        for (const [c, t] of per) {
          const a = canon(c, h, pub);
          if (seen.has(a) || !makes.has(a)) continue;
          seen.add(a);
          const declTot = pub.declTricks + (moverDecl ? t : rem - t);
          if (declTot >= pub.target) makes.set(a, makes.get(a) + 1);
          tricks.set(a, tricks.get(a) + declTot);
        }
      }
      let best = opts[0];
      const key = (a) => makes.get(a) * 100000 + tricks.get(a);
      for (const a of opts) if (moverDecl ? key(a) > key(best) : key(a) < key(best)) best = a;
      return best;
    } };
}
