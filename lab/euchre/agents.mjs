// Agent factory shared by the h2h harness and the benchmark.
import { makeWalt } from '../../public/lab/euchre/walt.js';
import { makeRandom, makeRule, makePIMC } from '../../public/lab/euchre/bots.js';

// spec: "walt:level=1,n=24,n0=8" | "pimc:n=20" | "rule" | "random"
export function makeAgent(spec) {
  const [kind, rest] = spec.split(':');
  const opts = {};
  if (rest) for (const kv of rest.split(',')) { const [k, v] = kv.split('='); opts[k] = Number(v); }
  if (kind === 'walt') return makeWalt(opts);
  if (kind === 'pimc') return makePIMC(opts);
  if (kind === 'rule') return makeRule();
  if (kind === 'random') return makeRandom();
  throw new Error('unknown agent ' + spec);
}
