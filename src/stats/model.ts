import type { GameState, Seat } from '../engine';
import { decodeReplay } from '../engine/replay-code';
import type { HandRecord } from '../history/legacy';
import { recordedPlayerLabel, type PlayerIdentity } from '../ai/players';

export interface StatsPlayer { seat: Seat; name: string }
export interface SavedHand { id: string; record: HandRecord; players: StatsPlayer[]; remote?: boolean }
export interface StatsHand extends SavedHand { game: GameState; retry: boolean }
export type Metric = 'all' | 'made' | 'set' | 'nello' | 'unfinished' | 'retries';
const modelKey = (m: PlayerIdentity) => `${m.id}@${m.version}:${m.implementation}`;
const modelLabels = (models: readonly PlayerIdentity[]) => [...new Map(models.map(m => [modelKey(m), `${m.name} · ${m.version}`])).values()];
/** Describe saved identities; never substitute the currently installed player version. */
export function handModelLabel(record: HandRecord): string {
  const models = [...(record.models ?? []), ...(record.playerEvents ?? []).filter(e => e.handNumber === record.handNumber).map(e => e.model)];
  return modelLabels(models).join(' + ') || (record.player === 'demo' ? 'Sample choices · no computer model' : recordedPlayerLabel(record.player));
}
export function replaySeatLabel(hand: SavedHand, seat: Seat): string {
  const human = hand.players.find(p => p.seat === seat)?.name;
  const models = modelLabels((hand.record.playerEvents ?? []).filter(e => e.handNumber === hand.record.handNumber && e.seat === seat).map(e => e.model));
  return [human, ...models].filter(Boolean).join(' / ') || (hand.record.player === 'demo' ? 'Sample player' : 'Recorded player · model not recorded');
}
export const metricNames: Record<Metric, string> = { all: 'First attempts', made: 'Bids made', set: 'Bids set',
  nello: 'Nel-O hands', unfinished: 'Unfinished', retries: 'Retries' };
export function readHands(values: SavedHand[]): { hands: StatsHand[]; skipped: number } {
  const hands: StatsHand[] = [];
  let skipped = 0;
  for (const value of values) {
    const game = decodeReplay(value.record.code);
    if (!game) { skipped++; continue; }
    hands.push({ ...value, game, retry: /-r\d+$/.test(value.record.gameId) });
  }
  return { hands: hands.sort((a, b) => b.record.endedAt.localeCompare(a.record.endedAt) || a.id.localeCompare(b.id)), skipped };
}
export function matchesMetric(hand: StatsHand, metric: Metric): boolean {
  if (metric === 'retries') return hand.retry;
  if (hand.retry) return false;
  const g = hand.game, result = g.handResult;
  switch (metric) {
    case 'all': return true;
    case 'made': return !!result && result.team === result.declarer % 2;
    case 'set': return !!result && result.team !== result.declarer % 2;
    case 'nello': return g.declaration?.type === 'nello';
    case 'unfinished': return g.phase !== 'hand-over' && g.phase !== 'game-over';
  }
}
export function sameDeal(a: StatsHand, b: StatsHand): boolean {
  // Includes the rules preset, shaker and every dealt tile, not just a seed.
  return a.record.code.split('.')[0] === b.record.code.split('.')[0];
}
export function sameContract(a: StatsHand, b: StatsHand): boolean {
  return !!a.game.contract && !!b.game.contract && JSON.stringify(a.game.contract) === JSON.stringify(b.game.contract)
    && JSON.stringify(a.game.declaration) === JSON.stringify(b.game.declaration)
    && a.record.code.slice(0, 3) === b.record.code.slice(0, 3);
}
