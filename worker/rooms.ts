/** One authoritative, trusted-family table. Nobody hosts: whoever is present runs
 * Walt, and anything done to the table is a short vote. */
import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type Action, type GameState, type Seat } from '../src/engine';
import { handSteps } from '../src/engine/hand-history';
import { catalogueDeal } from '../src/ai/catalogue';
import type { AuctionEvidence } from '../src/ai/auction';
import type { Proposal, ProposalKind, RoomCommand, RoomCredentials, RoomState, VoteResult } from '../src/room/protocol';
import { CLOSE_EXPIRED, CLOSE_OTHER_TAB, CLOSE_PAUSED, CLOSE_SEAT_GONE, ROOM_ID, VISITOR_ID, ROOM_HISTORY_LIMIT } from '../src/room/protocol';
import { roomAuctionConfig, roomUndoTarget, upgradeRoom } from './room-undo';
import { newProposal, objector, PROPOSAL_KINDS, proposalStatus } from './room-votes';

const TOKEN = /^[a-f0-9]{64}$/;
const COMMAND_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const DAY = 24 * 60 * 60 * 1000;
/** A standing family table outlives a quiet month; an invite room lasts a day. */
const STANDING = 30 * DAY;
const ACCOUNT_HEADER = 'X-Plunge-Account';
const HEARTBEAT = 15000;
/** A seat stays the person's for this long after they drop; then Walt plays it until they return. */
export const GRACE = 20000;
const ADMISSION = 5 * 60 * 1000;
const MAX_VISITORS = 8;
const MAX_MESSAGE = 24000;
const json = (value: unknown, status = 200) => Response.json(value, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function roomBody(request: Request): Promise<{ name: unknown; knock?: unknown; standing?: unknown }> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Please enter your name.');
  let size = 0, text = ''; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 1024) { await reader.cancel(); throw new Error('Room request is too large.'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as { name: unknown; knock?: unknown; standing?: unknown };
}
/** Set only by the entry worker after checking the session; never trusted from a browser. */
function accountFrom(request: Request): { id: string; name: string } | undefined {
  try {
    const value = JSON.parse(request.headers.get(ACCOUNT_HEADER) ?? 'null') as { id?: unknown; name?: unknown } | null;
    return value && typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id) && typeof value.name === 'string'
      ? { id: value.id, name: cleanName(value.name) } : undefined;
  } catch { return undefined; }
}
export const randomKey = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');

/** `seen`: last moment this seat was known connected; absence is measured from it.
 * `account`: the signed-in account holding this seat, so the same person on another device gets the same chair. */
interface SavedSeat { name: string; token: string; seen: number; account?: string }
export interface SavedRoom {
  state: RoomState; players: (SavedSeat | null)[]; accepted: string[]; updated: number;
  /** The family's one standing table, found through accounts rather than an invite. */
  standing?: boolean;
  /** Actual human decisions in this hand. Missing on rooms saved by older code. */
  humanSteps?: { handNumber: number; indices: number[] };
  /** Knocks the table said yes to; each seats one person once. */
  admitted?: { knock: string; name: string; until: number }[];
  /** Keys of seats that were kicked or left, so that browser learns why. */
  former?: { token: string; reason: 'kicked' | 'left' }[];
}
export class ClosedTable extends Error { readonly closed = true; }
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Please enter your name.');
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24);
  if (!name) throw new Error('Please enter your name.');
  return name;
}
export function createRoom(roomId: string, name: string, token = randomKey(32), now = Date.now(),
  options: { standing?: boolean; account?: string } = {}): SavedRoom {
  return { state: { type: 'state', roomId, revision: 0, seed: '', sessionId: '', game: null,
    seats: [null, null, null, null], runner: null, open: true, visitors: 0, proposal: null, lastVote: null,
    started: false, holdUntil: 0, thinkingSeat: null,
    nativeReceipts: {}, auctionSurveys: {}, retry: null, practiceHands: [], lastUndo: null },
    players: [{ name: cleanName(name), token, seen: now, ...(options.account ? { account: options.account } : {}) }, null, null, null],
    accepted: [], updated: now, admitted: [], former: [], ...(options.standing ? { standing: true } : {}) };
}
export const roomLifetime = (room: SavedRoom): number => room.standing ? STANDING : DAY;

