import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState, PlayRecord } from '../engine';
import { Domino } from './Domino';
import { bidLabel, declLabel } from './store';
import { currentHandUrl } from './share';
import './share-hand.css';

/** The link is captured on tap and stays fixed while the game continues. */
export function ShareHandButton({ g, className = 'text-btn' }: { g: GameState; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<{ url: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (snapshot) dialog.current?.showModal();
    else dialog.current?.close();
  }, [snapshot]);
  useEffect(() => () => { generation.current++; }, []);
  const close = () => { generation.current++; setSnapshot(null); setBusy(false); };
  const copy = async () => {
    if (!snapshot?.url) return;
    const started = generation.current;
    try {
      await navigator.clipboard.writeText(snapshot.url);
      if (started === generation.current) setMessage('Link copied. Paste it into your message.');
    } catch {
      if (started === generation.current) setMessage('Select and copy the link below to send it.');
    }
  };
  const send = async () => {
    if (!snapshot?.url || busy) return;
    const started = generation.current;
    setBusy(true); setMessage('');
    try {
      await navigator.share({ title: 'A hand of Plunge', text: 'Take a look at this hand of Plunge.', url: snapshot.url });
    } catch (error) {
      if (started === generation.current && !(error instanceof Error && error.name === 'AbortError')) {
        setMessage('Sharing is unavailable. Copy the link below to send it.');
      }
    } finally { if (started === generation.current) setBusy(false); }
  };
  return <>
    <button type="button" class={className} aria-haspopup="dialog" onClick={() => {
      generation.current++; setMessage(''); setSnapshot({ url: currentHandUrl(g) });
    }}>Share this hand</button>
    <dialog ref={dialog} class="card share-hand-dialog" aria-label="Share this hand" onClose={close}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <h2 class="sheet-title">Share this hand</h2>
      {snapshot?.url ? <>
        <p class="hint">Send a view-only snapshot, including all four hands and the plays so far. Your game continues here.</p>
        {typeof navigator.share === 'function' && <button type="button" class="big-btn" disabled={busy} onClick={() => void send()}>Send hand…</button>}
        <button type="button" class="big-btn secondary" onClick={() => void copy()}>Copy link</button>
        <label class="share-hand-link">Hand link<input type="text" readOnly value={snapshot.url} onFocus={event => event.currentTarget.select()} /></label>
      </> : <p role="alert">This hand could not be shared. Close this and try again.</p>}
      <p class="hint" role="status">{message}</p>
      <button type="button" class="big-btn secondary" onClick={close}>Close</button>
    </dialog>
  </>;
}

const WHO = ['Sender', 'Left opponent', 'Sender’s partner', 'Right opponent'] as const;

/** An unfinished hand has no result to review and must never offer moves or AI actions. */
export function SharedCurrentHand({ g, onClose }: { g: GameState; onClose: () => void }) {
  const plays = (items: readonly PlayRecord[]) => <div class="shared-plays">{items.map(p =>
    <div key={p.seat}><span>{WHO[p.seat]}</span><Domino id={p.domino} orientation="h" /></div>)}</div>;
  return <div class="doc shared-hand">
    <header class="back-bar"><button type="button" class="text-btn" onClick={onClose}>Back to home</button><h1>Shared hand</h1></header>
    <main class="doc-body">
      <p>This is a view-only snapshot from the sender’s side of the table. It does not update as they play.</p>
      <p>{g.phase === 'bidding' ? 'Bidding is in progress.' : g.phase === 'declaring' ? 'Trump has not been chosen.' : `Trump: ${g.declaration ? declLabel(g.declaration) : 'None'}.`}
        {g.turn !== null && ` Next to act: ${WHO[g.turn]}.`}</p>
      <h2>Bids</h2>
      {g.bids.length ? <ul>{g.bids.map(b => <li key={b.seat}>{WHO[b.seat]}: {bidLabel(b.bid)}</li>)}</ul> : <p>No bids yet.</p>}
      <h2>Dominoes still held</h2>
      {g.hands.map((hand, seat) => <section key={seat} aria-label={`${WHO[seat]}’s hand`}>
        <h3>{WHO[seat]}{g.sittingOut === seat ? ' · Sitting out' : ''}</h3>
        <div class="shared-dominoes">{hand.map(id => <Domino key={id} id={id} />)}{hand.length === 0 && <p>No dominoes left.</p>}</div>
      </section>)}
      <h2>Current trick</h2>
      {g.currentTrick.length ? plays(g.currentTrick) : <p>No dominoes played in this trick yet.</p>}
      <h2>Completed tricks</h2>
      <p>Sender’s team: {g.points[0]} points · Opponents: {g.points[1]} points</p>
      {g.tricks.map((trick, i) => <section key={i}><h3>Trick {i + 1} · {WHO[trick.winner]} won · {trick.points} points</h3>{plays(trick.plays)}</section>)}
      <ShareHandButton g={g} />
    </main>
  </div>;
}
