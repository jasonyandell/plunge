import { useEffect, useRef, useState } from 'preact/hooks';
import type { Action, Seat } from '../engine';
import { auctionMove } from '../ai/auction';
import { checkedAction, nativeMove, requestOf } from '../ai/native';
import { exportHistory, recordHistory, retryHistory } from '../history/recorder';
import { DEFAULT_SETTINGS, initialApp } from '../ui/store';
import type { RoomCommand, RoomCredentials, RoomState } from './protocol';
import { enterRoom, RoomConnection, roomFromHash, savedSeat, saveSeat } from './client';
import { RoomTable } from './RoomTable';
import '../ui/app.css';
import '../ui/home.css';
import './room.css';

export function roomHistory(room: RoomState, localSeat: Seat) {
  return { ...initialApp(), screen: 'table' as const, settings: { ...DEFAULT_SETTINGS, showHints: false },
    seed: room.seed, game: room.game, sessionId: room.sessionId, nativeReceipts: room.nativeReceipts, auctionSurveys: room.auctionSurveys,
    room: { mode: 'shared-room' as const, localSeat, revision: room.revision,
      humans: room.seats.flatMap((s, seat) => s ? [{ seat: seat as Seat, name: s.name }] : []) },
  };
}
export function Rooms() {
  const roomId = roomFromHash(location.hash);
  const [credentials, setCredentials] = useState<RoomCredentials | null>(() => {
    try { return roomId ? savedSeat(roomId, localStorage) : null; } catch { return null; }
  });
  const [name, setName] = useState('');
  const [opening, setOpening] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [holding, setHolding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const connection = useRef<RoomConnection | null>(null);
  const current = useRef(room); current.current = room;
  useEffect(() => {
    const failed = () => setHistoryError('A Walt result is only in this tab. Keep it open and export your history.');
    window.addEventListener('plunge-history-storage-error', failed);
    void retryHistory().catch(failed);
    return () => window.removeEventListener('plunge-history-storage-error', failed);
  }, []);
  useEffect(() => {
    if (!credentials) return;
    const client = new RoomConnection(credentials, { state: setRoom, status: setOnline, error: setError, pending: setPending });
    connection.current = client;
    return () => { client.close(); connection.current = null; };
  }, [credentials?.roomId, credentials?.token, retry]);
  useEffect(() => {
    if (!room) return;
    const remaining = room.holdUntil - Date.now();
    setHolding(remaining > 0);
    if (remaining > 0) { const t = setTimeout(() => setHolding(false), remaining + 50); return () => clearTimeout(t); }
    return undefined;
  }, [room?.holdUntil]);
  const allConnected = online && !!room?.hostConnected && room.seats.every(s => !s || s.connected);
  const send = (command: Omit<RoomCommand, 'id' | 'revision'>) => {
    const at = current.current;
    if (!at) return;
    setError(null);
    if (!connection.current?.send({ ...command, id: crypto.randomUUID(), revision: at.revision } as RoomCommand)) setError('Reconnecting. Your game is saved; wait for the room to return.');
  };
  // Only the host runs Walt, and only for empty seats. Presence changes cancel
  // pending work, while heartbeat/thinking updates keep the same revision.
  useEffect(() => {
    const at = current.current, g = at?.game;
    if (!at || !g || credentials?.seat !== 0 || !allConnected || holding || pending || g.turn === null || at.seats[g.turn]
      || !['bidding', 'declaring', 'playing'].includes(g.phase)) return;
    const seat = g.turn, revision = at.revision;
    const controller = new AbortController(); let live = true;
    setAiError(null);
    send({ type: 'thinking', seat });
    const decide = async () => {
      if (g.phase === 'playing') {
        const receipt = await nativeMove(g, seat, 'native-partner', at.sessionId, controller.signal);
        return { action: checkedAction(g, requestOf(g, seat, at.sessionId), receipt), receiptId: receipt.id };
      }
      const decision = await auctionMove(g, seat, at.sessionId, at.auctionSurveys[`${g.handNumber}:${seat}`], controller.signal);
      return { action: decision.action, ...(decision.survey ? { auction: decision.survey } : {}) };
    };
    const t = setTimeout(() => void decide().then(result => {
      if (live && current.current?.revision === revision) send({ type: 'action', seat, ...result });
    }).catch((e: unknown) => { if (live) { setAiError(`Walt stopped: ${String(e)}`); send({ type: 'thinking', seat: null }); } }), 350);
    return () => { live = false; clearTimeout(t); controller.abort(); };
  }, [room?.revision, credentials?.seat, allConnected, holding, pending, retry]);
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
  const open = async () => {
    if (opening) return;
    setOpening(true); setError(null);
    try {
      const seat = await enterRoom(name.trim() || 'Player', roomId ?? undefined);
      try { saveSeat(seat, localStorage); } catch { setError('This browser cannot save your seat. Keep this tab open; refreshing could lose access.'); }
      history.replaceState(null, '', `?rooms=1#room=${seat.roomId}`);
      setCredentials(seat);
    } catch (e) { setError(String(e).replace(/^Error: /, '')); }
    finally { setOpening(false); }
  };
  const invite = credentials ? `${location.origin}${location.pathname}?rooms=1#room=${credentials.roomId}` : '';
  const share = () => {
    setInviteOpen(true);
    void navigator.clipboard?.writeText(invite).then(() => setCopied(true)).catch(() => setCopied(false));
  };
  const act = (action: Action) => { if (allConnected && !pending && !holding) send({ type: 'action', action }); };
  const start = () => { if (allConnected && !pending) send({ type: 'start' }); };
  const pause = !online ? 'Reconnecting… Your game and seat are saved.' : !room?.hostConnected
    ? 'Waiting for the host. The host must keep this room open; play resumes when they return.'
    : !allConnected ? `Waiting for ${room?.seats.filter(s => s && !s.connected).map(s => s!.name).join(', ')} to rejoin. Their seats are saved.` : null;
  return <div class="rooms">
    {!credentials ? <div class="home"><div class="home-card"><p class="eyebrow">Plunge · Experimental</p><h1 class="title">Play together</h1>
      <p class="room-intro">{roomId ? 'Pull up a chair in this private room.' : 'Invite your family. Walt fills the empty chairs.'}</p>
      <form onSubmit={e => { e.preventDefault(); void open(); }}><label class="room-label">Your name<input maxLength={20} value={name} onInput={e => setName(e.currentTarget.value)} autoComplete="nickname" placeholder="Name at the table" /></label>
        <button class="big-btn" disabled={opening}>{opening ? 'Opening…' : roomId ? 'Join room' : 'Create a private room'}</button></form>
      <p class="setting-hint">No account needed. The host keeps this page open to run Walt. Share the invite only with your group.</p>
      <a class="text-btn" href={location.pathname}>Back to solo play</a>
    </div></div> : <>
      <div class="room-bar"><span>Shared room <small>Experimental</small></span><button onClick={share}>Invite</button><button onClick={download} aria-label="Export room history">Export</button><button onClick={() => { if (confirm('Leave the room? Your seat is saved here. Others will wait until you return.')) location.assign(location.pathname); }}>Leave</button></div>
      {pause && <div class="room-pause" role="status">{pause}</div>}
      {!room ? <div class="room-wait" role="status">Connecting to your room…</div> : room.game ? <RoomTable room={room} seat={credentials.seat} enabled={allConnected} holding={holding} thinking={room.thinkingSeat} act={act} start={start} pending={pending} /> :
        <div class="room-wait"><div class="home-card"><p class="eyebrow">Your private table</p><h1 class="sheet-title">Pull up a chair</h1>
          <p>You are {room.seats[credentials.seat]?.name}. {credentials.seat === 0 ? 'Invite your family, then start when everyone is here.' : 'The host will start when everyone is here.'}</p>
          <div class="room-chairs">{[0,2,1,3].map(s => <div key={s}><strong>{room.seats[s]?.name ?? 'Walt'}</strong><span>{s === credentials.seat ? 'You' : s === (credentials.seat + 2) % 4 ? 'Your partner' : 'Across the table'}{s === 0 ? ' · Host' : ''}</span></div>)}</div>
          <button class="big-btn secondary" onClick={share}>Copy invite link</button>
          {credentials.seat === 0 && <button class="big-btn" disabled={!allConnected || pending} onClick={start}>Start with {room.seats.filter(Boolean).length} {room.seats.filter(Boolean).length === 1 ? 'person' : 'people'} + Walt</button>}
          <p class="setting-hint">Keep the host's screen awake. Refreshing rejoins this seat. Undo and replay are off. Rooms last up to 24 hours without activity.</p>
        </div></div>}
    </>}
    {inviteOpen && <div class="overlay room-invite"><div class="card" role="dialog" aria-label="Invite family"><h2 class="sheet-title">Invite your family</h2><p>Open this link on another phone. The first guest is your partner.</p>
      <label class="room-label">Invite link<input aria-label="Invite link" value={invite} readOnly onFocus={e => e.currentTarget.select()} /></label>
      <p class="hint">{copied ? 'Link copied. Paste it into your family conversation.' : 'Select and copy the link to share it.'}</p>
      <button class="big-btn" onClick={() => setInviteOpen(false)}>Back to the table</button></div></div>}
    {error && <div class="room-error" role="alert"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    {aiError && <div class="room-error" role="alert"><span>{aiError}</span><button onClick={() => { setAiError(null); setRetry(n => n + 1); }}>Retry Walt</button></div>}
    {historyError && <div class="room-error" role="alert"><span>{historyError}</span><button onClick={() => void retryHistory().then(() => setHistoryError(null)).catch(() => {})}>Retry saving</button><button onClick={download}>Export</button></div>}
  </div>;
}
