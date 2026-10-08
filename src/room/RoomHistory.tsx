import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState, Seat } from '../engine';
import { Domino } from '../ui/Domino';
import { TrickHistory } from '../ui/TrickHistory';
import { bidLabel, contractLabel, declLabel } from '../ui/store';
import { ROOM_HISTORY_LIMIT, type RoomHand, type RoomState } from './protocol';
import { rotateGame } from './view';
import { handsForGame } from '../history/review';

const handKey = (hand: RoomHand) => `${hand.sessionId}:${hand.game.handNumber}`;

/** A local, read-only view of the room's shared record. Never replaces the live game. */
export function RoomHistory({ room, seat, onClose }: { room: RoomState; seat: Seat; onClose: () => void }) {
  const hands = [...(room.recentHands ?? [])];
  const current = room.game;
  if (current && (current.phase === 'hand-over' || current.phase === 'game-over')) {
    hands.push({ sessionId: room.sessionId, game: current,
      names: room.seats.map((person, index) => person?.name ?? `Walt ${index + 1}`),
      practice: room.practiceHands?.includes(current.handNumber) ?? false });
  }
  return <HandHistory hands={hands} current={current} sessionId={room.sessionId} seat={seat} onClose={onClose} />;
}

/** Shared presentation for saved solo hands and the family table's record. */
export function HandHistory({ hands, current, sessionId, seat, onClose, solo = false, loading = false, error = null, onRetry }: {
  hands: readonly RoomHand[]; current: GameState | null; sessionId: string; seat: Seat; onClose: () => void;
  solo?: boolean; loading?: boolean; error?: string | null; onRetry?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const recent = handsForGame(hands, sessionId).reverse();
  const latestKey = recent[0] ? handKey(recent[0]) : '';
  const [selected, setSelected] = useState(latestKey);
  useEffect(() => setSelected(''), [sessionId]);
  useEffect(() => { if (!selected && latestKey) setSelected(latestKey); }, [selected, latestKey]);
  const hand = selected ? recent.find(item => handKey(item) === selected) : recent[0];
  const g = hand ? rotateGame(hand.game, seat) : null;
  const names = hand ? [0, 1, 2, 3].map(index => hand.names[(seat + index) % 4]!) : [];
  const teamName = (team: number) => `${names[team]} & ${names[team + 2]}`;
  const yourTurn = current?.turn === seat && ['bidding', 'declaring', 'playing'].includes(current.phase);

  return <dialog ref={dialog} class="card room-history" aria-labelledby="room-history-title" onClose={onClose}>
    <h2 id="room-history-title" class="card-title">Prior hands</h2>
    <p class="hint">The latest {ROOM_HISTORY_LIMIT} completed hands from this game, newest first.</p>
    <p class="room-notice" role="status">{yourTurn ? 'It’s your turn at the live table.' : current ? 'The live game continues while you review.' : 'Reviewing past hands won’t start a new game.'}</p>
    <button type="button" class="big-btn" onClick={onClose} autoFocus>{solo ? 'Back to the game' : 'Back to the live table'}</button>
    {error && <p role="alert">{error} {onRetry && <button type="button" class="text-btn" onClick={onRetry}>Retry loading</button>}</p>}
    {loading && <p role="status">Loading saved hands…</p>}
    {recent.length === 0 ? !loading && !error && <p>No completed hands in this game yet. Finish a hand to review it here.</p> : <>
      <label class="room-label">Choose a hand
        <select value={hand ? handKey(hand) : ''} onChange={event => setSelected(event.currentTarget.value)}>
          {!hand && <option value="" disabled>Choose another completed hand</option>}
          {recent.map(item => <option key={handKey(item)} value={handKey(item)}>
            Hand {item.game.handNumber}{item.practice ? ' · Practice' : ''}
          </option>)}
        </select>
      </label>
      {!hand && <p>This hand is no longer in the completed history. It may have been taken back or replaced by newer hands.</p>}
    </>}
    {g && hand && <section aria-label={`Hand ${g.handNumber} review`}>
      <h3>Hand {g.handNumber}{hand.practice ? ' · Practice' : ''}</h3>
      <p>{g.declarer !== null && `${names[g.declarer]} bid ${g.contract ? contractLabel(g.contract) : ''}`}
        {g.declaration && ` · ${declLabel(g.declaration)}`}</p>
      <p>{g.thrownIn ? 'Thrown in — no marks awarded.' : g.handResult
        ? `${names[g.handResult.declarer]} ${g.handResult.made ? 'made the bid' : 'was set'}. ${teamName(g.handResult.team)} earned ${g.handResult.marks} ${g.handResult.marks === 1 ? 'mark' : 'marks'}.` : ''}</p>
      <p>{teamName(0)}: {g.points[0]} points · {teamName(1)}: {g.points[1]} points</p>
      <p>Marks after this hand: {g.marks[0]}–{g.marks[1]}</p>
      <details key={handKey(hand)}><summary>Bids and starting hands</summary>
        <ol>{g.bids.map((bid, index) => <li key={index}>{names[bid.seat]}: {bidLabel(bid.bid)}</li>)}</ol>
        {g.dealt.map((tiles, index) => <div key={index} class="room-history-deal"><strong>{names[index]}</strong>
          <div>{tiles.map(tile => <Domino key={tile} id={tile} orientation="h" />)}</div>
        </div>)}
      </details>
      <h3>Trick by trick</h3>
      <p class="hint">Plays read left to right. A dot marks the lead; the highlighted domino won.</p>
      <div class="review-scroll"><TrickHistory g={g} seatNames={names} /></div>
      {g.tricks.length === 0 && <p>No tricks were played.</p>}
    </section>}
  </dialog>;
}
