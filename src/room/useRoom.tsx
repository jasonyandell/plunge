/**
 * A shared family table inside the ordinary app. The store holds the
 * coordinator's game rotated so you are seat 0, so hints, questions, review,
 * history and settings all work unchanged. This hook owns what is different:
 * the socket, who runs Walt, routing your decisions to the room instead of
 * the reducer, and the chrome around the felt (votes, seats, doors).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Action, Seat } from '../engine';
import { auctionMove } from '../ai/auction';
import { checkedAction, nativeMove, requestOf } from '../ai/native';
import { exportHistory, recordHistory, retryHistory } from '../history/recorder';
import { setSeatNames, type AppEvent, type AppState } from '../ui/store';
import type { ProposalKind, RoomCommand, RoomCredentials, RoomState, Vote } from './protocol';
import { CLOSE_EXPIRED, CLOSE_OTHER_TAB, CLOSE_SEAT_GONE } from './protocol';
import { ClosedTableError, enterRoom, familyProbe, forgetSeat, newVisitorId, RoomConnection, roomCode, roomFromHash, roomFromInput,
  ROOMS_ENABLED, savedSeat, saveSeat, type RoomIdentity } from './client';
import { relativeSeat, roomHistory } from './view';
import { describeResult, VoteBar } from './VoteBar';
import { rememberTableName, tableName, whoAmI } from '../account/me';
import './room.css';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistributiveOmit<RoomCommand, 'id'>;
type Timed = DistributiveOmit<Extract<RoomCommand, { revision: number }>, 'id' | 'revision'>;
/** Walt plays a seat with nobody present: empty, or absent past the grace. */
const waltDriven = (room: RoomState, seat: Seat) => !room.seats[seat] || room.seats[seat]!.away;
const NUDGED = 'plunge:offered-sign-in';
const presenceKey = (room: RoomState | undefined) => room ? `${room.runner}:${room.seats.map(s => s ? s.away ? 'a' : s.connected ? 'c' : 'd' : 'w').join('')}` : '';
/** Who is playing a seat right now: the person, Walt for an absent person, or Walt. */
export function seatLabel(room: RoomState, s: Seat): string {
  const seat = room.seats[s];
  if (!seat) return `Walt ${s + 1}`;
  return seat.away ? `${seat.name} (Walt)` : seat.name;
}
export const roomActive = (search = location.search): boolean => ROOMS_ENABLED && new URLSearchParams(search).has('rooms');

export interface RoomShell {
  /** This page is a shared table (or its doorway); the solo save is left alone. */
  active: boolean;
  /** The app's dispatch, with decisions routed to the room while seated. */
  dispatch: (e: AppEvent) => void;
  /** Above the felt: the room bar, an open vote, the last result. */
  chrome: ComponentChildren;
  /** Instead of the felt while there is nothing to show: doorway, lobby, knocking. */
  screen: ComponentChildren;
  /** Dialogs and toasts over everything. */
  overlays: ComponentChildren;
  /** Something for the table's menu. */
  menu: ComponentChildren;
  /** Seat whose Walt think is in flight, as the rotated table sees it. */
  thinking: Seat | null;
  /** A note under a rotated seat's name: rejoining, or Walt covering. */
  seatNote: (seat: Seat) => string | null;
}

