// Walt runs here so the page never freezes. The message carries only what
// the deciding seat may read: its own hand, the public record, the cards it
// passed (pins), and a noise seed.
import { Rng } from './engine.js';
import { waltMove } from './walt.js';

self.onmessage = (e) => {
  const { id, seat, hand, pub, pins, settings, seed } = e.data;
  const t0 = performance.now();
  const card = waltMove(seat, hand, pub, new Rng(seed), settings, pins ? Int32Array.from(pins) : null);
  self.postMessage({ id, card, ms: Math.round(performance.now() - t0) });
};
