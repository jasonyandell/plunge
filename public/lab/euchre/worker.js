// AI worker: receives only the deciding seat's private holding and the public
// record (never the deal), returns Walt's action.
import { makeWalt } from './walt.js';

const walts = new Map();
self.onmessage = (ev) => {
  const { id, seat, priv, pub, seed, cfg } = ev.data;
  const key = JSON.stringify(cfg);
  let w = walts.get(key);
  if (!w) { w = makeWalt(cfg); walts.set(key, w); }
  const t0 = performance.now();
  const action = w.act(seat, priv, pub, seed);
  self.postMessage({ id, action, ms: Math.round(performance.now() - t0) });
};
