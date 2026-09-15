/** Original playing evidence stays visible when a fresh estimate is requested. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { type GameState } from '../engine';
import { api, requestKey, requestTile, type NativeReceipt, type NativeEstimate } from '../ai/native';
import { decisionStats, type MoveStats, type reviewPosition, type ReviewSelection } from '../ai/native-analysis';
import { Domino } from './Domino';
import { ledChip, SEAT_NAMES, trumpChip } from './store';

function Scores({ stats, played }: { stats: MoveStats; played: number }) {
  return <>
    <p>Chance to <strong>{stats.objective} the bid</strong> · {stats.worlds} sampled worlds
      {stats.fallback ? ' · smaller fallback comparison' : ''}</p>
    <div class="exp-rows">{stats.options.map((a) => <div class={`exp-row${a.tile === played ? ' exp-played' : ''}`} key={a.tile}>
      <Domino id={requestTile(a.tile)} orientation="h" className="exp-dom" />
      <span class="native-score"><strong>{(a.chance*100).toFixed(1)}%</strong>
        {a.successes !== null && <small>{a.successes} / {stats.worlds}</small>}</span>
      <span>{[a.tile === played ? 'played' : '', a.best ? 'best L1 estimate' : ''].filter(Boolean).join(' · ')}</span>
    </div>)}</div>
  </>;
}

export function NativeStats({ g, sel, position, receipt, loading }: {
  g: GameState; sel: ReviewSelection; position: NonNullable<ReturnType<typeof reviewPosition>>;
  receipt: NativeReceipt | null; loading: boolean;
}) {
  const [estimate, setEstimate] = useState<NativeEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const { request, remaining, legal, played } = position;
  const original = receipt ? decisionStats(receipt.response, request, legal) : null;
  const fresh = estimate ? decisionStats(estimate.response, request, legal) : null;
  const forced = legal.length === 1;
  const led = ledChip(g, g.tricks[sel.trick]!.plays.slice(0, sel.play));
  const inspect = async (worlds: 40 | 160): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    controller.current = new AbortController();
    try {
      const value = await api<NativeEstimate>('estimates', { request, worlds }, worlds === 160 ? 24000 : 18000, controller.current.signal);
      if (value.schema !== 'plunge-estimate-v1' || requestKey(value.identity.request) !== requestKey(request)
        || value.identity.player.n !== worlds) throw new Error('The estimate does not match this position.');
      if (alive.current) setEstimate(value);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section class="native-stats" aria-label="Move statistics">
    <p class="native-position">{trumpChip(g)} · {led ? `led: ${led}` : 'choosing the lead'}
      {' · '}{request.seat % 2 === request.bidder % 2 ? 'trying to make 30' : 'trying to set 30'}</p>
    <p class="setting-hint">{request.seat === 0 ? 'Your' : `${SEAT_NAMES[request.seat]}’s`} hand before this play. Legal choices are outlined.</p>
    <div class="native-held">{remaining.map((tile) => <span key={tile} class={legal.includes(tile) ? 'native-legal' : ''}>
      <Domino id={requestTile(tile)} orientation="h" className="exp-dom" />
    </span>)}</div>
    {forced ? <p class="native-forced"><strong>Forced — the only legal move.</strong>
      {led && ` Must follow ${led}.`} There was no choice to compare.</p> : <>
      <h4>{receipt ? 'What Walt saw when it played' : 'Ask Walt about this play'}</h4>
      {loading ? <p role="status">Loading the original scores…</p>
        : original ? <Scores stats={original} played={played} />
        : <p class="setting-hint">{receipt ? 'No completed option scores were saved for this decision.'
          : 'No original Walt estimate for this play. Ask Walt to compare the options from this player’s view.'}</p>}
      {receipt?.response.interruption && <p class="setting-hint">{receipt.response.interruption}</p>}
      {receipt?.response.review_result?.status === 'changed' && <p class="setting-hint">These are L1’s scores before the partner check changed the choice.</p>}
      {receipt?.response.n === 160 && <p class="setting-hint">This opening requested 160 worlds; the scores show the largest comparison that finished.</p>}
      {original && <p class="setting-hint">The recorded sample, from this player’s own hand and public history. Small gaps can be sampling noise.</p>}
      <div class="native-inspect-controls">
        {!original && <button class="big-btn secondary" disabled={busy || loading} onClick={() => void inspect(40)}>Ask Walt · 40 worlds</button>}
        <button class="big-btn secondary" disabled={busy || loading} onClick={() => void inspect(160)}>Look closer · 160 worlds</button>
      </div>
      {busy && <p role="status">Walt is comparing the options… usually a few seconds, up to 20 seconds.</p>}
      {estimate && <div class="native-fresh">
        <h4>Later L1 recheck · requested {estimate.identity.player.n} worlds</h4>
        {fresh ? <Scores stats={fresh} played={played} /> : <p>No complete comparison finished within the time limit. You can retry.</p>}
        {fresh?.fallback && <p>The larger comparison did not finish; these are the smaller completed sample’s scores. You can retry.</p>}
        <p class="setting-hint">Same own hand and public history · {(estimate.response.elapsed_us/1e6).toFixed(2)} s. This recheck does not change the original decision.</p>
      </div>}
      {error && <p class="native-warning" role="alert">{error}</p>}
    </>}
  </section>;
}
