/** Original playing evidence stays visible when a fresh estimate is requested. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { type GameState } from '../engine';
import { api, requestKey, requestTile, isNelloDefender, NATIVE_TABLE, type NativeReceipt, type NativeEstimate } from '../ai/native';
import { decisionStats, type reviewPosition, type ReviewSelection } from '../ai/native-analysis';
import { Domino } from './Domino';
import { CounterexampleScores } from './CounterexampleScores';
import { MoveScores } from './MoveScores';
import { ledChip, SEAT_NAMES, trumpChip } from './store';

export function NativeStats({ g, sel, position, receipt, loading }: {
  g: GameState; sel: ReviewSelection; position: NonNullable<ReturnType<typeof reviewPosition>>;
  receipt: NativeReceipt | null; loading: boolean;
}) {
  const [estimate, setEstimate] = useState<NativeEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const freshPanel = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (estimate && window.matchMedia('(max-width: 759px)').matches) {
      freshPanel.current?.scrollIntoView({ block: 'start' });
    }
  }, [estimate]);
  const { request, remaining, legal, played } = position;
  const original = receipt ? decisionStats(receipt.response, request, legal) : null;
  const fresh = estimate ? decisionStats(estimate.response, request, legal) : null;
  const forced = legal.length === 1;
  const led = ledChip(g, g.tricks[sel.trick]!.plays.slice(0, sel.play));
  const inspect = async (worlds: 40 | 160, counterexamples = false): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    controller.current = new AbortController();
    try {
      const value = await api<NativeEstimate>('estimates', { request, worlds, ...(counterexamples ? { nello_counterexamples: true } : {}) }, worlds === 160 ? 24000 : 18000, controller.current.signal);
      if (value.schema !== 'plunge-estimate-v1' || requestKey(value.identity.request) !== requestKey(request)
        || value.identity.player.n !== worlds) throw new Error('The estimate does not match this position.');
      if (alive.current) setEstimate(value);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section class="native-stats" aria-label="Move statistics">
    <p class="native-position">{trumpChip(g)} · {led ? `led: ${led}` : 'choosing the lead'}
      {' · '}playing to {request.seat % 2 === request.bidder % 2 ? 'make' : 'set'} {request.contract === 'nello' ? 'Nel-O' : request.bid}</p>
    <p class="setting-hint">{request.seat === 0 ? 'Your' : `${SEAT_NAMES[request.seat]}’s`} hand before this play. Legal choices are outlined.</p>
    <div class="native-held">{remaining.map((tile) => <span key={tile} class={legal.includes(tile) ? 'native-legal' : ''}>
      <Domino id={requestTile(tile)} orientation="h" className="exp-dom" />
    </span>)}</div>
    {forced ? <p class="native-forced"><strong>The only play available.</strong>
      {led && ` Must follow ${led}.`} There was no choice to compare.</p> : <>
      {(receipt || !estimate) && <h4>{receipt ? 'What Walt saw when it played' : 'Ask Walt about this play'}</h4>}
      {loading ? <p role="status">Loading the original scores…</p>
        : original ? <MoveScores stats={original} selected={played} selectionLabel="Played" />
        : !estimate && <p class="setting-hint">{receipt ? 'No completed option scores were saved for this decision.'
          : 'No original Walt estimate for this play. Ask Walt to compare the options from this player’s view.'}</p>}
      {receipt?.response.interruption && <p class="setting-hint">{receipt.response.interruption}</p>}
      {receipt?.response.review_result?.status === 'changed' && <p class="setting-hint">These were Walt’s first estimates. A separate partner check changed its choice.</p>}
      {receipt && <CounterexampleScores response={receipt.response} request={request} legal={legal} />}
      {original && <p class="setting-hint">Walt’s estimate from this player’s view. Small differences can come down to the sample.</p>}
      {estimate && <div class="native-fresh" ref={freshPanel}>
        <h4>A fresh look from Walt</h4>
        {fresh ? <MoveScores stats={fresh} selected={played} selectionLabel="Played" /> : <p>No complete comparison finished within the time limit. You can retry.</p>}
        <CounterexampleScores response={estimate.response} request={request} legal={legal} />
        {fresh?.fallback && <p>The larger comparison did not finish; these are the smaller completed sample’s scores. You can retry.</p>}
        <p class="setting-hint">A new estimate from the same player’s view.
          {' '}{original ? 'The original scores stay above.' : 'Small differences can come down to the sample.'}</p>
        <details class="disclosure"><summary>Recheck details</summary>
          <p>Later L1 recheck · requested {estimate.identity.player.n} worlds · {(estimate.response.elapsed_us/1e6).toFixed(2)} s.
            {' '}The scores show the largest comparison that finished.</p>
        </details>
      </div>}
      <div class="native-inspect-controls">
        {!original && <button class="big-btn secondary" disabled={busy || loading} onClick={() => void inspect(40)}>Ask Walt</button>}
        <button class="big-btn secondary" disabled={busy || loading} onClick={() => void inspect(160)}>Think deeper</button>
        {!NATIVE_TABLE && isNelloDefender(request) && <button class="big-btn secondary" disabled={busy || loading}
          onClick={() => void inspect(fresh?.worlds === 160 ? 160 : 40, true)}>Try counterexamples</button>}
      </div>
      {!busy && <p class="setting-hint">Think deeper compares more possible deals. It can take up to 20 seconds.</p>}
      {busy && <p role="status">Walt is comparing the options… usually a few seconds, up to 20 seconds.</p>}
      {error && <p class="native-warning" role="alert">{error}</p>}
    </>}
  </section>;
}
