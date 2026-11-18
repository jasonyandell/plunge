/** On-demand advice: the same own/public boundary as live play, without a move. */
import { effectivePlayer, type PlayerId } from './players';
import { zebEstimate } from './zeb';
import { legalDominoes, type GameState } from '../engine';
import { api, requestKey, requestOf, type NativeEstimate, type NativeRequest, type AnalysisWorlds } from './native';
import { decisionStats, type MoveStats } from './native-analysis';
import { tileOfId } from './walt/requests';

export interface Hint {
  request: NativeRequest;
  requestedWorlds: AnalysisWorlds;
  choice: number | null;
  forced: boolean;
  stats: MoveStats | null;
  estimate: NativeEstimate | null;
}

export async function getHint(g: GameState, sessionId: string, worlds: AnalysisWorlds, signal?: AbortSignal, player: PlayerId = 'native-partner'): Promise<Hint> {
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (g.phase !== 'playing' || g.turn !== 0) throw new Error('Hints are for your turn.');
  const request = requestOf(g, 0, sessionId);
  const legal = legalDominoes(g).map(tileOfId);
  if (legal.length === 1) return { request, requestedWorlds: worlds, choice: legal[0]!, forced: true, stats: null, estimate: null };
  const estimate = effectivePlayer(player, g) === 'zeb' ? await zebEstimate(g, sessionId, worlds, signal) : await api<NativeEstimate>('estimates', { request, worlds }, worlds > 40 ? 24000 : 18000, signal);
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (estimate.schema !== 'plunge-estimate-v1' || requestKey(estimate.identity.request) !== requestKey(request)
    || estimate.identity.player.n !== worlds) throw new Error('The hint does not match this position.');
  const response = estimate.response;
  if (request.contract && (response.contract !== request.contract || response.inactive !== g.sittingOut)) throw new Error('The hint returned a different contract.');
  if (!legal.includes(response.choice) || response.leader !== g.leader
    || JSON.stringify(response.points) !== JSON.stringify(g.points)) throw new Error('The hint disagrees with the table.');
  const stats = decisionStats(response, request, legal);
  // A legal emergency fallback is not a measured recommendation.
  if (!stats) return { request, requestedWorlds: worlds, choice: null, forced: false, stats: null, estimate };
  if (!stats.options.some(a => a.tile === response.choice && a.best)) throw new Error('The hint disagrees with its scores.');
  return { request, requestedWorlds: worlds, choice: response.choice, forced: false, stats, estimate };
}

/** Explain only measured comparisons, never invent a strategic motive. */
export function hintExplanation(hint: Hint): string {
  if (hint.forced) return 'This is your only legal play.';
  const stats = hint.stats, chosen = stats?.options.find(a => a.tile === hint.choice);
  if (!stats || !chosen) return 'No complete comparison finished. Try again when you’re ready.';
  if (stats.sampleBudget) return `This play has the highest weighted estimate of ${stats.objective === 'make' ? 'making' : 'setting'} the ${hint.request.bid} bid: ${(chosen.chance * 100).toFixed(1)}%. Zeb used a budget of ${stats.worlds} sampled deals. This is a prediction, not a count of completed games.`;
  const result = chosen.successes === null ? `${(chosen.chance * 100).toFixed(1)}% of the sampled deals`
    : `${chosen.successes} of ${stats.worlds} sampled deals`;
  const team = stats.objective === 'make' ? 'Your team made' : 'Your team set';
  const tied = stats.options.filter(a => a.best).length;
  const contract = hint.request.contract === 'nello' ? 'Nel-O contract' : `${hint.request.bid} bid`;
  return `${team} the ${contract} in ${result} when the simulation started with this play. `
    + (tied > 1 ? `${tied} plays tied for the highest estimate.` : 'It had the highest estimate in this comparison.');
}