// --- Presence, derived from the sockets the coordinator passes in ------------
const seated = (room: SavedRoom, connected: ReadonlySet<Seat>): Set<Seat> =>
  new Set([...connected].filter(seat => room.players[seat]));
export const isAway = (room: SavedRoom, seat: Seat, connected: ReadonlySet<Seat>, now: number): boolean =>
  !!room.players[seat] && !connected.has(seat) && now - (room.players[seat]!.seen ?? 0) >= GRACE;
/** Walt drives an empty seat, or an absent person's seat once the grace has passed. */
export const waltDrives = (room: SavedRoom, seat: Seat, connected: ReadonlySet<Seat>, now: number): boolean =>
  !room.players[seat] || isAway(room, seat, connected, now);
export function runnerOf(room: SavedRoom, connected: ReadonlySet<Seat>): Seat | null {
  return ([0, 1, 2, 3] as const).find(seat => room.players[seat] && connected.has(seat)) ?? null;
}
const seatName = (room: SavedRoom, seat: Seat | null | undefined): string =>
  seat === null || seat === undefined ? 'Walt' : room.players[seat]?.name ?? `Walt ${seat + 1}`;

export function roomSnapshot(room: SavedRoom, connected: ReadonlySet<Seat>, now = Date.now(), visitors = 0): RoomState {
  return { ...room.state, canUndo: roomUndoTarget(room) !== null, runner: runnerOf(room, connected), visitors,
    seats: room.players.map((player, seat) => player
      ? { name: player.name, connected: connected.has(seat as Seat), away: isAway(room, seat as Seat, connected, now) } : null) };
}
/** Sitting down works any time; a hand in progress just hands you the seat's dominoes.
 * A signed-in account gets its own chair back from any device. */
export function joinRoom(room: SavedRoom, name: string, token = randomKey(32), now = Date.now(), knock?: string, account?: string): RoomCredentials {
  // Record old human membership before a newcomer takes a formerly Walt seat.
  upgradeRoom(room);
  const own = account === undefined ? -1 : room.players.findIndex(player => player?.account === account);
  if (own >= 0) {
    const player = room.players[own]!;
    if (player.name !== cleanName(name)) { player.name = cleanName(name); room.state = { ...room.state, revision: room.state.revision + 1 }; room.updated = now; }
    return { roomId: room.state.roomId, token: player.token, seat: own as Seat };
  }
  if (!room.state.open) {
    const admission = room.admitted!.findIndex(entry => entry.knock === knock && entry.until > now);
    if (admission < 0) throw new ClosedTable('This table is closed. Knock to ask to come in.');
    room.admitted!.splice(admission, 1);
  }
  const seat = ([2, 1, 3, 0] as const).find(seat => !room.players[seat]);
  if (seat === undefined) throw new Error('All four seats are taken.');
  room.players[seat] = { name: cleanName(name), token, seen: now, ...(account ? { account } : {}) };
  room.state = { ...room.state, revision: room.state.revision + 1, thinkingSeat: null };
  room.updated = now;
  return { roomId: room.state.roomId, token, seat };
}