export function useRoom(app: AppState, reduce: (e: AppEvent) => void): RoomShell {
  const active = roomActive();
  const roomId = active ? roomFromHash(location.hash) : null;
  const [credentials, setCredentials] = useState<RoomCredentials | null>(() => {
    try { return roomId ? savedSeat(roomId, localStorage) : null; } catch { return null; }
  });
  const [knock, setKnock] = useState<{ visitor: string; name: string; roomId: string; sent: boolean; answer: string | null } | null>(null);
  const [visitorRoom, setVisitorRoom] = useState<RoomState | null>(null);
  const [name, setName] = useState(tableName);
  /** Signed in: the coordinator seats this person under their account name. Family also lists the tables they open. */
  const [member, setMember] = useState<string | null | undefined>(undefined); // undefined: not asked yet
  const [family, setFamily] = useState(false);
  useEffect(() => { let live = true; void familyProbe().then(value => { if (live) { setMember(value.name ?? null); setFamily(value.family); } }); return () => { live = false; }; }, []);
  /** Signed out where accounts exist: after a hand, one quiet offer to keep the name and hands. Never again once dismissed. */
  const [offerSignIn, setOfferSignIn] = useState(false);
  useEffect(() => { let live = true; void whoAmI().then(me => { try { if (live && me === null && !localStorage.getItem(NUDGED)) setOfferSignIn(true); } catch { /* No offer without storage to remember the answer. */ } }); return () => { live = false; }; }, []);
  const dismissOffer = () => { setOfferSignIn(false); try { localStorage.setItem(NUDGED, '1'); } catch { /* Gone for this visit. */ } };
  const [joinInput, setJoinInput] = useState('');
  const [opening, setOpening] = useState(false);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const leaving = useRef(false), joining = useRef(false);
  /** Commands Walt's runner sent on the table's behalf: a stale one is not the person's mistake. */
  const quiet = useRef(new Set<string>());
  const connection = useRef<RoomConnection | null>(null);
  const table = credentials ? app.room?.table : undefined;
  const current = useRef(table); current.current = table;
  const seat = credentials?.seat ?? null;
  const identity: RoomIdentity | null = credentials ?? (knock ? { roomId: knock.roomId, visitor: knock.visitor } : null);

  useEffect(() => {
    if (!active) return;
    const failed = () => setHistoryError('A Walt result is only in this tab. Keep it open and export your history.');
    window.addEventListener('plunge-history-storage-error', failed);
    void retryHistory().catch(failed);
    return () => window.removeEventListener('plunge-history-storage-error', failed);
  }, [active]);
  // Sitting down: the store waits for the first snapshot; standing up clears it.
  useEffect(() => {
    if (credentials) reduce({ type: 'room-enter', localSeat: credentials.seat });
    else if (app.room) reduce({ type: 'room-exit' });
  }, [credentials?.roomId, credentials?.token]);
  useEffect(() => {
    if (!identity) { setVisitorRoom(null); setOnline(false); return; }
    const mine = credentials;
    const client = new RoomConnection(identity, {
      state: state => mine ? reduce({ type: 'room-snapshot', state, localSeat: mine.seat }) : setVisitorRoom(state),
      status: setOnline, pending: setPending,
      error: (message, id) => { if (id && quiet.current.delete(id)) return; setError(message); },
      ended: (code, reason) => {
        if (code === CLOSE_OTHER_TAB) { setNotice(reason || 'This seat is open in another tab. Use that tab, or refresh this one.'); return; }
        if ('token' in identity) { try { forgetSeat(identity.roomId, localStorage); } catch { /* Nothing saved. */ } }
        if (code === CLOSE_SEAT_GONE && leaving.current) { location.assign(location.pathname); return; }
        setNotice(code === CLOSE_EXPIRED ? 'This room expired. Create a new one.' : reason || 'Your seat at this table is gone.');
        setCredentials(null); setKnock(null);
      } });
    connection.current = client;
    return () => { client.close(); connection.current = null; };
  }, [credentials?.roomId, credentials?.token, knock?.visitor, retry]);
  // Names as this phone sees them: you at the bottom, then clockwise.
  useEffect(() => {
    if (!table || seat === null) { setSeatNames(null); return; }
    setSeatNames([0, 1, 2, 3].map(r => r === 0 ? 'You' : seatLabel(table, ((seat + r) % 4) as Seat)) as [string, string, string, string]);
    return () => setSeatNames(null);
  }, [table?.revision, presenceKey(table), seat]);
  const send = (command: Draft): boolean => {
    setError(null);
    const sent = connection.current?.send({ ...command, id: crypto.randomUUID() } as RoomCommand) ?? false;
    if (!sent) setError('Reconnecting. Your game is saved; wait for the room to return.');
    return sent;
  };
  const sendAt = (command: Timed, revision: number | undefined, silent = false) => {
    if (!current.current || revision === undefined) return;
    const id = crypto.randomUUID();
    if (silent) quiet.current.add(id);
    if (!(connection.current?.send({ ...command, revision, id } as RoomCommand) ?? false)) { quiet.current.delete(id); if (!silent) setError('Reconnecting. Your game is saved; wait for the room to return.'); }
    else if (!silent) setError(null);
  };
  const sitDown = async (who: string, target?: string, admitted?: string) => {
    if (joining.current) return;
    joining.current = true;
    try {
      const got = await enterRoom(who, target, admitted);
      try { saveSeat(got, localStorage); } catch { setError('This browser cannot save your seat. Keep this tab open; refreshing could lose access.'); }
      history.replaceState(null, '', `?rooms=1#room=${got.roomId}`);
      setKnock(null); setNotice(null); setCredentials(got);
    } finally { joining.current = false; }
  };
  // Knocking: once the visitor connection is up, ask; then watch the table's answer.
  useEffect(() => {
    if (!knock || !visitorRoom || !online || credentials || joining.current) return;
    if (visitorRoom.open) { void sitDown(knock.name, knock.roomId).catch(e => setError(String(e).replace(/^Error: /, ''))); return; }
    if (!knock.sent) { if (send({ type: 'knock', name: knock.name })) setKnock({ ...knock, sent: true }); return; }
    const result = visitorRoom.lastVote;
    if (result?.knock === knock.visitor && result.kind === 'admit') {
      if (result.outcome === 'passed') void sitDown(knock.name, knock.roomId, knock.visitor).catch(e => setError(String(e).replace(/^Error: /, '')));
      else if (!knock.answer) setKnock({ ...knock, answer: describeResult(result) });
    }
  }, [knock?.visitor, knock?.sent, visitorRoom?.revision, online]);
  const holding = !!table && table.holdUntil > Date.now();
  // Whoever is lowest at the table and present runs Walt for every seat
  // without a person. Presence changes cancel pending work; thinking updates do not.
  useEffect(() => {
    const at = current.current, g = at?.game;
    if (!at || !g || !credentials || !online || credentials.seat !== at.runner || app.showTrick || pending || g.turn === null
      || !waltDriven(at, g.turn) || !['bidding', 'declaring', 'playing'].includes(g.phase)) return;
    const turn = g.turn, revision = at.revision;
    const controller = new AbortController(); let live = true;
    setAiError(null);
    sendAt({ type: 'thinking', seat: turn }, revision, true);
    const decide = async () => {
      if (g.phase === 'playing') {
        const receipt = await nativeMove(g, turn, 'native-partner', at.sessionId, controller.signal);
        return { action: checkedAction(g, requestOf(g, turn, at.sessionId), receipt), receiptId: receipt.id };
      }
      const decision = await auctionMove(g, turn, at.sessionId, at.auctionSurveys[`${g.handNumber}:${turn}`], controller.signal);
      return { action: decision.action, ...(decision.survey ? { auction: decision.survey } : {}) };
    };
    const t = setTimeout(() => void decide().then(result => {
      if (live && current.current?.revision === revision) sendAt({ type: 'action', seat: turn, ...result }, revision, true);
    }).catch((e: unknown) => { if (live) { setAiError(`Walt stopped: ${String(e)}`); sendAt({ type: 'thinking', seat: null }, revision, true); } }), 350);
    return () => { live = false; clearTimeout(t); controller.abort(); };
  }, [table?.revision, presenceKey(table), credentials?.seat, online, app.showTrick, pending, retry]);
  // History keeps canonical seats, as the recorder expects.
  useEffect(() => {
    if (!table?.game || !credentials) return;
    void recordHistory(roomHistory(table, credentials.seat)).then(() => setHistoryError(null))
      .catch(() => setHistoryError('History could not be saved. Keep this tab open and export a backup.'));
  }, [table?.sessionId, table?.revision, credentials?.seat]);
  const download = () => void exportHistory().then(data => {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `plunge-room-history-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }).catch(() => setHistoryError('History export failed. Keep this tab open and retry.'));
  const open = async (joining2 = false) => {
    if (opening) return;
    setOpening(true); setError(null); setNotice(null);
    const who = member || (name.trim() || 'Player');
    if (!member) rememberTableName(name);
    const target = joining2 ? roomFromInput(joinInput, location.origin) : roomId;
    try {
      if (joining2 && !target) throw new Error('Paste the room code or an invite link from this Plunge app.');
      let restored: RoomCredentials | null = null;
      try { if (target) restored = savedSeat(target, localStorage); } catch { /* Joining still works when storage is unavailable. */ }
      if (restored) { history.replaceState(null, '', `?rooms=1#room=${restored.roomId}`); setCredentials(restored); return; }
      await sitDown(who, target ?? undefined);
    } catch (e) {
      if (e instanceof ClosedTableError && target) {
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
  const act = (action: Action) => { if (online && !pending && !holding) sendAt({ type: 'action', action }, table?.revision); };
  const propose = (kind: ProposalKind, target?: Seat) => {
    if (!online || pending || table?.proposal) return;
    sendAt(target === undefined ? { type: 'propose', kind } : { type: 'propose', kind, target }, table?.revision);
    setTableOpen(false);
  };
  const vote = (choice: Vote) => { if (online && table?.proposal) send({ type: 'vote', proposal: table.proposal.id, vote: choice }); };
  const agreeOr = (kind: ProposalKind) => {
    const open = table?.proposal;
    if (open?.kind === kind && seat !== null && open.votes[seat] === undefined) vote('yes'); else propose(kind);
  };
  const leave = () => {
    if (!credentials || !confirm('Leave the table? Walt plays your chair, and anyone can sit there next.')) return;
    leaving.current = true;
    if (!send({ type: 'leave' })) { try { forgetSeat(credentials.roomId, localStorage); } catch { /* Nothing saved. */ } location.assign(location.pathname); }
  };
  // Your decisions go to the room; everything local (hints, screens) stays local.
  const dispatch = (e: AppEvent): void => {
    if (!active) { reduce(e); return; }
    switch (e.type) {
      // Tapping the same button as the person who asked is the second yes.
      case 'human': if (!table) return; if (e.action.type === 'next-hand') agreeOr('next-hand'); else act(e.action); return;
      case 'new-game': if (table) agreeOr('start'); return;
      case 'undo': if (table) propose('undo'); return;
      case 'restart-hand': return;
      case 'go': if (e.screen === 'home') { location.assign(location.pathname); return; } reduce(e); return;
      default: reduce(e);
    }
  };
  const abs = (relative: Seat): Seat => seat === null ? relative : ((seat + relative) % 4) as Seat;
  const seatNote = (relative: Seat): string | null => {
    const person = table?.seats[abs(relative)];
    if (!person || relative === 0) return null;
    if (person.away) return 'Walt is playing';
    if (!person.connected) return 'Rejoining';
    return null;
  };
  const thinking = table?.thinkingSeat === null || table?.thinkingSeat === undefined || seat === null ? null : relativeSeat(table.thinkingSeat, seat);
  if (!active) return { active, dispatch, chrome: null, screen: null, overlays: null, menu: null, thinking: null, seatNote: () => null };

  const shown = credentials ? table : visitorRoom;
  const people = shown?.seats.filter(Boolean).length ?? 0;
  const lastVote = shown?.lastVote && shown.revision - shown.lastVote.revision < 3 ? shown.lastVote : null;
  const waitingOn = table?.game?.turn !== null && table?.game?.turn !== undefined && table.seats[table.game.turn]
    && !table.seats[table.game.turn]!.connected && !table.seats[table.game.turn]!.away ? table.seats[table.game.turn]!.name : null;
  const chrome = identity ? <>
    <div class="room-bar"><span>Family table <small>{shown ? shown.open ? 'Open · anyone with the link can sit' : 'Closed · knock to come in' : 'Experimental'}</small></span>
      <button onClick={share}>Invite</button>
      {credentials && <button onClick={() => setTableOpen(true)} aria-label="Table">Table</button>}
      {credentials ? <button onClick={leave}>Leave</button> : <a class="room-bar-link" href={location.pathname}>Back</a>}</div>
    {!online && <div class="room-pause" role="status">Reconnecting… Your game and seat are saved.</div>}
    {notice && <div class="room-pause" role="status">{notice}</div>}
    {waitingOn && !shown?.proposal && <div class="room-pause" role="status">Waiting a moment for {waitingOn} to come back…</div>}
    {shown?.proposal && <VoteBar proposal={shown.proposal} seat={seat} seats={shown.seats} vote={vote} pending={pending} />}
    {!shown?.proposal && lastVote && <div class="room-takeback" role="status" data-vote-revision={lastVote.revision}>{describeResult(lastVote)}</div>}
    {shown?.lastUndo && !lastVote && !shown.proposal && <div class="room-takeback" role="status" data-undo-revision={shown.lastUndo.revision}>Takeback · Back to before {shown.lastUndo.name}’s last move, for everyone.</div>}
    {offerSignIn && credentials && (table?.game?.phase === 'hand-over' || table?.game?.phase === 'game-over') && <div class="room-offer">
      <a href="?account=1">Keep your name and the hands you play here? Sign in →</a><button onClick={dismissOffer}>Not now</button></div>}
  </> : null;
  const screen = !identity ? <div class="home"><div class="home-card"><p class="eyebrow">Plunge · Experimental</p><h1 class="title">Play with family</h1>
      <p class="room-intro">{roomId ? 'Pull up a chair at this family table. Come and go as you like; Walt covers an empty chair.' : 'Invite your family. Walt fills the empty chairs.'}</p>
      {notice && <p class="room-notice" role="status">{notice}</p>}
      <form onSubmit={e => { e.preventDefault(); void open(); }}>{member === null && <label class="room-label">Your name<input maxLength={20} value={name} onInput={e => setName(e.currentTarget.value)} autoComplete="nickname" placeholder="Name at the table" /></label>}
        <button class="big-btn" disabled={opening || member === undefined}>{opening ? 'Opening…' : `${roomId ? 'Join the table' : 'Open a family table'}${member ? ` as ${member}` : ''}`}</button></form>
      <p class="setting-hint">{member && family ? 'A table you open is listed on the home screen for anyone to find. It starts closed, so newcomers knock until the table votes it open.'
        : member ? 'You sit under your own name at any table, and the hands you play join your record. Share the invite only with your group.'
        : 'No account needed. Share the invite only with your group.'}</p>
      {!roomId && <form class="room-join" onSubmit={e => { e.preventDefault(); void open(true); }}>
        <label class="room-label">Room code or invite link<input value={joinInput} onInput={e => setJoinInput(e.currentTarget.value)} autoCapitalize="none" autoCorrect="off" spellcheck={false} placeholder="Paste from your family" /></label>
        <button class="big-btn secondary" disabled={opening || !joinInput.trim()}>Join a family table</button>
        <p class="setting-hint">Already using the Plunge app? Paste the code here to stay in this app.</p>
      </form>}
      <a class="text-btn" href={location.pathname}>Back to solo play</a>
    </div></div>
    : !shown ? <div class="room-wait" role="status">Connecting to the table…</div>
    : knock && !credentials ? <div class="room-wait"><div class="home-card"><p class="eyebrow">Closed table</p><h1 class="sheet-title">Knocking…</h1>
      <p>{knock.answer ?? (shown.proposal?.knock === knock.visitor ? 'Anyone at the table can let you in.' : knock.sent ? 'Waiting for the table.' : 'Asking to come in.')}</p>
      <div class="room-chairs">{[0,2,1,3].map(s => <div key={s}><strong>{shown.seats[s]?.name ?? 'Walt'}</strong><span>{shown.seats[s] ? shown.seats[s]!.connected ? 'Here' : 'Away' : 'Open chair'}</span></div>)}</div>
      {knock.answer && <button class="big-btn" onClick={() => setKnock({ ...knock, sent: false, answer: null })}>Knock again</button>}
      <a class="text-btn" href={location.pathname}>Back to solo play</a>
    </div></div>
    : credentials && !shown.game ? <div class="room-wait"><div class="home-card"><p class="eyebrow">Your family table</p><h1 class="sheet-title">Pull up a chair</h1>
      <p>You are {shown.seats[credentials.seat]?.name}. Anyone here can start; the table gets five seconds to object. People can join or leave any time, and Walt plays an empty chair.</p>
      <div class="room-chairs">{[0,2,1,3].map(s => <div key={s}><strong>{shown.seats[s]?.name ?? 'Walt'}</strong><span>{s === credentials.seat ? 'You' : s === (credentials.seat + 2) % 4 ? 'Your partner' : 'Across the table'}{shown.seats[s] && !shown.seats[s]!.connected ? ' · Away' : ''}</span></div>)}</div>
      <button class="big-btn secondary" onClick={share}>Copy invite link</button>
      <button class="big-btn" disabled={!online || pending || !!shown.proposal} onClick={() => propose('start')}>Start with {people} {people === 1 ? 'person' : 'people'} + Walt</button>
      <p class="setting-hint">Refreshing rejoins this seat. Undo, kicking, starting over and opening or closing the table are all quick votes.</p>
      <p class="setting-hint">For Nel-O, win a bid of 1 mark or more, then choose Nel-O. The bidder’s partner sits out. Rooms last up to 24 hours without activity.</p>
    </div></div>
    : null;
  const overlays = <>
    {tableOpen && table && credentials && <div class="overlay room-invite"><div class="card" role="dialog" aria-label="Table"><h2 class="sheet-title">The table</h2>
      <p class="hint">Everything here is a vote. {table.proposal ? 'The table is deciding something now.' : 'Low stakes go ahead unless someone says no within five seconds.'}</p>
      <div class="room-people">{[0,2,1,3].map(s => { const person = table.seats[s]; return <div key={s} class="room-person"><span><strong>{person?.name ?? 'Walt'}</strong>{s === credentials.seat ? ' · You' : person ? person.away ? ' · Walt is playing' : person.connected ? ' · Here' : ' · Rejoining' : ''}</span>
        {person && s !== credentials.seat && <button class="text-btn" disabled={!online || pending || !!table.proposal} onClick={() => propose('kick', s as Seat)}>Ask to step out</button>}</div>; })}</div>
      <button class="big-btn secondary" disabled={!online || pending || !!table.proposal} onClick={() => propose(table.open ? 'close' : 'open')}>{table.open ? 'Close the table' : 'Open the table'}</button>
      <p class="hint">{table.open ? 'Anyone with the invite can sit down.' : 'Newcomers knock; one yes from anyone here lets them in.'}</p>
      {table.game && <button class="big-btn secondary" disabled={!online || pending || !!table.proposal} onClick={() => propose('restart')}>Start over</button>}
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
  </>;
  const menu = credentials ? <button type="button" class="big-btn secondary" onClick={() => setTableOpen(true)}>The table · votes and chairs</button> : null;
  return { active, dispatch, chrome, screen, overlays, menu, thinking, seatNote };
}
