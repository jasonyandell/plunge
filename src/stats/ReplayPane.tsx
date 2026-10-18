import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { legalDominoes, type Action, type Seat } from '../engine';
import { handSteps } from '../engine/hand-history';
import { rotateGame, relativeSeat } from '../room/view';
import { Domino } from '../ui/Domino';
import { OpponentSide, OpponentTop, TrickArea } from '../ui/Table';
import { BidSheet, DeclareSheet } from '../ui/sheets';
import { TrickHistory } from '../ui/TrickHistory';
import { bidLabel, contractLabel, declLabel, ledChip } from '../ui/store';
import { playerVersion } from '../ai/players';
import { replayAt } from './replay';
import { handModelLabel, replaySeatLabel, type StatsHand } from './model';
import { acceptPracticeMove, handFinished, playPractice, recordedAction, startPractice, type PracticeKind, type PracticeRun } from './practice';
import { practiceComputer } from './practice-computer';
import { practiceStore } from './practice-storage';

export function actionLabel(action: Action): string {
  if (action.type === 'play') return `Play ${action.domino[0]}–${action.domino[1]}`;
  if (action.type === 'bid') return bidLabel(action.bid);
  if (action.type === 'declare') return `Call ${declLabel(action.decl)}`;
  return 'Next hand';
}
export function ReplayPane({ hand, demo, onBack }: { hand: StatsHand; demo: boolean; onBack: () => void }) {
  const [seat, setSeat] = useState<Seat>(hand.players[0]?.seat ?? 0);
  return <main class="play-again-page">
    <header class="practice-header"><button type="button" onClick={onBack}>← Stats</button><h1>Play again</h1>
      <label>Your seat <select value={seat} onChange={e => setSeat(Number(e.currentTarget.value) as Seat)}>
        {([0,1,2,3] as Seat[]).map(s => <option key={s} value={s}>Seat {s + 1} · {replaySeatLabel(hand,s)}</option>)}
      </select></label></header>
    <PracticeSeat key={`${hand.id}:${seat}`} hand={hand} seat={seat} demo={demo}/>
  </main>;
}
function PracticeSeat({ hand, seat, demo }: { hand: StatsHand; seat: Seat; demo: boolean }) {
  const [run, setRun] = useState<PracticeRun | null>(null), [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<PracticeRun[]>([]), [storageError, setStorageError] = useState('');
  const [watch, setWatch] = useState(false), [cursor, setCursor] = useState(0), [reveal, setReveal] = useState(false);
  const [held, setHeld] = useState(false), [thinking, setThinking] = useState<Seat | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [copied, setCopied] = useState(false);
  const store = useMemo(() => {
    try { return practiceStore(hand, seat, demo, localStorage); } catch { return null; }
  }, [hand.id, seat, demo]);
  const sourceSteps = useMemo(() => handSteps(hand.game), [hand.id]);
  const generation = useRef(0);
  useEffect(() => {
    try {
      if (!store) throw new Error('Device storage is unavailable.');
      const attempts = store.list(); setSaved(attempts);
      const last = attempts[attempts.length - 1]; if (last && !handFinished(last.game)) setRun(last);
    } catch { setStorageError('Saved practice could not be opened. You can play in this tab; keep it open to retain your new hand.'); }
    setLoaded(true);
  }, [store]);
  useLayoutEffect(() => {
    if (!run) return;
    try {
      if (!store) throw new Error('Device storage is unavailable.');
      store.save(run); setStorageError('');
      setSaved(old => [...old.filter(a => a.id !== run.id), run]);
    } catch (e) { setStorageError(`${e instanceof Error ? e.message : 'Practice could not be saved.'} Keep this tab open.`); }
  }, [run, store]);
  const start = (kind: PracticeKind, from = 0) => {
    generation.current++; setHeld(false); setError(''); setWatch(false); setReveal(false);
    const id = crypto.randomUUID();
    let next = startPractice(hand.game, { id, source: hand.record.code, seat, kind, seed: id, created: new Date().toISOString() });
    for (const step of sourceSteps.slice(0, kind === 'same' ? from : 0)) next = playPractice(hand.game, next, step.action);
    setRun(next);
  };
  const apply = (action: Action, expected: PracticeRun) => {
    setRun(current => {
      if (!current) return current;
      return acceptPracticeMove(hand.game, current, {id:expected.id,index:expected.actions.length}, action);
    });
  };
  // Each recorded or computer move is a real engine action. Cleanup cancels work on leave/restart/seek.
  useEffect(() => {
    setThinking(null); setError('');
    if (!run || watch || (handFinished(run.game) && !held)) return;
    const token = ++generation.current, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (held) timer = setTimeout(() => { if (generation.current === token) setHeld(false); }, 1400);
    else if (run.game.turn !== seat && run.game.turn !== null) {
      const actor = run.game.turn;
      timer = setTimeout(() => {
        if (generation.current !== token) return;
        setThinking(actor);
        void practiceComputer(hand.game, run, controller.signal).then(action => {
          if (controller.signal.aborted || generation.current !== token) return;
          const next = playPractice(hand.game, run, action);
          if (next.game.tricks.length > run.game.tricks.length) setHeld(true);
          apply(action, run);
        }).catch(e => { if (!controller.signal.aborted && generation.current === token) setError(e instanceof Error ? e.message : 'The computer could not move.'); })
          .finally(() => { if (generation.current === token) setThinking(null); });
      }, 350);
    }
    return () => { generation.current++; clearTimeout(timer); controller.abort(); };
  }, [run, watch, held, retry]);
  const choose = (action: Action) => {
    if (!run || watch || held || run.game.turn !== seat || handFinished(run.game)) return;
    const next = playPractice(hand.game, run, action);
    if (next.game.tricks.length > run.game.tricks.length) setHeld(true);
    apply(action, run);
  };
  const base = watch || !run ? replayAt(hand.game, cursor) : run.game, g = rotateGame(base, seat);
  const names = ([0,1,2,3] as Seat[]).map(s => s === 0 ? 'You' : hand.players.find(p => p.seat === (s + seat) % 4)?.name ?? `Seat ${(s + seat) % 4 + 1}`);
  const finished = !!run && handFinished(run.game), active = !!run && !watch;
  const last = g.tricks[g.tricks.length - 1], showing = active && held && !!last;
  const plays = showing ? last.plays : g.currentTrick;
  const legal = new Set(active && !held && g.phase === 'playing' && g.turn === 0 ? legalDominoes(g) : []);
  const original = run ? recordedAction(hand.game, run) : null;
  const branch = active && run.branchAt !== null;
  const nextNames = base.contract?.kind === 'nello' ? playerVersion('native-partner') : playerVersion('zeb');
  const status = watch ? `Original · move ${cursor} of ${sourceSteps.length}` : !run ? 'Choose a deal to play.'
    : finished ? 'Practice hand finished' : showing ? `Trick ${g.tricks.length} · ${names[last!.winner]} took it`
    : run.kind === 'similar' ? 'Same seven dominoes · new deal' : branch ? 'New path · play it through' : 'Following the original game';
  const share = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); }
    catch { setError('Copy this page’s address to share the source hand.'); }
  };
  return <>
    <details class="practice-options" open={!run || watch || finished}><summary>Deal and practice options</summary>
      <p>{demo ? 'Sample hand. ' : ''}Same deal follows the original until you choose differently. Then the computer players respond to your new path.</p>
      <div class="practice-buttons"><button type="button" disabled={!loaded} onClick={() => start('same')}>Play same deal</button>
        <button type="button" disabled={!loaded} onClick={() => start('similar')}>Same hand, new deal</button>
        <button type="button" aria-pressed={watch} onClick={() => { generation.current++; setWatch(w => !w); setReveal(false); }}>{watch && run ? 'Back to my hand' : 'Watch original'}</button>
        {(hand.remote || demo) && <button type="button" onClick={() => void share()}>{copied ? 'Link copied' : 'Copy hand link'}</button>}</div>
      <p class="practice-small">“Same hand, new deal” keeps your seven dominoes and redeals everyone else’s. New play uses {playerVersion('zeb')}; Walt covers Nel-O. Practice stays on this device, separate from your real game and stats.</p>
    </details>
    {watch && <div class="practice-watch">
      <p>Recorded players: {handModelLabel(hand.record)}</p>
      <div class="practice-buttons"><button type="button" disabled={!cursor} onClick={() => setCursor(0)}>Start</button>
        <button type="button" disabled={!cursor} onClick={() => setCursor(c => c - 1)}>Previous</button>
        <button type="button" disabled={cursor === sourceSteps.length} onClick={() => setCursor(c => c + 1)}>Next move</button>
        <button type="button" disabled={cursor === sourceSteps.length} onClick={() => setCursor(sourceSteps.length)}>Result</button>
        <button type="button" disabled={handFinished(base)} onClick={() => start('same', cursor)}>Play from here</button></div>
      <label>Original move {cursor} of {sourceSteps.length}<input aria-label="Original move" type="range" min={0} max={sourceSteps.length} value={cursor} onInput={e => setCursor(Number(e.currentTarget.value))}/></label>
      <label><input type="checkbox" checked={reveal} onChange={e => setReveal(e.currentTarget.checked)}/> Show original hands</label>
    </div>}
    <section class="practice-table table-screen" aria-label="Play again table">
      <header class="practice-status"><strong role="status">{status}</strong><span>Us {g.points[0]} · Them {g.points[1]}</span></header>
      <div class="info-bar"><div class="suit-card"><span class="suit-label">{g.contract ? `Bid ${contractLabel(g.contract)}` : 'Auction'}</span><strong class="suit-name">{g.declaration ? declLabel(g.declaration) : g.phase === 'bidding' ? 'Bidding' : 'Calling trump'}</strong></div>
        <div class="suit-card suit-led"><span class="suit-label">Suit led</span><strong class="suit-name">{ledChip(g, plays) ?? 'Not led yet'}</strong></div></div>
      <div class="felt">
        <OpponentTop g={g} names={names} thinking={thinking === null ? null : relativeSeat(thinking,seat)} note={active ? branch ? nextNames : 'Original moves' : null}/>
        <div class="middle"><OpponentSide g={g} names={names} seat={1} thinking={thinking === null ? null : relativeSeat(thinking,seat)}/>
          <TrickArea g={g} names={names} plays={plays} winner={showing ? last!.winner : null} gathering={showing} thinking={thinking === null ? null : relativeSeat(thinking,seat)}/>
          <OpponentSide g={g} names={names} seat={3} thinking={thinking === null ? null : relativeSeat(thinking,seat)}/></div>
        <div class="hand-area"><div class="hand-heading"><p class="hand-caption"><strong class="you-label">You</strong><span>{active && !held && g.turn === 0 ? 'Your turn' : g.sittingOut === 0 ? 'Sitting out · Nel-O' : 'Your hand'}</span></p></div>
          <div class="hand" aria-label="Your hand">{g.hands[0]!.map(id => <Domino key={id} id={id} orientation="v" state={legal.size ? legal.has(id) ? 'legal' : 'illegal' : 'idle'} onTap={() => { if (legal.has(id)) choose({type:'play',domino:id}); }}/>)}</div>
        </div>
      </div>
      {active && !held && g.turn === 0 && g.phase === 'bidding' && <BidSheet g={g} dispatch={e => { if(e.type==='human') choose(e.action); }} player="zeb" bookSeat={seat} showHints={false} sessionId={run.id} onQuestion={() => {}}/>}
      {active && !held && g.turn === 0 && g.phase === 'declaring' && <DeclareSheet g={g} dispatch={e => { if(e.type==='human') choose(e.action); }} player="zeb" bookSeat={seat} showHints={false} sessionId={run.id} onQuestion={() => {}}/>}
    </section>
    {active && !held && !finished && base.turn === seat && original && <div class="practice-original"><button type="button" onClick={() => choose(original)}>Play original move: {actionLabel(original)}</button><span>Or make your own choice at the table.</span></div>}
    {active && finished && <section class="practice-result" role="status"><h2>{g.handResult ? g.handResult.team === 0 ? 'Your team took the hand' : 'The other team took the hand' : 'Everyone passed'}</h2>
      <p>{g.handResult?.reason ?? 'The hand was thrown in.'} {g.handResult ? `${g.handResult.marks} ${g.handResult.marks === 1 ? 'mark' : 'marks'}.` : ''}</p>
      <p>{run.branchAt === null ? 'Every move and the result match the source game.' : 'This is the result of your new path.'} The source game is unchanged.</p>
      <button type="button" onClick={() => { generation.current++; setWatch(true); setCursor(sourceSteps.length); }}>Compare original result</button></section>}
    {reveal && watch && <div class="practice-watch">{([1,2,3] as Seat[]).map(s => <div key={s}><p>{names[s]}</p><div class="stats-tiles">{g.hands[s]!.map(id => <Domino key={id} id={id}/>)}</div></div>)}</div>}
    {g.tricks.length > 0 && <details class="practice-history"><summary>Tricks ({g.tricks.length})</summary><TrickHistory g={g} seatNames={names}/></details>}
    {saved.length > 0 && <details class="practice-history"><summary>Your practice ({saved.length})</summary><p>These outcomes are separate from the source game’s first result.</p>
      {saved.map(a => <button key={a.id} type="button" onClick={() => { generation.current++; setRun(a); setHeld(false); setWatch(false); }}>{a.kind === 'same' ? 'Same deal' : 'Same hand, new deal'} · {handFinished(a.game) ? a.game.handResult?.reason ?? 'Thrown in' : 'Resume hand'}</button>)}</details>}
    {error && <div class="practice-error" role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry computer</button></div>}
    {storageError && <p class="practice-error" role="alert">{storageError}</p>}
  </>;
}
