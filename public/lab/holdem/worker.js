// Walt runs here so the page never freezes.
import { Rng } from './cards.js';
import { game } from './game.js';
import { decide } from './walt.js';

self.onmessage = (e) => {
  const { id, seat, hole, board, pub, level, cfg, seed } = e.data;
  const t0 = performance.now();
  const r = decide(game, seat, { seat, hole, board }, pub, level, new Rng(seed), cfg);
  self.postMessage({ id, action: r.action, options: r.options, values: r.values, n: r.n, minds: r.stats ? r.stats.minds : 0, ms: Math.round(performance.now() - t0) });
};
