import { useState } from 'preact/hooks';
import { highBid, type GameState } from '../engine';
import { forecastAdvice, forecastRows } from '../ai/zeb/auction-advice';
import { waltDeclarationOf } from '../ai/walt/requests';
import type { ForecastHintEvidence } from '../questions/hint-evidence';
import { bidLabel, declLabel, SEAT_NAMES } from './store';
import { SaveHint } from './SaveHint';

const trumpName = (decl: number) => declLabel(waltDeclarationOf(decl)!);
const percent = (chance: number) => `${(100 * chance).toFixed(1)}%`;

/** The reason refers to the original recommendation, never to the explored target. */
export function forecastCopy(g: GameState, h: Pick<ForecastHintEvidence, 'action' | 'survey'>) {
  const advice = forecastAdvice(g, h.action, h.survey), { target, selected, reason, tied } = advice;
  const heading = h.action.type === 'declare' ? `Zeb suggests ${declLabel(h.action.decl)}`
    : h.action.type === 'bid' && h.action.bid.kind !== 'pass' ? `Zeb suggests bidding ${bidLabel(h.action.bid)}` : 'Zeb suggests passing';
  const best = selected ? `${trumpName(selected.decl)} ${tied ? 'shares the highest forecast' : 'has the highest forecast'} at ${percent(selected.pmake[target - 30]!)}` : '';
  const cutoff = percent(h.survey?.cutoff ?? .85).replace('.0%', '%');
  let explanation: string;
  if (reason === 'partner') {
    const high = highBid(g.bids)!;
    explanation = `${SEAT_NAMES[high.seat]} already holds the bid at ${bidLabel(high.bid)}. Zeb would leave the bid with your partner.`;
  } else if (reason === 'marks') {
    explanation = 'The next legal raise costs more than one mark. Zeb’s ordinary bidding policy stops at one mark; its forecast does not decide whether to risk extra marks.';
  } else if (reason === 'declare') {
    explanation = `For your ${target}-point target, ${best}.`;
  } else if (reason === 'pass') {
    explanation = `At the minimum bid of ${target}, ${best}, below Zeb’s ${cutoff} bidding cutoff.`;
  } else if (reason === 'forced') {
    explanation = `Everyone passed, so you must bid at least 30. For ${target} points, ${best}.`
      + (selected && selected.pmake[target - 30]! < (h.survey?.cutoff ?? .85) ? ` Even this is below Zeb’s usual ${cutoff} cutoff.` : '');
  } else {
    explanation = `With ${selected ? trumpName(selected.decl) : 'its preferred trump'}, Zeb estimates ${selected ? percent(selected.pmake[target - 30]!) : 'an unknown chance'} of making ${target}. This is its highest bid meeting the ${cutoff} cutoff.`;
  }
  return { heading, explanation };
}

export function ForecastDetails({ g, hint, capture }: {
  g: GameState; hint: ForecastHintEvidence;
  capture?: { sessionId: string; questionGameId: string; onSaved: (id: string) => void };
}) {
  const advice = forecastAdvice(g, hint.action, hint.survey);
  const [target, setTarget] = useState(hint.explored_target ?? advice.target);
  const [comparisonOpen, setComparisonOpen] = useState(hint.comparison_open ?? false);
  const rows = forecastRows(hint.survey?.forecast ?? [], target), best = rows[0]?.pmake[target - 30];
  const tied = rows.filter(f => f.pmake[target - 30] === best).length > 1;
  return <>
    <h3 class="bid-hint-suggestion">{hint.heading}</h3>
    <p>{hint.explanation}</p>
    <p class="setting-hint">{hint.model.name} · {hint.model.version}{hint.survey && ' · Forecast estimates, not guarantees.'}</p>
    {hint.survey && <details class="disclosure bid-hint-comparison" open={comparisonOpen} onToggle={e => setComparisonOpen(e.currentTarget.open)}>
      <summary>Compare trumps</summary>
      <label class="bid-hint-target">Explore a target
        <select aria-label="Explore a target" value={target} onChange={e => setTarget(Number(e.currentTarget.value))}>
          {Array.from({ length: 13 }, (_, i) => i + 30).map(n => <option key={n} value={n}>{n} points{n === 42 ? ' · all tricks' : ''}</option>)}
        </select>
      </label>
      <p class="setting-hint">Changing this target explores the same forecast. Your recommendation stays above; no bid or trump is selected.</p>
      {g.phase === 'declaring' && target !== advice.target && <p class="setting-hint">Your contract still requires {advice.target} points.</p>}
      {g.phase === 'bidding' && (advice.minimumTarget === null
        ? <p class="setting-hint">The next legal raise is above one mark. These point targets do not recommend a mark bid.</p>
        : target < advice.minimumTarget && <p class="setting-hint">{target} is below the minimum legal bid of {advice.minimumTarget}.</p>)}
      <table class="bid-hint-table">
        <caption>Estimated chance of making {target}</caption>
        <thead><tr><th scope="col">Trump</th><th scope="col">Forecast</th></tr></thead>
        <tbody>{rows.map(f => <tr key={f.decl} class={f.pmake[target - 30] === best ? 'bid-hint-best' : ''}>
          <th scope="row">{trumpName(f.decl)}{f.pmake[target - 30] === best && <span class="bid-hint-tag">Highest{tied ? ' · tied' : ''}</span>}</th>
          <td>{percent(f.pmake[target - 30]!)}</td>
        </tr>)}</tbody>
      </table>
      <p class="setting-hint">{hint.survey.worlds} sampled deals. These forecasts use your seven dominoes and sampled unseen hands. They are predictions, not counts of completed games; small differences can come from sampling.</p>
      {target === 42 && <p class="setting-hint">42 points means all seven tricks. This forecast does not measure whether risking extra marks is worthwhile.</p>}
    </details>}
    {capture && <SaveHint g={g} sessionId={capture.sessionId} questionGameId={capture.questionGameId} onSaved={capture.onSaved}
      evidence={{ ...hint, explored_target: target, comparison_open: comparisonOpen }} />}
  </>;
}
