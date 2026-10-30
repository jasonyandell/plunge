// Walt runs here so the page never freezes. Protocol:
//   in  {id, ct:{decl,strain,level}, plays:[card...], agent, known:[16 masks], cfg}
//   out {id, card, values:[[card,count,of]...], ms, stats} or {id, error}
// `known` carries only the hands the agent may see (the page zeroes the rest).
import { pubFrom, waltDecide } from './walt.js';

self.onmessage = (e) => {
  const { id, ct, plays, agent, known, cfg } = e.data;
  try {
    const t0 = performance.now();
    const pub = pubFrom(ct, plays);
    const r = waltDecide(pub, agent, Uint16Array.from(known), cfg);
    self.postMessage({ id, card: r.card, values: r.values, stats: r.stats, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
