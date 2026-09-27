/** Pure interpretation of a completed comparison, shared by browser and evidence validation. */
import type { NativeDecision, NativeRequest } from './native';

export interface MoveStats {
  worlds: number; fallback: boolean; objective: 'make' | 'set';
  options: { tile: number; chance: number; successes: number | null; best: boolean }[];
}

/** Never silently substitute an incomplete primary comparison for its fallback. */
export function decisionStats(response: NativeDecision, request: NativeRequest, legal: number[]): MoveStats | null {
  if (response.contract !== request.contract || (request.contract === 'nello' && response.inactive !== (request.bidder+2)%4)) return null;
  const fallback = response.route === 'l1-fallback';
  if (!fallback && !['baseline', 'baseline-reviewed', 'baseline-counterexamples'].includes(response.route)) return null;
  const phase = fallback ? 'fallback-l1' : 'baseline';
  if (!response.phases?.some((p) => p.name === phase && p.status === 'completed')) return null;
  const evaluation = fallback ? response.fallback_evaluation : response.evaluation;
  if (!evaluation || !Number.isSafeInteger(evaluation.outer_worlds) || evaluation.outer_worlds < 1) return null;
  return comparisonStats(evaluation, request, legal, fallback);
}

function comparisonStats(evaluation: NonNullable<NativeDecision['evaluation']>, request: NativeRequest, legal: number[], fallback = false): MoveStats | null {
  const rows = evaluation.options;
  if (!Array.isArray(rows) || rows.length !== legal.length || !rows.every((r) => Array.isArray(r) && r.length === 3)
    || new Set(rows.map((r) => r[0])).size !== legal.length) return null;
  const declaring = request.seat % 2 === request.bidder % 2;
  try {
    const fractions = rows.map(([tile, numerator, denominator]) => {
      if (!legal.includes(tile) || typeof numerator !== 'string' || typeof denominator !== 'string'
        || !/^\d{1,18}$/.test(numerator) || !/^\d{1,18}$/.test(denominator)) throw new Error('invalid option');
      const n = BigInt(numerator), d = BigInt(denominator);
      if (d <= 0n || n > d) throw new Error('invalid fraction');
      return { tile, n: declaring ? n : d - n, d };
    });
    fractions.sort((a,b) => a.n*b.d > b.n*a.d ? -1 : a.n*b.d < b.n*a.d ? 1 : a.tile-b.tile);
    const best = fractions[0];
    if (!best) return null;
    const worlds = evaluation.outer_worlds;
    return { worlds, fallback, objective: declaring ? 'make' : 'set', options: fractions.map(({ tile, n, d }) => ({
      tile, chance: Number(n)/Number(d), best: n*best.d === best.n*d,
      successes: n*BigInt(worlds)%d === 0n ? Number(n*BigInt(worlds)/d) : null,
    })) };
  } catch { return null; }
}

/** The selected witness mixture is deliberately biased; render as counts, not odds. */
export function counterexampleStats(response: NativeDecision, request: NativeRequest, legal: number[]): MoveStats | null {
  const r = response.counterexample_result;
  if (request.contract !== 'nello' || request.seat % 2 === request.bidder % 2
    || response.contract !== 'nello' || response.inactive !== (request.bidder + 2) % 4
    || r?.schema !== 'nello-counterexamples-v1' || r.status !== 'completed' || r.score_kind !== 'witness-mixture'
    || !Number.isSafeInteger(r.rounds) || r.rounds < 1 || r.rounds > 3
    || !Number.isSafeInteger(r.witnesses) || r.witnesses < 1 || r.witnesses > r.rounds * 4
    || !Number.isSafeInteger(r.ordinary_worlds) || r.ordinary_worlds < 1 || r.ordinary_worlds > 640
    || response.route !== 'baseline-counterexamples' || r.choice !== response.choice
    || !legal.includes(r.choice) || !legal.includes(r.baseline)) return null;
  const stats = comparisonStats({ options: r.options, outer_worlds: r.ordinary_worlds + r.witnesses }, request, legal);
  return stats?.options.every(row => row.successes !== null) ? stats : null;
}
