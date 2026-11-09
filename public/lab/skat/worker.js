// Web Worker: runs Walt off the main thread. It receives only the deciding seat's own
// holding (hand + its discard if declarer) and the public record — never the deal.
import { decide } from './walt.js';
import { makeRng } from './skat.js';

self.onmessage = (e) => {
  const { id, seat, priv, pub, cfg, seed } = e.data;
  const t0 = performance.now();
  const card = decide(seat, priv, pub, cfg.level, makeRng(seed), cfg);
  self.postMessage({ id, card, ms: Math.round(performance.now() - t0) });
};
