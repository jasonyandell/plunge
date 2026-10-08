import { useEffect, useRef, useState } from 'preact/hooks';
import type { Action, Seat } from '../engine';
import { auctionMove } from '../ai/auction';
import { checkedAction, nativeMove, requestOf } from '../ai/native';
import { exportHistory, recordHistory, retryHistory } from '../history/recorder';
import { DEFAULT_SETTINGS, initialApp } from '../ui/store';
import type { ProposalKind, RoomCommand, RoomCredentials, RoomState, Vote } from './protocol';
import { CLOSE_EXPIRED, CLOSE_OTHER_TAB, CLOSE_SEAT_GONE } from './protocol';
import { ClosedTableError, enterRoom, forgetSeat, newVisitorId, RoomConnection, roomCode, roomFromHash, roomFromInput,
  savedSeat, saveSeat, type RoomIdentity } from './client';
import { RoomTable } from './RoomTable';
import { describeResult, VoteBar } from './VoteBar';
import '../ui/app.css';
import '../ui/home.css';
import './room.css';

export function roomHistory(room: RoomState, localSeat: Seat) {
  return { ...initialApp(), screen: 'table' as const, settings: { ...DEFAULT_SETTINGS, showHints: false, nelloPreview: room.game?.config.nello === 'open' },
    seed: room.seed, game: room.game, sessionId: room.sessionId, nativeReceipts: room.nativeReceipts, auctionSurveys: room.auctionSurveys,
    epoch: room.revision, retry: room.retry ?? null, practiceHands: room.practiceHands ?? [],
    room: { mode: 'shared-room' as const, localSeat, revision: room.revision,
      humans: room.seats.flatMap((s, seat) => s ? [{ seat: seat as Seat, name: s.name }] : []) },
  };
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistributiveOmit<RoomCommand, 'id'>;
type Timed = DistributiveOmit<Extract<RoomCommand, { revision: number }>, 'id' | 'revision'>;
/** Walt plays a seat with nobody present: empty, or absent past the grace. */
const waltDriven = (room: RoomState, seat: Seat) => !room.seats[seat] || room.seats[seat]!.away;
const presenceKey = (room: RoomState | null) => room ? `${room.runner}:${room.seats.map(s => s ? s.away ? 'a' : s.connected ? 'c' : 'd' : 'w').join('')}` : '';

export function Rooms() {
  const roomId = roomFromHash(location.hash);
  const [credentials, setCredentials] = useState<RoomCredentials | null>(() => {
    try { return roomId ? savedSeat(roomId, localStorage) : null; } catch { return null; }
  });
  const [knock, setKnock] = useState<{ visitor: string; name: string; roomId: string; sent: boolean; answer: string | null } | null>(null);
  const [name, setName] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [opening, setOpening] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [holding, setHolding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const leaving = useRef(false), joining = useRef(false);
  const connection = useRef<RoomConnection | null>(null);
  const current = useRef(room); current.current = room;
  const identity: RoomIdentity | null = credentials ?? (knock ? { roomId: knock.roomId, visitor: knock.visitor } : null);
  useEffect(() => {
    const failed = () => setHistoryError('A Walt result is only in this tab. Keep it open and export your history.');
    window.addEventListener('plunge-history-storage-error', failed);
    void retryHistory().catch(failed);
    return () => window.removeEventListener('plunge-history-storage-error', failed);
  }, []);
  useEffect(() => {
    if (!identity) { setRoom(null); setOnline(false); return; }
    const client = new RoomConnection(identity, { state: setRoom, status: setOnline, error: setError, pending: setPending,
      ended: (code, reason) => {
        if (code === CLOSE_OTHER_TAB) { setNotice(reason || 'This seat is open in another tab. Use that tab, or refresh this one.'); return; }
        if ('token' in identity) { try { forgetSeat(identity.roomId, localStorage); } catch { /* Nothing saved. */ } }
        if (code === CLOSE_SEAT_GONE && leaving.current) { location.assign(location.pathname); return; }
        setNotice(code === CLOSE_EXPIRED ? 'This room expired. Create a new one.' : reason || 'Your seat at this table is gone.');
        setCredentials(null); setKnock(null); setRoom(null);
      } });
    connection.current = client;
    return () => { client.close(); connection.current = null; };
  }, [credentials?.roomId, credentials?.token, knock?.visitor, retry]);
  useEffect(() => {
    if (!room) return;
    const remaining = room.holdUntil - Date.now();
    setHolding(remaining > 0);
    if (remaining > 0) { const t = setTimeout(() => setHolding(false), remaining + 50); return () => clearTimeout(t); }
    return undefined;
  }, [room?.holdUntil]);
  const send = (command: Draft): boolean => {
    setError(null);
    const sent = connection.current?.send({ ...command, id: crypto.randomUUID() } as RoomCommand) ?? false;
    if (!sent) setError('Reconnecting. Your game is saved; wait for the room to return.');
    return sent;
  };
  const sendAt = (command: Timed, revision: number | undefined) => {
    if (!current.current || revision === undefined) return;
    send({ ...command, revision } as Draft);
  };
  // Knocking: once the visitor connection is up, ask; then watch the table's answer.
  useEffect(() => {
    if (!knock || !room || !online || credentials || joining.current) return;
    if (room.open) { void sitDown(knock.name, knock.roomId).catch(e => setError(String(e).replace(/^Error: /, ''))); return; }
    if (!knock.sent) { if (send({ type: 'knock', name: knock.name })) setKnock({ ...knock, sent: true }); return; }
    const result = room.lastVote;
    if (result?.knock === knock.visitor && result.kind === 'admit') {
      if (result.outcome === 'passed') void sitDown(knock.name, knock.roomId, knock.visitor).catch(e => setError(String(e).replace(/^Error: /, '')));
      else if (!knock.answer) setKnock({ ...knock, answer: describeResult(result) });
    }
  }, [knock?.visitor, knock?.sent, room?.revision, online]);
  // Whoever is lowest at the table and present runs Walt for every seat without
  // a person. Presence changes cancel pending work; thinking updates do not.
  useEffect(() => {
    const at = current.current, g = at?.game;
    if (!at || !g || !credentials || !online || credentials.seat !== at.runner || holding || pending || g.turn === null
      || !waltDriven(at, g.turn) || !['bidding', 'declaring', 'playing'].includes(g.phase)) return;
    const seat = g.turn, revision = at.revision;
    const controller = new AbortController(); let live = true;
    setAiError(null);
    sendAt({ type: 'thinking', seat }, revision);
    const decide = async () => {
      if (g.phase === 'playing') {
        const receipt = await nativeMove(g, seat, 'native-partner', at.sessionId, controller.signal);
        return { action: checkedAction(g, requestOf(g, seat, at.sessionId), receipt), receiptId: receipt.id };
      }
      const decision = await auctionMove(g, seat, at.sessionId, at.auctionSurveys[`${g.handNumber}:${seat}`], controller.signal);
      return { action: decision.action, ...(decision.survey ? { auction: decision.survey } : {}) };
    };
    const t = setTimeout(() => void decide().then(result => {
      if (live && current.current?.revision === revision) sendAt({ type: 'action', seat, ...result }, revision);
    }).catch((e: unknown) => { if (live) { setAiError(`Walt stopped: ${String(e)}`); sendAt({ type: 'thinking', seat: null }, revision); } }), 350);
    return () => { live = false; clearTimeout(t); controller.abort(); };
  }, [room?.revision, presenceKey(room), credentials?.seat, online, holding, pending, retry]);
  useEffect(() => {
    if (!room?.game || !credentials) return;
    void recordHistory(roomHistory(room, credentials.seat)).then(() => setHistoryError(null))
      .catch(() => setHistoryError('History could not be saved. Keep this tab open and export a backup.'));
  }, [room?.sessionId, room?.revision, credentials?.seat]);
  const download = () => void exportHistory().then(data => {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `plunge-room-history-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }).catch(() => setHistoryError('History export failed. Keep this tab open and retry.'));
  const sitDown = async (who: string, target?: string, admitted?: string) => {
    if (joining.current) return;
    joining.current = true;
    try {
      const seat = await enterRoom(who, target, admitted);
      try { saveSeat(seat, localStorage); } catch { setError('This browser cannot save your seat. Keep this tab open; refreshing could lose access.'); }
      history.replaceState(null, '', `?rooms=1#room=${seat.roomId}`);
      setKnock(null); setNotice(null); setCredentials(seat);
    } finally { joining.current = false; }
  };
  const open = async (joining = false) => {
    if (opening) return;
    setOpening(true); setError(null); setNotice(null);
    const who = name.trim() || 'Player';
    try {
      const target = joining ? roomFromInput(joinInput, location.origin) : roomId;
      if (joining && !target) throw new Error('Paste the room code or an invite link from this Plunge app.');
      let restored: RoomCredentials | null = null;
      try { if (target) restored = savedSeat(target, localStorage); } catch { /* Joining still works when storage is unavailable. */ }
      if (restored) { history.replaceState(null, '', `?rooms=1#room=${restored.roomId}`); setCredentials(restored); return; }
      await sitDown(who, target ?? undefined);
    } catch (e) {
      if (e instanceof ClosedTableError && (joining ? roomFromInput(joinInput, location.origin) : roomId)) {
        const target = (joining ? roomFromInput(joinInput, location.origin) : roomId)!;
        history.replaceState(null, '', `?rooms=1#room=${target}`);
        setKnock({ visitor: newVisitorId(), name: who, roomId: target, sent: false, answer: null });
      } else setError(String(e).replace(/^Error: /, ''));
    }
    finally { setOpening(false); }
  };
  const invite = identity ? `${location.origin}${location.pathname}?rooms=1#room=${identity.roomId}` : '';
  const share = () => {
    setInviteOpen(true);
    void navigator.clipboard?.writeText(invite).then(() => setCopied(true)).catch(() => setCopied(false));
  };
  // Capture the rendered revision: a tap from before a takeback stays stale,
  // even when the restored position offers the identical move again.
  const act = (action: Action) => { if (online && !pending && !holding) sendAt({ type: 'action', action }, room?.revision); };
  const propose = (kind: ProposalKind, target?: Seat) => {
    if (!online || pending || room?.proposal) return;
    sendAt(target === undefined ? { type: 'propose', kind } : { type: 'propose', kind, target }, room?.revision);
    setTableOpen(false);
  };
  const vote = (choice: Vote) => { if (online && room?.proposal) send({ type: 'vote', proposal: room.proposal.id, vote: choice }); };
  const leave = () => {
    if (!credentials || !confirm('Leave the table? Walt plays your chair, and anyone can sit there next.')) return;
    leaving.current = true;
    if (!send({ type: 'leave' })) { try { forgetSeat(credentials.roomId, localStorage); } catch { /* Nothing saved. */ } location.assign(location.pathname); }
  };
  const people = room?.seats.filter(Boolean).length ?? 0;
  const pause = identity && !online ? 'Reconnecting… Your game and seat are saved.' : null;
  const lastVote = room?.lastVote && room.revision - room.lastVote.revision < 3 ? room.lastVote : null;
  return <div class="rooms">
    {!identity ? <div class="home"><div class="home-card"><p class="eyebrow">Plunge · Experimental</p><h1 class="title">Play with family</h1>
      <p class="room-intro">{roomId ? 'Pull up a chair at this family table. Come and go as you like; Walt covers an empty chair.' : 'Invite your family. Walt fills the empty chairs.'}</p>
      {notice && <p class="room-notice" role="status">{notice}</p>}
      <form onSubmit={e => { e.preventDefault(); void open(); }}><label class="room-label">Your name<input maxLength={20} value={name} onInput={e => setName(e.currentTarget.value)} autoComplete="nickname" placeholder="Name at the table" /></label>
        <button class="big-btn" disabled={opening}>{opening ? 'Opening…' : roomId ? 'Join the table' : 'Open a family table'}</button></form>
      <p class="setting-hint">No account needed. Share the invite only with your group.</p>
      {!roomId && <form class="room-join" onSubmit={e => { e.preventDefault(); void open(true); }}>
        <label class="room-label">Room code or invite link<input value={joinInput} onInput={e => setJoinInput(e.currentTarget.value)} autoCapitalize="none" autoCorrect="off" spellcheck={false} placeholder="Paste from your family" /></label>
        <button class="big-btn secondary" disabled={opening || !joinInput.trim()}>Join a family table</button>
        <p class="setting-hint">Already using the Plunge app? Paste the code here to stay in this app.</p>
      </form>}
      <a class="text-btn" href={location.pathname}>Back to solo play</a>
    </div></div> : <>
      <div class="room-bar"><span>Family table <small>{room ? room.open ? 'Open · anyone with the link can sit' : 'Closed · knock to come in' : 'Experimental'}</small></span>
        {credentials && room?.game && <button onClick={() => propose('undo')} disabled={!online || pending || !room.canUndo || !!room.proposal} title="Take back the last human move for everyone">Undo</button>}
        <button onClick={share}>Invite</button>
        {credentials && <button onClick={() => setTableOpen(true)} aria-label="Table">Table</button>}
        {credentials ? <button onClick={leave}>Leave</button> : <a class="room-bar-link" href={location.pathname}>Back</a>}</div>
      {pause && <div class="room-pause" role="status">{pause}</div>}
      {notice && <div class="room-pause" role="status">{notice}</div>}
      {room?.proposal && <VoteBar proposal={room.proposal} seat={credentials?.seat ?? null} seats={room.seats} vote={vote} pending={pending} />}
      {!room?.proposal && lastVote && <div class="room-takeback" role="status" data-vote-revision={lastVote.revision}>{describeResult(lastVote)}</div>}
      {room?.lastUndo && !lastVote && <div class="room-takeback" role="status" data-undo-revision={room.lastUndo.revision}>Takeback · Back to before {room.lastUndo.name}’s last move, for everyone.</div>}
      {!room ? <div class="room-wait" role="status">Connecting to the table…</div>
        : knock && !credentials ? <div class="room-wait"><div class="home-card"><p class="eyebrow">Closed table</p><h1 class="sheet-title">Knocking…</h1>
          <p>{knock.answer ?? (room.proposal?.knock === knock.visitor ? 'Anyone at the table can let you in.' : knock.sent ? 'Waiting for the table.' : 'Asking to come in.')}</p>
          <div class="room-chairs">{[0,2,1,3].map(s => <div key={s}><strong>{room.seats[s]?.name ?? 'Walt'}</strong><span>{room.seats[s] ? room.seats[s]!.connected ? 'Here' : 'Away' : 'Open chair'}</span></div>)}</div>
          {knock.answer && <button class="big-btn" onClick={() => setKnock({ ...knock, sent: false, answer: null })}>Knock again</button>}
          <a class="text-btn" href={location.pathname}>Back to solo play</a>
        </div></div>
        : room.game && credentials ? <RoomTable room={room} seat={credentials.seat} enabled={online} holding={holding} thinking={room.thinkingSeat} act={act} propose={propose} pending={pending} />
        : <div class="room-wait"><div class="home-card"><p class="eyebrow">Your family table</p><h1 class="sheet-title">Pull up a chair</h1>
          <p>You are {room.seats[credentials!.seat]?.name}. Anyone here can start; the table gets five seconds to object. People can join or leave any time, and Walt plays an empty chair.</p>
          <div class="room-chairs">{[0,2,1,3].map(s => <div key={s}><strong>{room.seats[s]?.name ?? 'Walt'}</strong><span>{s === credentials!.seat ? 'You' : s === (credentials!.seat + 2) % 4 ? 'Your partner' : 'Across the table'}{room.seats[s] && !room.seats[s]!.connected ? ' · Away' : ''}</span></div>)}</div>
          <button class="big-btn secondary" onClick={share}>Copy invite link</button>
          <button class="big-btn" disabled={!online || pending || !!room.proposal} onClick={() => propose('start')}>Start with {people} {people === 1 ? 'person' : 'people'} + Walt</button>
          <p class="setting-hint">Refreshing rejoins this seat. Undo, kicking, starting over and opening or closing the table are all quick votes.</p>
          <p class="setting-hint">For Nel-O, win a bid of 1 mark or more, then choose Nel-O. The bidder’s partner sits out. Rooms last up to 24 hours without activity.</p>
        </div></div>}
    </>}
    {tableOpen && room && credentials && <div class="overlay room-invite"><div class="card" role="dialog" aria-label="Table"><h2 class="sheet-title">The table</h2>
      <p class="hint">Everything here is a vote. {room.proposal ? 'The table is deciding something now.' : 'Low stakes go ahead unless someone says no within five seconds.'}</p>
      <div class="room-people">{[0,2,1,3].map(s => { const person = room.seats[s]; return <div key={s} class="room-person"><span><strong>{person?.name ?? 'Walt'}</strong>{s === credentials.seat ? ' · You' : person ? person.away ? ' · Walt is playing' : person.connected ? ' · Here' : ' · Rejoining' : ''}</span>
        {person && s !== credentials.seat && <button class="text-btn" disabled={!online || pending || !!room.proposal} onClick={() => propose('kick', s as Seat)}>Ask to step out</button>}</div>; })}</div>
      <button class="big-btn secondary" disabled={!online || pending || !!room.proposal} onClick={() => propose(room.open ? 'close' : 'open')}>{room.open ? 'Close the table' : 'Open the table'}</button>
      <p class="hint">{room.open ? 'Anyone with the invite can sit down.' : 'Newcomers knock; one yes from anyone here lets them in.'}</p>
      {room.game && <button class="big-btn secondary" disabled={!online || pending || !!room.proposal} onClick={() => propose('restart')}>Start over</button>}
      <button class="big-btn secondary" onClick={download}>Export history</button>
      <button class="big-btn" onClick={() => setTableOpen(false)}>Back to the table</button></div></div>}
    {inviteOpen && <div class="overlay room-invite"><div class="card" role="dialog" aria-label="Invite family"><h2 class="sheet-title">Invite your family</h2><p>Open this link on another phone. The first guest is your partner.</p>
      <label class="room-label">Invite link<input aria-label="Invite link" value={invite} readOnly onFocus={e => e.currentTarget.select()} /></label>
      <label class="room-label">Room code<input aria-label="Room code" value={identity ? roomCode(identity.roomId) : ''} readOnly onFocus={e => e.currentTarget.select()} /></label>
      <button class="big-btn secondary" onClick={() => void navigator.clipboard?.writeText(roomCode(identity!.roomId)).then(() => setCopied(true)).catch(() => setCopied(false))}>Copy room code</button>
      <p class="hint">In the existing Plunge app, choose Play with family and paste this code. No second install needed.</p>
      <p class="hint">{copied ? 'Copied. Paste it into your family conversation.' : 'Select and copy the link or room code to share it.'}</p>
      <button class="big-btn" onClick={() => setInviteOpen(false)}>Back to the table</button></div></div>}
    {error && <div class="room-error" role="alert"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    {aiError && <div class="room-error" role="alert"><span>{aiError}</span><button onClick={() => { setAiError(null); setRetry(n => n + 1); }}>Retry Walt</button></div>}
    {historyError && <div class="room-error" role="alert"><span>{historyError}</span><button onClick={() => void retryHistory().then(() => setHistoryError(null)).catch(() => {})}>Retry saving</button><button onClick={download}>Export</button></div>}
  </div>;
}
