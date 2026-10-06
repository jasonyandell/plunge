import { useState } from 'preact/hooks';
import { legalDominoes, teamOf, type Action, type Seat } from '../engine';
import type { RoomState } from './protocol';
import { Domino } from '../ui/Domino';
import { Tally } from '../ui/Tally';
import { BidSheet, DeclareSheet } from '../ui/sheets';
import { bidLabel, contractLabel, declLabel, ledChip } from '../ui/store';
import { rotateGame, relativeSeat } from './view';
import '../ui/table.css';

const POS = ['bottom', 'left', 'top', 'right'];
export function RoomTable({ room, seat, enabled, holding, thinking, act, start, pending }: {
  room: RoomState; seat: Seat; enabled: boolean; holding: boolean; thinking: Seat | null;
  act: (action: Action) => void; start: () => void; pending: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const g = room.game!;
  const view = rotateGame(g, seat);
  const name = (s: Seat) => s === seat ? 'You' : room.seats[s]?.name ?? `Walt ${s + 1}`;
  const legal = new Set(enabled && !holding && g.phase === 'playing' && g.turn === seat ? legalDominoes(g) : []);
  const ownTurn = enabled && !holding && g.turn === seat;
  const last = holding ? g.tricks.at(-1) : null;
  const plays = last?.plays ?? g.currentTrick;
  const led = ledChip(g, plays);
  const status = g.phase === 'bidding' ? `Hand ${g.handNumber} · Bidding` : g.phase === 'declaring'
    ? `${name(g.declarer!)} won the bid` : g.contract ? `${name(g.declarer!)} bid ${contractLabel(g.contract)}` : 'Hand over';
  const opponent = (relative: Seat) => {
    const s = ((seat + relative) % 4) as Seat;
    const bid = g.bids.find(b => b.seat === s);
    return <div class={`seat seat-${POS[relative]}${g.turn === s ? ' active' : ''}${thinking === s ? ' seat-thinking' : ''}`}>
      <div class="seat-name"><span>{name(s)}</span>{relative === 2 && <span class="seat-tag">Your partner</span>}
        {room.seats[s] && !room.seats[s]!.connected && <span class="seat-tag">Rejoining</span>}
        {g.shaker === s && <span class="badge shaker" aria-label="Shaker">⚀</span>}
        {bid && ['bidding', 'declaring'].includes(g.phase) && <span class="bubble">{bidLabel(bid.bid)}</span>}
      </div>
      <div class={relative === 2 ? 'mini-row' : 'mini-col'}>{g.hands[s]!.map(id => <Domino key={id} faceDown orientation={relative === 2 ? 'v' : 'h'} />)}</div>
    </div>;
  };
  return <div class="table-screen room-table" data-revision={room.revision} data-seat={seat}>
    <header class="status"><div class="status-mid"><div class="status-line">{status}</div>
      <div class="status-sub">{g.phase === 'bidding' ? `${name(g.shaker)} shook` : `Points · Us ${view.points[0]} · Them ${view.points[1]}`}</div></div>
      <div class="status-tallies"><Tally marks={view.marks[0]} label="Us" /><Tally marks={view.marks[1]} label="Them" /></div></header>
    {g.declaration && <div class="info-bar"><div class="suit-card suit-trump"><span class="suit-label">Trump</span><strong class="suit-name">{declLabel(g.declaration)}</strong></div>
      <div class="suit-card suit-led"><span class="suit-label">Suit led</span><strong class="suit-name">{led ?? 'Not led yet'}</strong></div>
      <button class="hist-toggle" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen}>Tricks ({g.tricks.length})</button></div>}
    {historyOpen && <div class="room-tricks">{g.tricks.map((t, i) => <div class="hist-row" key={i}><span>{i + 1}</span><div class="hist-plays">{t.plays.map(p => <div class="hist-cell" key={p.seat}><span class="hist-who">{name(p.seat)}</span><Domino id={p.domino} orientation="h" className="hist-dom" /></div>)}</div><span>{name(t.winner)} · {t.points}</span></div>)}</div>}
    <div class="felt">{opponent(2)}<div class="middle">{opponent(1)}<div class="trick">
      <div class="trick-plays">{plays.map((p, i) => <div class={`trick-slot slot-${POS[relativeSeat(p.seat, seat)]}${last?.winner === p.seat ? ' won' : ''}`} key={`${g.handNumber}:${g.tricks.length}:${p.seat}:${p.domino}`}>
        <Domino id={p.domino} orientation="h" />{i === 0 && <span class="led-tag">{name(p.seat)} led</span>}
      </div>)}</div>
      <div class="trick-note" role="status">{holding ? `${name(last!.winner)} took the trick` : thinking !== null ? `${name(thinking)} is thinking…` : g.turn !== null ? ownTurn ? 'Your turn' : `Waiting for ${name(g.turn)}` : 'Hand over'}</div>
    </div>{opponent(3)}</div>
      <div class="hand-area"><p class={`hand-caption${ownTurn ? ' your-turn' : ''}`}><strong class="you-label">You</strong><span>{room.seats[seat]?.name} · {ownTurn && g.phase === 'playing' ? 'Your turn to play' : 'Your hand'}</span></p>
        <div class="hand" aria-label="Your hand">{g.hands[seat]!.map(id => <Domino key={id} id={id} state={legal.has(id) && !pending ? 'legal' : 'idle'} onTap={() => { if (!pending && legal.has(id)) act({ type: 'play', domino: id }); }} />)}</div>
      </div>
    </div>
    {ownTurn && !pending && g.phase === 'bidding' && <BidSheet key={`${room.sessionId}:${room.revision}`} g={view} showHints={false} sessionId={room.sessionId} onQuestion={() => {}} dispatch={e => { if (e.type === 'human') act(e.action); }} />}
    {ownTurn && !pending && g.phase === 'declaring' && <DeclareSheet key={`${room.sessionId}:${room.revision}`} g={view} showHints={false} sessionId={room.sessionId} onQuestion={() => {}} dispatch={e => { if (e.type === 'human') act(e.action); }} />}
    {!holding && ['hand-over', 'game-over'].includes(g.phase) && <div class="overlay"><div class="card" role="dialog" aria-label={g.phase === 'game-over' ? 'Game over' : 'Hand over'}>
      <p class="eyebrow">Hand {g.handNumber} · Shared room</p><h2 class="card-title">{g.phase === 'game-over' ? g.winner === teamOf(seat) ? 'Your team won!' : 'Their team won' : g.handResult?.team === teamOf(seat) ? 'A mark for us' : 'A mark for them'}</h2>
      <p class="card-detail">{g.handResult?.reason}</p><div class="card-tallies"><Tally marks={view.marks[0]} label="Us" /><Tally marks={view.marks[1]} label="Them" /></div>
      {seat === 0 ? <button class="big-btn" disabled={!enabled || pending} onClick={() => g.phase === 'game-over' ? start() : act({ type: 'next-hand' })}>{g.phase === 'game-over' ? 'Start another game' : 'Shake the next hand'}</button> : <p>Waiting for the host to {g.phase === 'game-over' ? 'start another game' : 'shake the next hand'}.</p>}
      <p class="hint">Undo and replay are off in shared rooms.</p>
    </div></div>}
  </div>;
}