// --- Effects: the same code whether a person taps or a vote passes ----------
/** Archive only when leaving a finished hand, so takebacks keep its final version. */
function archiveHand(room: SavedRoom): void {
  const { game, sessionId } = room.state;
  if (!game || (game.phase !== 'hand-over' && game.phase !== 'game-over')) return;
  const hands = (room.state.recentHands ?? []).filter(hand => hand.sessionId !== sessionId || hand.game.handNumber !== game.handNumber);
  room.state = { ...room.state, recentHands: [...hands, {
    sessionId, game, names: [0, 1, 2, 3].map(seat => seatName(room, seat as Seat)),
    practice: room.state.practiceHands?.includes(game.handNumber) ?? false,
  }].slice(-ROOM_HISTORY_LIMIT) };
}
function startGame(room: SavedRoom): void {
  archiveHand(room);
  const seed = randomKey(16), sessionId = randomKey(16);
  room.state = { ...room.state, seed, sessionId, game: catalogueDeal(newGame(PLUNGE_CONFIG, seed), seed),
    started: true, holdUntil: 0, thinkingSeat: null, nativeReceipts: {}, auctionSurveys: {},
    retry: null, practiceHands: [], lastUndo: null };
  room.humanSteps = { handNumber: 1, indices: [] };
}
function advance(room: SavedRoom, legal: Action, now: number, human: boolean, receiptId?: string, auction?: AuctionEvidence): void {
  const game = room.state.game!;
  let next = applyAction(game, legal);
  if (legal.type === 'next-hand') {
    next = catalogueDeal(roomAuctionConfig(next), room.state.seed);
    archiveHand(room);
    room.humanSteps = { handNumber: next.handNumber, indices: [] };
  } else if (human) {
    room.humanSteps!.indices = [...room.humanSteps!.indices, handSteps(game).length];
  }
  const receipts = { ...room.state.nativeReceipts }, surveys = { ...room.state.auctionSurveys };
  const ply = game.tricks.reduce((sum, trick) => sum + trick.plays.length, 0) + game.currentTrick.length;
  if (receiptId && legal.type === 'play') receipts[`${game.handNumber}:${ply}`] = receiptId;
  if (auction) surveys[`${game.handNumber}:${game.turn}`] = auction;
  room.state = { ...room.state, game: next, thinkingSeat: null,
    holdUntil: next.tricks.length > game.tricks.length ? now + 2000 : 0,
    nativeReceipts: receipts, auctionSurveys: surveys };
  if (legal.type === 'next-hand') room.state = { ...room.state, retry: null, lastUndo: null };
}
function undoLastHuman(room: SavedRoom): boolean {
  const target = roomUndoTarget(room);
  if (!target) return false;
  room.state = { ...room.state, game: target.game, retry: target.retry, practiceHands: target.practiceHands,
    nativeReceipts: target.nativeReceipts, auctionSurveys: target.auctionSurveys, holdUntil: 0, thinkingSeat: null,
    lastUndo: { revision: room.state.revision + 1, seat: target.seat, name: room.players[target.seat]?.name ?? 'Player' } };
  room.humanSteps = { handNumber: target.game.handNumber, indices: room.humanSteps!.indices.filter(index => index < target.kept) };
  return true;
}
const finished = (game: GameState | null) => !game || game.phase === 'game-over';
/** Whether this proposal could pass right now; the message explains why not. */
function checkProposal(room: SavedRoom, kind: ProposalKind, by: Seat | null, target: Seat | undefined, now: number): void {
  const game = room.state.game;
  if (kind === 'start' && !finished(game)) throw new Error('The game is already in progress.');
  if (kind === 'restart' && !game) throw new Error('Start the game first.');
  if (kind === 'next-hand' && game?.phase !== 'hand-over') throw new Error('This hand is not over yet.');
  if (kind === 'next-hand' && now < room.state.holdUntil) throw new Error('Please wait for this trick to finish showing.');
  if (kind === 'undo' && !roomUndoTarget(room)) throw new Error('There is no human move to take back in this hand.');
  if (kind === 'open' && room.state.open) throw new Error('The table is already open.');
  if (kind === 'close' && !room.state.open) throw new Error('The table is already closed.');
  if (kind === 'kick') {
    if (target === undefined || !room.players[target]) throw new Error('That chair is already Walt’s.');
    if (target === by) throw new Error('Use Leave to step out yourself.');
  }
  if (kind === 'admit' && room.players.every(Boolean)) throw new Error('All four seats are taken.');
}
function applyProposal(room: SavedRoom, proposal: Proposal, now: number): boolean {
  checkProposal(room, proposal.kind, proposal.by, proposal.target, now);
  switch (proposal.kind) {
    case 'start': case 'restart': startGame(room); return true;
    case 'next-hand': {
      const legal = legalActions(room.state.game!).find(action => action.type === 'next-hand');
      if (!legal) return false;
      advance(room, legal, now, false); return true;
    }
    case 'undo': return undoLastHuman(room);
    case 'open': room.state = { ...room.state, open: true }; return true;
    case 'close': room.state = { ...room.state, open: false }; return true;
    case 'kick': vacate(room, proposal.target!, 'kicked'); return true;
    case 'admit':
      room.admitted = [...room.admitted!.filter(entry => entry.until > now && entry.knock !== proposal.knock),
        { knock: proposal.knock!, name: proposal.byName, until: now + ADMISSION }];
      return true;
  }
}
function vacate(room: SavedRoom, seat: Seat, reason: 'kicked' | 'left'): void {
  const player = room.players[seat];
  if (!player) return;
  room.players[seat] = null;
  room.former = [...(room.former ?? []).slice(-31), { token: player.token, reason }];
  const proposal = room.state.proposal;
  if (proposal) {
    const votes = { ...proposal.votes }; delete votes[seat];
    room.state = { ...room.state, proposal: { ...proposal, votes } };
  }
}
/** Resolve the open proposal if the people present or the clock have decided it.
 * Returns whether the room changed (one revision). */
