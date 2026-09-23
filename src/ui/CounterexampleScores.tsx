import type { NativeDecision, NativeRequest } from '../ai/native';
import { requestTile } from '../ai/native';
import { counterexampleStats } from '../ai/decision-stats';
import { Domino } from './Domino';

export function CounterexampleScores({ response, request, legal }: {
  response: NativeDecision; request: NativeRequest; legal: number[];
}) {
  const review = response.counterexample_result;
  if (!review) return null;
  const stats = counterexampleStats(response, request, legal);
  if (!stats) return <p class="setting-hint">The counterexample pass did not finish a complete round. Walt kept its ordinary choice.</p>;
  return <section aria-label="Counterexample stress scores">
    <h4>Counterexample stress scores</h4>
    <p class="setting-hint">{review.ordinary_worlds} ordinary deals + {review.witnesses} retained escape deals · {review.rounds} rounds.
      {' '}These counts are a stress test, not your chance of setting Nel-O.</p>
    <table class="counterexample-scores"><thead><tr><th>Lead / play</th><th>Sets in this bundle</th><th>Choice</th></tr></thead>
      <tbody>{stats.options.map(row => <tr key={row.tile}>
        <td><Domino id={requestTile(row.tile)} orientation="h" className="exp-dom" /></td>
        <td>{row.successes}/{stats.worlds}</td><td>{row.tile === review.choice ? 'Selected' : ''}</td>
      </tr>)}</tbody>
    </table>
    <p class="setting-hint">{review.choice === review.baseline ? 'Kept' : 'Changed'} the ordinary choice
      {review.choice !== review.baseline && ` from ${requestTile(review.baseline).split('').join('–')} to ${requestTile(review.choice).split('').join('–')}`}.
      {review.stop === 'deadline' && ' Time ran out; the last complete round was kept.'}</p>
  </section>;
}
