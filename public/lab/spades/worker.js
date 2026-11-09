// Walt's Web Worker. In: {id, seat, hand:[4 suit masks], pub:Int32Array, cfg, seed}.
// Out: {id, card, ms, rollouts} or {id, error}. The worker sees only the
// deciding seat's own hand and the public record (the information rule).
import { waltMove } from './walt.js';

self.onmessage = (e) => {
  const { id, seat, hand, pub, cfg, seed } = e.data;
  try {
    const t = performance.now();
    const r = waltMove(seat, hand, Int32Array.from(pub), cfg, seed);
    self.postMessage({ id, card: r.card, rollouts: r.rollouts, ms: Math.round(performance.now() - t) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack ? err.stack : err) });
  }
};
