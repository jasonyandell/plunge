/**
 * Walt's post-hoc review of your plays: for each recorded hand, rebuild every
 * position you faced and ask the same on-device player the in-game hint uses.
 * Results land in the derived cache (versioned by profile) so history
 * re-scores itself whenever the analysis profile improves.
 *
 * This measures the play you made, never how you arrived at it — nothing here
 * knows whether a hint was ever opened, and nothing is recorded during play.
 */
import { legalDominoes } from '../engine';
import { decodeReplay } from '../engine/replay-code';
import { getHint } from '../ai/hint';
import { WALT_ID } from '../ai/walt-identity';
import { tileOfId } from '../ai/walt/requests';
import type { HandAnalysis, PlyVerdict } from './log';
import type { ScoredHand } from '../records/model';
import { handSteps } from './replay';

/**
 * The reviewer's identity: its settings plus the Walt build that runs them.
 * A new Walt build or a changed setting is a new profile, so cached hands
 * re-analyze on the next visit and verdicts from two builds never mix.
 */
export const ANALYSIS_PROFILE = `walt-l1-40w-v1:${WALT_ID}`;

export type HintFn = typeof getHint;

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * Review one hand. Throws on abort or a transient player failure (so the hand
 * retries next visit); returns `unsupported` for contracts out of Walt's scope.
 */
export async function analyzeHand(record: ScoredHand, signal?: AbortSignal, hint: HintFn = getHint): Promise<HandAnalysis> {
  const done = (plies: PlyVerdict[], unsupported: boolean): HandAnalysis =>
    ({ schema: 'plunge-hand-analysis-v1', id: record.id, profile: ANALYSIS_PROFILE, plies, unsupported });
  const g = decodeReplay(record.code);
  const steps = g && handSteps(g);
  if (!steps) return done([], true);
  const plies: PlyVerdict[] = [];
  let ply = -1;
  for (const { state, action } of steps) {
    if (action.type !== 'play') continue;
    ply++;
    if (state.turn !== 0) continue;
    const played = tileOfId(action.domino);
    if (legalDominoes(state).length === 1) {
      plies.push({ ply, played, suggested: played, forced: true, playedChance: null, bestChance: null, playedBest: true });
      continue;
    }
    let h;
    try {
      h = await hint(state, record.game.id, 40, signal);
    } catch (error) {
      if (isAbort(error) || !/straight 42/.test(String(error))) throw error;
      return done(plies, true); // out of Walt's scope — cache that verdict
    }
    // An unscored emergency fallback is honestly no verdict at all.
    if (!h.stats) continue;
    const options = h.stats.options;
    const playedOption = options.find((o) => o.tile === played);
    const bestChance = options.reduce((m, o) => Math.max(m, o.chance), 0);
    if (!playedOption) continue;
    plies.push({
      ply, played, suggested: h.choice, forced: false,
      playedChance: playedOption.chance, bestChance, playedBest: playedOption.best,
    });
  }
  return done(plies, false);
}

export interface ReviewProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * Review every hand missing a current-profile verdict, saving each as it
 * lands so an interrupted pass resumes where it stopped. Returns the new
 * analyses; stops quietly on abort.
 */
export async function reviewMissing(
  records: readonly ScoredHand[],
  existing: readonly HandAnalysis[],
  save: (a: HandAnalysis) => Promise<void>,
  onProgress: (p: ReviewProgress) => void,
  signal?: AbortSignal,
  hint: HintFn = getHint,
): Promise<HandAnalysis[]> {
  const have = new Set(existing.filter((a) => a.profile === ANALYSIS_PROFILE).map((a) => a.id));
  const queue = records.filter((r) => !have.has(r.id));
  const fresh: HandAnalysis[] = [];
  let done = 0;
  onProgress({ done, total: queue.length });
  for (const record of queue) {
    if (signal?.aborted) break;
    try {
      const analysis = await analyzeHand(record, signal, hint);
      await save(analysis);
      fresh.push(analysis);
    } catch (error) {
      if (isAbort(error)) break;
      throw error; // transient player failure — surface it, retry next visit
    }
    onProgress({ done: ++done, total: queue.length });
  }
  return fresh;
}
