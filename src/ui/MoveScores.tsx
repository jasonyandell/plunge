import type { MoveStats } from '../ai/native-analysis';
import { requestTile } from '../ai/native';
import { Domino } from './Domino';

export function MoveScores({ stats, selected, selectionLabel }: { stats: MoveStats; selected: number; selectionLabel: string }) {
  return <>
    <p class="estimate-label">Estimated chance to <strong>{stats.objective} the bid</strong></p>
    <div class="exp-rows">{stats.options.map(a => <div class={`exp-row${a.tile === selected ? ' exp-played' : ''}`} key={a.tile}>
      <Domino id={requestTile(a.tile)} orientation="h" className="exp-dom" />
      <span class="native-score"><strong>{(a.chance * 100).toFixed(1)}%</strong>
        {a.successes !== null && <small>{a.successes} / {stats.worlds}</small>}</span>
      <span>{[a.tile === selected ? selectionLabel : '', a.best ? 'Highest estimate' : ''].filter(Boolean).join(' · ')}</span>
    </div>)}</div>
    <details class="disclosure sample-details">
      <summary>Sample details</summary>
      <p>{stats.worlds} sampled worlds: possible deals based on this player’s own hand and the public plays.
        {stats.fallback ? ' A smaller fallback comparison was used.' : ''}
        {' '}The fractions show successful outcomes out of the deals compared.</p>
    </details>
  </>;
}