export function settleRoom(room: SavedRoom, connected: ReadonlySet<Seat>, now = Date.now()): boolean {
  const proposal = room.state.proposal;
  if (!proposal) return false;
  const present = seated(room, connected), status = proposalStatus(proposal, present, now);
  if (status === 'open') return false;
  const result: VoteResult = { revision: room.state.revision + 1, kind: proposal.kind, byName: proposal.byName, outcome: status,
    ...(proposal.target !== undefined ? { targetName: seatName(room, proposal.target) } : {}),
    ...(proposal.knock ? { knock: proposal.knock } : {}) };
  if (status === 'failed') { const who = objector(proposal, present); if (who !== undefined) result.noFrom = seatName(room, who); }
  room.state = { ...room.state, proposal: null };
  if (status === 'passed') {
    let done = false;
    try { done = applyProposal(room, proposal, now); } catch { done = false; }
    if (!done) result.outcome = 'moot';
  }
  room.state = { ...room.state, lastVote: result, revision: room.state.revision + 1 };
  room.updated = now;
  return true;
}
function touch(room: SavedRoom, connected: ReadonlySet<Seat>, now: number): void {
  for (const seat of connected) if (room.players[seat]) room.players[seat]!.seen = Math.max(room.players[seat]!.seen, now);
}

/** A visitor at a closed table asks the people present to let them in. */
export function knockRoom(room: SavedRoom, visitor: string, id: string, name: string, connected: ReadonlySet<Seat>,
  now = Date.now()): 'duplicate' | 'changed' {
  if (!COMMAND_ID.test(id) || !VISITOR_ID.test(visitor)) throw new Error('Invalid room command.');
  const key = `v:${visitor}:${id}`;
  if (room.accepted.includes(key)) return 'duplicate';
  touch(room, connected, now); upgradeRoom(room); settleRoom(room, connected, now);
  if (room.state.open) throw new Error('This table is open. Come on in.');
  checkProposal(room, 'admit', null, undefined, now);
  if (room.admitted!.some(entry => entry.knock === visitor && entry.until > now)) throw new Error('The table already said yes. Come on in.');
  if (room.state.proposal?.knock === visitor) return 'duplicate';
  if (room.state.proposal) throw new Error('The table is deciding something else. Knock again in a moment.');
  room.state = { ...room.state, proposal: newProposal(id, 'admit', null, cleanName(name), now, { knock: visitor }) };
  if (!settleRoom(room, connected, now)) room.state = { ...room.state, revision: room.state.revision + 1 };
  room.accepted = [...room.accepted.slice(-511), key];
  room.updated = now;
  return 'changed';
}

