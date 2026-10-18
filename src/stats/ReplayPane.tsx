import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { legalActions, type Action, type GameState, type Seat } from '../engine';
import { handSteps } from '../engine/hand-history';
import { Domino } from '../ui/Domino';
import { bidLabel, contractLabel, declLabel } from '../ui/store';
import { actionKey, ghostProgress, replayAt, replayScores, type ReplayAttempt } from './ghost';
import { attemptBook } from './client';
import type { StatsHand } from './model';

export function actionLabel(action: Action): string {
  if (action.type === 'play') return `Play ${action.domino[0]}–${action.domino[1]}`;
  if (action.type === 'bid') return bidLabel(action.bid);
  if (action.type === 'declare') return `Call ${declLabel(action.decl)}`;
  return 'Next hand';
}
export function ReplayPane({ hand, account, demo, onBack }: { hand: StatsHand; account: string | null; demo: boolean; onBack: () => void }) {
  const [seat, setSeat] = useState<Seat>(hand.players[0]?.seat ?? 0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [hand.id]);
  return <section class="stats-paper">
    <button type="button" onClick={onBack}>← Back to hands</button>
    <h2 tabIndex={-1} ref={heading}>Replay hand {hand.record.handNumber}</h2>
    <label class="stats-seat">Take a seat <select value={seat} onChange={e => setSeat(Number(e.currentTarget.value) as Seat)}>
      {([0, 1, 2, 3] as Seat[]).map(s => <option key={s} value={s}>Seat {s + 1} · {hand.players.find(p => p.seat === s)?.name ?? 'Recorded player'}</option>)}
    </select></label>
    <ReplaySeat key={`${hand.id}:${seat}`} hand={hand} seat={seat} account={account} demo={demo}/>
  </section>;
}
function ReplaySeat({ hand, seat, account, demo }: { hand: StatsHand; seat: Seat; account: string | null; demo: boolean }) {
  const [mode, setMode] = useState<'watch' | 'ghost'>('watch'), [cursor, setCursor] = useState(0), [reveal, setReveal] = useState(false);
  const [attempts, setAttempts] = useState<ReplayAttempt[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [showAttempts, setShowAttempts] = useState<'first' | 'retries' | 'best' | null>(null), [copied, setCopied] = useState(false);
  const book = useMemo(() => attemptBook(hand, seat, account, demo), [hand.id, seat, account, demo]);
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    void book.list().then(a => { if (alive.current) setAttempts(a); }).catch(e => { if (alive.current) setError(String(e.message)); });
    return () => { alive.current = false; };
  }, [book]);
  const run = async (work: () => Promise<ReplayAttempt[]>, enter = false) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const saved = await work();
      if (alive.current) { setAttempts(saved); if (enter) { setMode('ghost'); setReveal(false); setShowAttempts(null); } }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not save this replay. Retry to resume.'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const steps = useMemo(() => handSteps(hand.game), [hand.id]);
  const latest = attempts?.[attempts.length - 1];
  const progress = ghostProgress(hand.game, seat, latest?.choices ?? []);
  const isGhost = mode === 'ghost' && !!latest, game = isGhost ? progress.game : replayAt(hand.game, cursor);
  const index = isGhost ? progress.index : cursor, scores = replayScores(attempts ?? []);
  const completed = hand.game.phase === 'hand-over' || hand.game.phase === 'game-over';
  const decisions = ghostProgress(hand.game, seat, []).total;
  const choose = (action: Action) => { if (latest && !progress.done) void run(() => book.save(latest.id, [...latest.choices, action])); };
  const start = () => {
    if (latest && !latest.done) { setMode('ghost'); setReveal(false); }
    else void run(() => book.start(), true);
  };
  const history = (attempts ?? []).filter((a, i) => showAttempts === 'first' ? i === 0 : showAttempts === 'retries' ? i > 0 : a.matched === scores.best);
  const share = async () => {
    try {
      const url = new URL(location.href); url.search = '';
      url.searchParams.set('stats', '1'); if (demo) url.searchParams.set('demo', 'stats');
      url.searchParams.set('hand', hand.id); url.hash = '';
      await navigator.clipboard.writeText(url.toString()); setCopied(true);
    } catch { setError('The link could not be copied. You can copy this page’s address after opening the hand.'); }
  };
  return <>
    <p>{book.label}.</p>
    <p class="stats-help">Ghost score means consecutive decisions matching this player, not the quality of your play. Forced moves play automatically.
      The first attempt counts; retries can improve your personal best.</p>
    {attempts && attempts.length > 0 && <div class="stats-scorebar" aria-label="Replay statistics">
      <button type="button" aria-pressed={showAttempts === 'first'} onClick={() => setShowAttempts('first')}>First attempt <strong>{scores.first!.matched}/{scores.first!.total}</strong>{!scores.first!.done && ' · in progress'}</button>
      <button type="button" aria-pressed={showAttempts === 'best'} onClick={() => setShowAttempts('best')}>Personal best <strong>{scores.best}/{scores.first!.total}</strong></button>
      <button type="button" aria-pressed={showAttempts === 'retries'} onClick={() => setShowAttempts('retries')}>Retries <strong>{scores.retries}</strong></button>
    </div>}
    {showAttempts && <div class="stats-attempts"><h3>{showAttempts === 'first' ? 'Counted attempt' : showAttempts === 'best' ? 'Personal best attempts' : 'Practice retries'}</h3>
      {!history.length && <p>No retries yet.</p>}
      {history.map(a => <button key={a.id} type="button" disabled={busy} onClick={() => {
        setCursor(ghostProgress(hand.game, seat, a.choices).index); setMode('watch');
      }}>Attempt {(attempts?.indexOf(a) ?? 0) + 1}: {a.matched}/{a.total} · {a.done ? 'See stopping point' : 'In progress'}</button>)}
    </div>}
    {mode === 'watch' && <>
      <div class="stats-controls"><button type="button" disabled={cursor === 0} onClick={() => setCursor(0)}>Start</button>
        <button type="button" disabled={cursor === 0} onClick={() => setCursor(n => n - 1)}>Previous</button>
        <button type="button" disabled={cursor === steps.length} onClick={() => setCursor(n => n + 1)}>Next move</button>
        <button type="button" disabled={cursor === steps.length} onClick={() => setCursor(steps.length)}>Result</button></div>
      <label class="stats-slider">Move {cursor} of {steps.length}<input type="range" min={0} max={steps.length} value={cursor}
        onInput={e => setCursor(Number(e.currentTarget.value))}/></label>
      <label><input type="checkbox" checked={reveal} onChange={e => setReveal(e.currentTarget.checked)}/> Show all hands during review</label>
      {completed && decisions > 0 && <button type="button" class="stats-primary" disabled={busy || !attempts} onClick={start}>
        {latest && !latest.done ? `Resume attempt ${attempts?.length}` : latest ? 'Try this seat again' : 'Ghost play this seat'}</button>}
      {!completed && <p>This attempt ended before the hand finished. Replay goes as far as the saved moves.</p>}
      {completed && decisions === 0 && <p>This seat has no unforced decisions. Choose another seat for ghost play.</p>}
    </>}
    <div class="stats-table">
      <p role="status" aria-live="polite">{isGhost ? progress.done ? progress.divergence ? 'Your choice differs. The original hand is paused here.' : 'You matched every recorded decision.'
        : `Your turn · Seat ${seat + 1} · ${progress.matched} matched so far` : `Recorded move ${index} of ${steps.length}`}</p>
      {index > 0 && <p>Seat {steps[index - 1]!.seat + 1}: {actionLabel(steps[index - 1]!.action)}</p>}
      {game.bids.length > 0 && <p class="stats-help">Bids: {game.bids.map(b => `Seat ${b.seat + 1}: ${bidLabel(b.bid)}`).join(' · ')}</p>}
      <p>{game.contract ? `Bid ${contractLabel(game.contract)} · ` : ''}{game.declaration ? `Called ${declLabel(game.declaration)} · ` : ''}Team 1: {game.points[0]} points · Team 2: {game.points[1]} points</p>
      <div class="stats-tiles" aria-label={`Seat ${seat + 1} hand`}>{game.hands[seat]!.map(id => <Domino key={id} id={id}/>)}</div>
      {reveal && !isGhost && ([0, 1, 2, 3] as Seat[]).filter(s => s !== seat).map(s => <div key={s}>
        <p>Seat {s + 1}</p><div class="stats-tiles">{game.hands[s]!.map(id => <Domino key={id} id={id}/>)}</div>
      </div>)}
      {game.currentTrick.length > 0 && <div class="stats-trick" aria-label="Current trick">{game.currentTrick.map(p => <div key={p.seat}>Seat {p.seat + 1}<Domino id={p.domino} orientation="h"/></div>)}</div>}
      {isGhost && !progress.done && <fieldset disabled={busy} class="stats-choices"><legend>Choose your {game.phase === 'bidding' ? 'bid' : game.phase === 'declaring' ? 'call' : 'play'}</legend>
        {legalActions(game).map(a => <button key={actionKey(a)} type="button" onClick={() => choose(a)}>{actionLabel(a)}</button>)}
      </fieldset>}
      {isGhost && progress.divergence && <p>You chose {actionLabel(progress.divergence.chosen)}. The original player chose {actionLabel(progress.divergence.original)}.
        Matching score: {progress.matched}/{progress.total}. The recorded moves after this point belong to the original hand.</p>}
      {isGhost && progress.done && <div class="stats-controls">
        <button type="button" disabled={busy} onClick={() => { setCursor(progress.index); setMode('watch'); }}>Watch original from here</button>
        <button type="button" disabled={busy} onClick={start}>Retry this seat</button>
      </div>}
      {busy && <p role="status">Saving your attempt…</p>}
    </div>
    <details class="stats-moves"><summary>Moves so far ({index})</summary><ol>
      {steps.slice(0, index).map((step, i) => <li key={i}>Seat {step.seat + 1}: {actionLabel(step.action)}</li>)}
    </ol></details>
    {(hand.remote || demo) && <button type="button" onClick={() => void share()}>{copied ? 'Hand link copied' : demo ? 'Copy demo hand link' : 'Copy hand link'}</button>}
    {hand.remote && <p class="stats-help">Hand links use the same account and family access as the hand list.</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => void run(() => book.list())}>Reload saved attempt</button></div>}
  </>;
}
