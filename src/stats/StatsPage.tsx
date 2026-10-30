import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { contractLabel, declLabel } from '../ui/store';
import { loadStats, type StatsData } from './client';
import { demoHands } from './demo';
import { handModelLabel, matchesMetric, metricNames, readHands, sameContract, sameDeal, type Metric, type StatsHand } from './model';
import { ReplayPane } from './ReplayPane';
import '../ui/app.css';
import './stats.css';

export function StatsPage({ demo = false }: { demo?: boolean }) {
  const [scope, setScope] = useState<'mine' | 'family'>('mine'), [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState(''), [reload, setReload] = useState(0), [metric, setMetric] = useState<Metric>('all');
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(location.search).get('hand'));
  const [similar, setSimilar] = useState<{hand:StatsHand; kind:'deal' | 'contract'} | null>(null), [limit, setLimit] = useState(24);
  const listHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    setError(''); setData(null);
    if (demo) { setData({ account: null, family: true, hands: readHands(demoHands()).hands.filter(h => scope === 'mine' || ['hand-over', 'game-over'].includes(h.game.phase)), notice: '' }); clearTimeout(timer); }
    else void loadStats(scope, controller.signal).then(next => { if (live) setData(next); }).catch(e => {
      if (!live) return;
      if (!controller.signal.aborted) setError(e.message);
      else setError('Loading took too long. Refresh to try again.');
    }).finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [scope, reload, demo]);
  const parsed = useMemo(() => readHands(data?.hands ?? []), [data]);
  const hand = parsed.hands.find(h => h.id === selected);
  const counts = Object.fromEntries((Object.keys(metricNames) as Metric[]).map(key => [key, parsed.hands.filter(h => matchesMetric(h, key)).length])) as Record<Metric, number>;
  const filtered = parsed.hands.filter(h => matchesMetric(h, metric) && (!similar || (similar.kind === 'deal' ? sameDeal(h, similar.hand) : sameContract(h, similar.hand))));
  const chooseMetric = (value: Metric) => { setMetric(value); setLimit(24); requestAnimationFrame(() => listHeading.current?.focus()); };
  const open = (id: string | null) => {
    setSelected(id);
    const url = new URL(location.href); if (id) url.searchParams.set('hand', id); else url.searchParams.delete('hand');
    history.replaceState(null, '', url);
    if (!id) requestAnimationFrame(() => listHeading.current?.focus());
  };
  if (data && hand) return <ReplayPane key={hand.id} hand={hand} demo={demo} onBack={() => open(null)}/>;
  return <main class="stats-page">
    <header class="stats-header"><a href="/">← Back to Plunge</a><a href="/?account=1">Your account</a></header>
    <div class="stats-title"><p class="stats-eyebrow">{demo ? 'Interactive demo · sample hands' : 'Every number has a hand behind it'}</p>
      <h1>Stats at the table</h1><p>Follow a stat back to the deal. Play a deal again, or keep your hand and try a new deal.</p></div>
    {demo ? <aside class="stats-banner"><strong>These are sample games, not your stats.</strong> Demo attempts stay separate from your real results. <a href="/?stats=1">Open my stats</a></aside>
      : <p><a href="/?stats=1&demo=stats">Try the interactive stats demo →</a></p>}
    <nav class="stats-controls" aria-label="Whose hands">
      <button type="button" aria-pressed={scope === 'mine'} onClick={() => { setScope('mine'); setSimilar(null); open(null); }}>{demo ? 'Sample hands' : 'My hands'}</button>
      {data?.family && <button type="button" aria-pressed={scope === 'family'} onClick={() => { setScope('family'); setSimilar(null); open(null); }}>{demo ? 'Demo family hands' : 'Family hands'}</button>}
      {!demo && <button type="button" onClick={() => setReload(n => n + 1)}>Refresh</button>}
    </nav>
    {!data && !error && <p role="status">Loading saved hands…</p>}
    {error && <p role="alert">{error}</p>}
    {data?.notice && <p role="status">{data.notice}</p>}
    {parsed.skipped > 0 && <p role="status">{parsed.skipped} saved records could not be opened and are excluded from these numbers. Their saved copies are unchanged.</p>}
    {data && <>
      {selected && <p role="status">This hand isn’t in this list. Try Family hands if someone shared it with you.</p>}
      <section class="stats-metrics" aria-label="Hand statistics">
        {(Object.keys(metricNames) as Metric[]).map(key => <button key={key} type="button" aria-pressed={metric === key} onClick={() => chooseMetric(key)}>
          <span>{metricNames[key]}</span><strong>{counts[key]}</strong><small>{key === 'made' || key === 'set' ? `of ${counts.made + counts.set} decided bids` : 'See matching hands →'}</small>
        </button>)}
      </section>
      <p class="stats-help">Made and set describe the bidding team’s result. Retries are excluded from the other numbers; unfinished attempts and thrown-in hands aren’t counted as decided bids.
        {scope === 'family' && ' Family browsing shows completed hands only.'}</p>
      <section class="stats-paper" aria-labelledby="matching-hands">
        <h2 ref={listHeading} id="matching-hands" tabIndex={-1}>{metricNames[metric]}</h2>
        {similar && <p>{similar.kind === 'deal' ? 'Same dealt tiles, shaker and rules' : 'Same contract, call and rules'} as hand {similar.hand.record.handNumber}.
          {' '}<button type="button" onClick={() => setSimilar(null)}>Clear match filter</button></p>}
        <p role="status">{filtered.length} matching {filtered.length === 1 ? 'hand' : 'hands'}</p>
        {!filtered.length && <p>{parsed.hands.length ? 'No saved hands match this filter yet.' : 'Your saved hands will appear here. You can explore the demo now.'}</p>}
        <div class="stats-hand-list">{filtered.slice(0, limit).map(h => <article key={h.id} class="stats-hand-card">
          <div><p class="stats-eyebrow">{h.players.map(p => p.name).join(' · ') || 'Recorded players'}{h.retry ? ' · Retry' : ''}</p>
            <h3>{h.game.contract ? `${contractLabel(h.game.contract)}${h.game.declaration ? ` · ${declLabel(h.game.declaration)}` : ''}` : h.game.thrownIn ? 'Thrown in' : 'Unfinished auction'}</h3>
            <p class="stats-help">{handModelLabel(h.record)}</p>
            <p>Hand {h.record.handNumber} · <time dateTime={h.record.endedAt}>{new Date(h.record.endedAt).toLocaleDateString()}</time>
              {' · '}{h.game.handResult ? matchesMetric({ ...h, retry: false }, 'made') ? 'Made the bid' : 'Set the bid' : h.game.thrownIn ? 'No bid' : 'Unfinished'}</p>
          </div>
          <div class="stats-controls"><button type="button" class="stats-primary" onClick={() => open(h.id)}>Play again</button>
            <button type="button" onClick={() => { setSimilar({hand:h,kind:'deal'}); chooseMetric('all'); }}>Find same deal</button>
            {h.game.contract && <button type="button" onClick={() => { setSimilar({hand:h,kind:'contract'}); chooseMetric('all'); }}>Find same contract</button>}
          </div>
        </article>)}</div>
        {filtered.length > limit && <button type="button" onClick={() => setLimit(n => n + 24)}>Show more hands</button>}
      </section>
    </>}
  </main>;
}