/** The same guard protects human moves, delayed Walt replies and reconnect retries. */
export function commandRoom(room: SavedRoom, seat: Seat, command: RoomCommand,
  connected: ReadonlySet<Seat>, now = Date.now()): 'duplicate' | 'changed' | 'thinking' {
  if (!command || !COMMAND_ID.test(command.id) || command.type === 'knock'
    || !['action', 'thinking', 'propose', 'vote', 'leave'].includes(command.type)) throw new Error('Invalid room command.');
  const key = `${seat}:${command.id}`;
  if (room.accepted.includes(key)) return 'duplicate';
  if (!room.players[seat]) throw new Error('This seat is no longer yours.');
  touch(room, connected, now);
  upgradeRoom(room);
  settleRoom(room, connected, now);
  if (command.type === 'vote') {
    const proposal = room.state.proposal;
    if (!proposal || proposal.id !== command.proposal) throw new Error('That vote has already closed.');
    if (!['yes', 'no'].includes(command.vote)) throw new Error('Invalid room command.');
    if (proposal.target === seat) throw new Error('The rest of the table decides this one.');
    room.state = { ...room.state, proposal: { ...proposal, votes: { ...proposal.votes, [seat]: command.vote } } };
  } else if (command.type === 'leave') {
    vacate(room, seat, 'left');
    room.state = { ...room.state, thinkingSeat: null };
  } else {
    if (!Number.isSafeInteger(command.revision)) throw new Error('Invalid room command.');
    if (command.revision !== room.state.revision) throw new Error('The table changed. Please try your move again.');
    const runner = runnerOf(room, connected);
    if (command.type === 'propose') {
      if (!PROPOSAL_KINDS.includes(command.kind) || command.kind === 'admit') throw new Error('Invalid room command.');
      if (command.target !== undefined && ![0, 1, 2, 3].includes(command.target)) throw new Error('Invalid room command.');
      if (room.state.proposal) throw new Error('The table is already deciding something. One moment.');
      checkProposal(room, command.kind, seat, command.target, now);
      const player = room.players[seat]!;
      room.state = { ...room.state, proposal: newProposal(command.id, command.kind, seat, player.name, now,
        command.kind === 'kick' && command.target !== undefined ? { target: command.target } : {}) };
    } else if (command.type === 'thinking') {
      const game = room.state.game;
      if (seat !== runner || (command.seat !== null && (!game || command.seat !== game.turn || !waltDrives(room, command.seat, connected, now))))
        throw new Error('Only the person running Walt can think for an empty seat.');
      room.state = { ...room.state, thinkingSeat: command.seat ?? null };
      return 'thinking';
    } else {
      if (now < room.state.holdUntil) throw new Error('Please wait for this trick to finish showing.');
      const game = room.state.game, action = command.action;
      if (!game || !action) throw new Error('Start the game first.');
      if (action.type === 'next-hand') throw new Error('Shake the next hand with the table.');
      if (game.turn === null) throw new Error('It is not your turn.');
      if (seat !== game.turn) {
        if (seat !== runner) throw new Error('It is not your turn.');
        if (!waltDrives(room, game.turn, connected, now)) throw new Error(connected.has(game.turn)
          ? 'It is not your turn.' : `Waiting for ${seatName(room, game.turn)} to come back.`);
      }
      // Select the engine's canonical action, dropping unknown client properties.
      const legal = legalActions(game).find(candidate => JSON.stringify(candidate) === JSON.stringify(action));
      if (!legal) throw new Error('That move is not legal at this table.');
      if (command.receiptId !== undefined && !/^[a-f0-9]{64}$/.test(command.receiptId)) throw new Error('Invalid Walt receipt.');
      if (command.auction !== undefined && (!['plunge-played-auction-v1', 'walt-auction-v1'].includes(command.auction.schema)
        || command.auction.seat !== game.turn)) throw new Error('Invalid Walt auction evidence.');
      advance(room, legal, now, seat === game.turn, command.receiptId, command.auction);
    }
  }
  if (!settleRoom(room, connected, now)) room.state = { ...room.state, revision: room.state.revision + 1 };
  room.accepted = [...room.accepted.slice(-511), key];
  room.updated = now;
  return 'changed';
}

// Minimal Cloudflare surfaces keep its runtime types out of the browser build.
interface Attachment { seat: Seat | null; token?: string; visitor?: string; former?: 'kicked' | 'left'; id: string; lastSeen: number }
const GONE = { kicked: 'The table asked you to step out.', left: 'You left the table.' } as const;
interface RoomSocket extends WebSocket { serializeAttachment(value: unknown): void; deserializeAttachment(): Attachment }
interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>;
  setAlarm(time: number): Promise<void>; deleteAll(): Promise<void>;
}
interface RoomContext {
  storage: RoomStorage; blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  acceptWebSocket(socket: RoomSocket): void; getWebSockets(): RoomSocket[];
}
export interface RoomsNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
declare const WebSocketPair: { new(): { 0: RoomSocket; 1: RoomSocket } };

export class PlungeRoom {
  private room: SavedRoom | undefined;
  private readonly ready: Promise<void>;
  constructor(private readonly ctx: RoomContext) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get<SavedRoom>('room');
      if (this.room && upgradeRoom(this.room)) await ctx.storage.put('room', this.room);
    });
  }
  private live(exclude?: RoomSocket): RoomSocket[] {
    return this.ctx.getWebSockets().filter(socket => socket !== exclude && socket.readyState === 1);
  }
  private connected(exclude?: RoomSocket): Set<Seat> {
    return new Set(this.live(exclude).filter(socket => socket.deserializeAttachment().lastSeen + HEARTBEAT > Date.now())
      .map(socket => socket.deserializeAttachment().seat).filter((seat): seat is Seat => seat !== null));
  }
  private visitors(): number { return this.live().filter(socket => socket.deserializeAttachment().visitor !== undefined).length; }
  private async nextAlarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now(), connected = this.connected();
    const deadlines = this.live().map(socket => socket.deserializeAttachment().lastSeen + HEARTBEAT);
    if (this.room.state.proposal) deadlines.push(this.room.state.proposal.deadline);
    for (const [seat, player] of this.room.players.entries())
      if (player && !connected.has(seat as Seat) && player.seen + GRACE > now) deadlines.push(player.seen + GRACE);
    await this.ctx.storage.setAlarm(Math.min(this.room.updated + roomLifetime(this.room), ...deadlines));
  }
  private async save(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room);
    await this.nextAlarm();
  }
  /** Settle any decided vote, persist, tell everyone, and drop sockets whose seat is gone. */
  private async sync(changed: boolean, exclude?: RoomSocket): Promise<void> {
    if (!this.room) return;
    const connected = this.connected(exclude);
    if (settleRoom(this.room, connected, Date.now())) changed = true;
    if (changed) await this.save();
    for (const socket of this.live(exclude)) {
      const { seat, token } = socket.deserializeAttachment();
      if (seat !== null && this.room.players[seat]?.token !== token) {
        socket.close(CLOSE_SEAT_GONE, GONE[this.room.former?.find(entry => entry.token === token)?.reason ?? 'left']);
      }
    }
    this.broadcast(exclude);
  }
  private broadcast(exclude?: RoomSocket): void {
    if (!this.room) return;
    const message = JSON.stringify(roomSnapshot(this.room, this.connected(exclude), Date.now(), this.visitors()));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude || socket.readyState !== 1) continue;
      try { socket.send(message); } catch { /* A close callback updates presence. */ }
    }
  }
  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url), match = /^\/api\/rooms\/([a-f0-9]{32})(?:\/(create|join|socket))?$/.exec(url.pathname);
    if (!match) return json({ error: 'Room not found.' }, 404);
    const roomId = match[1]!, operation = match[2];
    try {
      const account = accountFrom(request);
      if (operation === 'create' && request.method === 'POST') {
        if (this.room) return json({ error: 'Room already exists.' }, 409);
        const { name, standing } = await roomBody(request);
        // Only the entry worker, for a family account, opens a standing table.
        this.room = createRoom(roomId, cleanName(name), undefined, Date.now(), { standing: standing === true && account !== undefined, ...(account ? { account: account.id } : {}) });
        await this.save();
        return json({ roomId, token: this.room.players[0]!.token, seat: 0 });
      }
      if (!this.room || this.room.updated + roomLifetime(this.room) <= Date.now()) return json({ error: 'This room expired. Please create a new one.' }, 404);
      if (operation === 'join' && request.method === 'POST') {
        const { name, knock } = await roomBody(request);
        settleRoom(this.room, this.connected(), Date.now());
        try {
          const credentials = joinRoom(this.room, cleanName(name), undefined, Date.now(), typeof knock === 'string' ? knock : undefined, account?.id);
          await this.sync(true);
          return json(credentials);
        } catch (error) {
          if (error instanceof ClosedTable) { await this.sync(false); return json({ error: error.message, closed: true }, 403); }
          throw error;
        }
      }
      if (operation !== 'socket' || request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'A room connection is required.' }, 426);
      const token = url.searchParams.get('token'), visitor = url.searchParams.get('visitor');
      let attachment: Attachment;
      if (visitor !== null) {
        if (!VISITOR_ID.test(visitor)) return json({ error: 'Invalid visitor.' }, 400);
        if (this.visitors() >= MAX_VISITORS) return json({ error: 'The doorway is crowded. Try again in a moment.' }, 429);
        for (const old of this.live()) if (old.deserializeAttachment().visitor === visitor) old.close(CLOSE_OTHER_TAB, 'Opened in another tab.');
        attachment = { seat: null, visitor, id: randomKey(8), lastSeen: Date.now() };
      } else {
        if (!TOKEN.test(token ?? '')) return json({ error: 'Your seat key is missing.' }, 401);
        const seat = this.room.players.findIndex(player => player?.token === token);
        const former = this.room.former?.find(entry => entry.token === token);
        if (seat < 0 && !former) return json({ error: 'Your seat key is invalid.' }, 401);
        if (seat < 0) {
          // Tell the browser its seat is gone, instead of leaving it reconnecting forever:
          // the socket opens, and its first ping is answered with the close reason.
          attachment = { seat: null, former: former!.reason, id: randomKey(8), lastSeen: Date.now() };
        } else {
          // Refresh replaces this browser's old connection; it cannot create a second actor.
          for (const old of this.live()) if (old.deserializeAttachment().seat === seat) old.close(CLOSE_OTHER_TAB, 'Seat opened in another tab.');
          attachment = { seat: seat as Seat, token: token!, id: randomKey(8), lastSeen: Date.now() };
          this.room.players[seat]!.seen = Date.now();
        }
      }
      const pair = new WebSocketPair(), client = pair[0], server = pair[1];
      server.serializeAttachment(attachment); this.ctx.acceptWebSocket(server);
      this.room.state = { ...this.room.state, thinkingSeat: null }; this.room.updated = Date.now();
      await this.sync(true);
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Cannot open the room.' }, 400); }
  }
  async webSocketMessage(socket: RoomSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    let command: RoomCommand | undefined;
    const before = this.room?.state.revision;
    try {
      const attachment = socket.deserializeAttachment();
      if (attachment.former) { socket.close(CLOSE_SEAT_GONE, GONE[attachment.former]); return; }
      if (message === 'ping') {
        socket.serializeAttachment({ ...attachment, lastSeen: Date.now() });
        if (this.room) {
          this.room.updated = Date.now();
          if (attachment.seat !== null && this.room.players[attachment.seat]) this.room.players[attachment.seat]!.seen = Date.now();
        }
        socket.send('pong'); return;
      }
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error('Room message is too large.');
      if (!this.room) throw new Error('This room expired.');
      command = JSON.parse(message) as RoomCommand;
      if (socket.readyState !== 1) throw new Error('This seat connection has closed.');
      if (attachment.seat === null) {
        if (command.type !== 'knock' || attachment.visitor === undefined) throw new Error('Take a seat first.');
        knockRoom(this.room, attachment.visitor, command.id, command.name, this.connected(), Date.now());
      } else {
        if (this.room.players[attachment.seat]?.token !== attachment.token) throw new Error('This seat is no longer yours.');
        commandRoom(this.room, attachment.seat, command, this.connected(), Date.now());
      }
      socket.send(JSON.stringify({ type: 'ack', id: command.id, revision: this.room.state.revision }));
      await this.sync(this.room.state.revision !== before);
    } catch (error) {
      try { socket.send(JSON.stringify({ type: 'error', ...(command?.id ? { id: command.id } : {}),
        message: error instanceof Error ? error.message : 'Please reconnect to the room.' })); } catch { /* Closed. */ }
      await this.sync(this.room?.state.revision !== before);
    }
  }
  async webSocketClose(socket: RoomSocket, code = 1000, reason = ''): Promise<void> {
    await this.ready;
    try { socket.close(code === 1005 ? 1000 : code, reason); } catch { /* Already closed. */ }
    if (!this.room) return;
    const { seat } = socket.deserializeAttachment();
    if (seat !== null && this.room.players[seat]) this.room.players[seat]!.seen = Date.now();
    this.room.state = { ...this.room.state, thinkingSeat: null };
    await this.sync(seat !== null, socket);
  }
  async webSocketError(socket: RoomSocket): Promise<void> { socket.close(1011, 'Please reconnect.'); await this.webSocketClose(socket); }
  async alarm(): Promise<void> {
    await this.ready;
    if (this.room && this.room.updated + roomLifetime(this.room) > Date.now()) {
      for (const socket of this.live()) if (socket.deserializeAttachment().lastSeen + HEARTBEAT <= Date.now())
        socket.close(CLOSE_PAUSED, 'Connection paused. Please reconnect.');
      if (this.connected().size) this.room.updated = Date.now();
      await this.sync(true); return;
    }
    for (const socket of this.ctx.getWebSockets()) socket.close(CLOSE_EXPIRED, 'This room expired.');
    this.room = undefined; await this.ctx.storage.deleteAll();
  }
}

export async function roomRequest(request: Request, namespace?: RoomsNamespace): Promise<Response> {
  if (!namespace) return json({ error: 'Family rooms are unavailable in this build.' }, 503);
  const url = new URL(request.url);
  if (url.pathname === '/api/rooms/status' && request.method === 'GET') return json({ experimental: true });
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  if (Number(request.headers.get('Content-Length')) > 1024) return json({ error: 'Room request is too large.' }, 413);
  let roomId: string;
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    roomId = randomKey(16); url.pathname = `/api/rooms/${roomId}/create`;
  } else {
    const match = /^\/api\/rooms\/([a-f0-9]{32})\/(join|socket)$/.exec(url.pathname);
    if (!match || !ROOM_ID.test(match[1]!)) return json({ error: 'Room not found.' }, 404);
    roomId = match[1]!;
  }
  const forwarded = new Request(url, request);
  forwarded.headers.delete(ACCOUNT_HEADER);
  return namespace.get(namespace.idFromName(roomId)).fetch(forwarded);
}

interface FamilyDatabase { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } }
/** The family's standing table: one row in D1, one durable room, your own chair from any device. */
export async function familyTableRequest(request: Request, namespace: RoomsNamespace | undefined, db: FamilyDatabase | undefined,
  account: { id: string; name: string; family: number; owner: number } | null): Promise<Response> {
  const url = new URL(request.url);
  const allowed = !!account && (!!account.family || !!account.owner);
  // The home screen asks whether to offer the table at all; the answer costs one session lookup.
  if (request.method === 'GET') return json({ family: allowed && !!namespace && !!db });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  if (!namespace || !db) return json({ error: 'The family table is unavailable in this build.' }, 503);
  if (!account) return json({ error: 'Sign in to find the family table.' }, 401);
  if (!allowed) return json({ error: 'Ask Jason to grant family access from your account.' }, 403);
  const headers = { 'Content-Type': 'application/json', [ACCOUNT_HEADER]: JSON.stringify({ id: account.id, name: account.name }) };
  const call = (roomId: string, operation: 'create' | 'join', body: unknown) => namespace.get(namespace.idFromName(roomId))
    .fetch(new Request(`${url.origin}/api/rooms/${roomId}/${operation}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  const current = async () => (await db.prepare('SELECT room_id FROM family_table WHERE id = ?').bind('family').first<{ room_id: string }>())?.room_id;
  let roomId = await current();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (roomId === undefined) {
      const fresh = randomKey(16);
      const created = await call(fresh, 'create', { name: account.name, standing: true });
      if (!created.ok) return json(await created.json(), created.status);
      await db.prepare('INSERT OR IGNORE INTO family_table(id, room_id, created) VALUES (?, ?, ?)').bind('family', fresh, Date.now()).run();
      roomId = await current();
      if (roomId === fresh) return json({ ...(await created.json() as object), roomId });
      continue; // Someone else opened the table first; sit at theirs.
    }
    const joined = await call(roomId, 'join', { name: account.name });
    if (joined.status === 404) {
      // The old table expired. Forget it and open another.
      await db.prepare('DELETE FROM family_table WHERE id = ? AND room_id = ?').bind('family', roomId).run();
      roomId = await current(); continue;
    }
    return json({ ...(await joined.json() as object), roomId }, joined.status);
  }
  return json({ error: 'The family table is busy. Please try again.' }, 503);
}
