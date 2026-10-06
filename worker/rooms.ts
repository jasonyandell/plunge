/** One authoritative, trusted-family room. Walt runs in the host's browser. */
import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type Seat } from '../src/engine';
import { handSteps } from '../src/engine/hand-history';
import { catalogueDeal } from '../src/ai/catalogue';
import type { RoomCommand, RoomCredentials, RoomState } from '../src/room/protocol';
import { ROOM_ID } from '../src/room/protocol';
import { roomAuctionConfig, roomUndoTarget, upgradeRoom } from './room-undo';

const TOKEN = /^[a-f0-9]{64}$/;
const COMMAND_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const DAY = 24 * 60 * 60 * 1000;
const HEARTBEAT = 15000;
const MAX_MESSAGE = 24000;
const json = (value: unknown, status = 200) => Response.json(value, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function roomBody(request: Request): Promise<{ name: unknown }> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Please enter your name.');
  let size = 0, text = ''; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 1024) { await reader.cancel(); throw new Error('Room request is too large.'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as { name: unknown };
}
export const randomKey = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');

interface SavedSeat { name: string; token: string }
export interface SavedRoom {
  state: RoomState; players: (SavedSeat | null)[]; accepted: string[]; updated: number;
  /** Actual human decisions in this hand. Missing on rooms saved by older code. */
  humanSteps?: { handNumber: number; indices: number[] };
}
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Please enter your name.');
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24);
  if (!name) throw new Error('Please enter your name.');
  return name;
}
export function createRoom(roomId: string, name: string, token = randomKey(32), now = Date.now()): SavedRoom {
  return { state: { type: 'state', roomId, revision: 0, seed: '', sessionId: '', game: null,
    seats: [null, null, null, null], hostConnected: false, started: false, holdUntil: 0, thinkingSeat: null,
    nativeReceipts: {}, auctionSurveys: {}, retry: null, practiceHands: [], lastUndo: null },
    players: [{ name: cleanName(name), token }, null, null, null], accepted: [], updated: now };
}
export function roomSnapshot(room: SavedRoom, connected: ReadonlySet<Seat>): RoomState {
  return { ...room.state, canUndo: roomUndoTarget(room) !== null, seats: room.players.map((player, seat) => player
    ? { name: player.name, connected: connected.has(seat as Seat) } : null), hostConnected: connected.has(0) };
}
export function joinRoom(room: SavedRoom, name: string, token = randomKey(32), now = Date.now()): RoomCredentials {
  // Record old human membership before a newcomer takes a formerly Walt seat.
  upgradeRoom(room);
  if (room.state.game && !['hand-over', 'game-over'].includes(room.state.game.phase))
    throw new Error('This hand is in progress. Join after the hand ends.');
  const seat = ([2, 1, 3] as const).find(seat => !room.players[seat]);
  if (seat === undefined) throw new Error('All four seats are taken.');
  room.players[seat] = { name: cleanName(name), token };
  room.state = { ...room.state, revision: room.state.revision + 1, thinkingSeat: null };
  room.updated = now;
  return { roomId: room.state.roomId, token, seat };
}
/** The same guard protects human moves, delayed Walt replies and reconnect retries. */
export function commandRoom(room: SavedRoom, seat: Seat, command: RoomCommand,
  connected: ReadonlySet<Seat>, now = Date.now()): 'duplicate' | 'changed' | 'thinking' {
  if (!command || !COMMAND_ID.test(command.id) || !['start', 'action', 'thinking', 'undo'].includes(command.type)
    || !Number.isSafeInteger(command.revision)) throw new Error('Invalid room command.');
  const key = `${seat}:${command.id}`;
  if (room.accepted.includes(key)) return 'duplicate';
  if (command.revision !== room.state.revision) throw new Error('The table changed. Please try your move again.');
  if (!connected.has(0)) throw new Error('The host disconnected. Play resumes when the host returns.');
  if (room.players.some((player, i) => player && !connected.has(i as Seat)))
    throw new Error('A player disconnected. Play resumes when everyone returns.');
  upgradeRoom(room);
  if (command.type === 'thinking') {
    if (seat !== 0 || (command.seat !== null && (command.seat !== room.state.game?.turn || room.players[command.seat ?? 0])))
      throw new Error('Only the host can run Walt for an empty seat.');
    room.state = { ...room.state, thinkingSeat: command.seat ?? null };
    return 'thinking';
  }
  if (command.type === 'undo') {
    if (seat !== 0) throw new Error('Only the host can take back a move.');
    const target = roomUndoTarget(room);
    if (!target) throw new Error('There is no human move to take back in this hand.');
    room.state = { ...room.state, game: target.game, retry: target.retry, practiceHands: target.practiceHands,
      nativeReceipts: target.nativeReceipts, auctionSurveys: target.auctionSurveys, holdUntil: 0, thinkingSeat: null,
      lastUndo: { revision: room.state.revision + 1, seat: target.seat, name: room.players[target.seat]?.name ?? 'Player' } };
    room.humanSteps = { handNumber: target.game.handNumber,
      indices: room.humanSteps!.indices.filter(index => index < target.kept) };
  } else if (command.type === 'start') {
    if (now < room.state.holdUntil) throw new Error('Please wait for this trick to finish showing.');
    if (seat !== 0) throw new Error('Only the host can start the game.');
    if (room.state.game && room.state.game.phase !== 'game-over') throw new Error('The game is already in progress.');
    const seed = randomKey(16), sessionId = randomKey(16);
    room.state = { ...room.state, seed, sessionId, game: catalogueDeal(newGame(PLUNGE_CONFIG, seed), seed),
      started: true, holdUntil: 0, thinkingSeat: null, nativeReceipts: {}, auctionSurveys: {},
      retry: null, practiceHands: [], lastUndo: null };
    room.humanSteps = { handNumber: 1, indices: [] };
  } else {
    if (now < room.state.holdUntil) throw new Error('Please wait for this trick to finish showing.');
    const game = room.state.game, action = command.action;
    if (!game || !action) throw new Error('Start the game first.');
    if (action.type === 'next-hand') {
      if (seat !== 0) throw new Error('Only the host can deal the next hand.');
    } else if (game.turn === null || (seat !== game.turn && !(seat === 0 && !room.players[game.turn]))) {
      throw new Error('It is not your turn.');
    }
    // Select the engine's canonical action, dropping unknown client properties.
    const legal = legalActions(game).find(candidate => JSON.stringify(candidate) === JSON.stringify(action));
    if (!legal) throw new Error('That move is not legal at this table.');
    if (command.receiptId !== undefined && !/^[a-f0-9]{64}$/.test(command.receiptId)) throw new Error('Invalid Walt receipt.');
    if (command.auction !== undefined && (!['plunge-played-auction-v1', 'walt-auction-v1'].includes(command.auction.schema)
      || command.auction.seat !== game.turn)) throw new Error('Invalid Walt auction evidence.');
    let next = applyAction(game, legal);
    if (legal.type === 'next-hand') {
      next = catalogueDeal(roomAuctionConfig(next), room.state.seed);
      room.humanSteps = { handNumber: next.handNumber, indices: [] };
    } else if (game.turn !== null && room.players[game.turn]) {
      room.humanSteps!.indices = [...room.humanSteps!.indices, handSteps(game).length];
    }
    const receipts = { ...room.state.nativeReceipts }, surveys = { ...room.state.auctionSurveys };
    const ply = game.tricks.reduce((sum, trick) => sum + trick.plays.length, 0) + game.currentTrick.length;
    if (command.receiptId && legal.type === 'play') receipts[`${game.handNumber}:${ply}`] = command.receiptId;
    if (command.auction) surveys[`${game.handNumber}:${game.turn}`] = command.auction;
    room.state = { ...room.state, game: next, thinkingSeat: null,
      holdUntil: next.tricks.length > game.tricks.length ? now + 2000 : 0,
      nativeReceipts: receipts, auctionSurveys: surveys };
    if (legal.type === 'next-hand') room.state = { ...room.state, retry: null, lastUndo: null };
  }
  room.state = { ...room.state, revision: room.state.revision + 1 };
  room.accepted = [...room.accepted.slice(-511), key];
  room.updated = now;
  return 'changed';
}

// Minimal Cloudflare surfaces keep its runtime types out of the browser build.
interface RoomSocket extends WebSocket { serializeAttachment(value: unknown): void; deserializeAttachment(): { seat: Seat; id: string; lastSeen: number } }
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
  private connected(exclude?: RoomSocket): Set<Seat> {
    return new Set(this.ctx.getWebSockets().filter(socket => socket !== exclude && socket.readyState === 1
      && socket.deserializeAttachment().lastSeen + HEARTBEAT > Date.now())
      .map(socket => socket.deserializeAttachment().seat));
  }
  private async nextAlarm(): Promise<void> {
    if (!this.room) return;
    const deadlines = this.ctx.getWebSockets().filter(socket => socket.readyState === 1)
      .map(socket => socket.deserializeAttachment().lastSeen + HEARTBEAT);
    await this.ctx.storage.setAlarm(Math.min(this.room.updated + DAY, ...deadlines));
  }
  private async save(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room);
    await this.nextAlarm();
  }
  private broadcast(exclude?: RoomSocket): void {
    if (!this.room) return;
    const message = JSON.stringify(roomSnapshot(this.room, this.connected(exclude)));
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
      if (operation === 'create' && request.method === 'POST') {
        if (this.room) return json({ error: 'Room already exists.' }, 409);
        const { name } = await roomBody(request);
        this.room = createRoom(roomId, cleanName(name)); await this.save();
        return json({ roomId, token: this.room.players[0]!.token, seat: 0 });
      }
      if (!this.room || this.room.updated + DAY <= Date.now()) return json({ error: 'This room expired. Please create a new one.' }, 404);
      if (operation === 'join' && request.method === 'POST') {
        const { name } = await roomBody(request);
        const credentials = joinRoom(this.room, cleanName(name)); await this.save(); this.broadcast();
        return json(credentials);
      }
      if (operation !== 'socket' || request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'A room connection is required.' }, 426);
      const token = url.searchParams.get('token') ?? '';
      if (!TOKEN.test(token)) return json({ error: 'Your seat key is missing.' }, 401);
      const seat = this.room.players.findIndex(player => player?.token === token);
      if (seat < 0) return json({ error: 'Your seat key is invalid.' }, 401);
      // Refresh replaces this browser's old connection; it cannot create a second actor.
      for (const old of this.ctx.getWebSockets()) if (old.deserializeAttachment().seat === seat) old.close(4001, 'Seat opened in another tab.');
      const pair = new WebSocketPair(), client = pair[0], server = pair[1];
      server.serializeAttachment({ seat: seat as Seat, id: randomKey(8), lastSeen: Date.now() }); this.ctx.acceptWebSocket(server);
      this.room.state = { ...this.room.state, thinkingSeat: null }; this.room.updated = Date.now();
      await this.save(); this.broadcast();
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Cannot open the room.' }, 400); }
  }
  async webSocketMessage(socket: RoomSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    let command: RoomCommand | undefined;
    try {
      if (message === 'ping') {
        socket.serializeAttachment({ ...socket.deserializeAttachment(), lastSeen: Date.now() });
        if (this.room) this.room.updated = Date.now();
        socket.send('pong'); return;
      }
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error('Room message is too large.');
      if (!this.room) throw new Error('This room expired.');
      command = JSON.parse(message) as RoomCommand;
      if (socket.readyState !== 1) throw new Error('This seat connection has closed.');
      const status = commandRoom(this.room, socket.deserializeAttachment().seat, command, this.connected());
      if (status === 'changed') await this.save();
      socket.send(JSON.stringify({ type: 'ack', id: command.id, revision: this.room.state.revision }));
      this.broadcast();
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', ...(command?.id ? { id: command.id } : {}),
        message: error instanceof Error ? error.message : 'Please reconnect to the room.' }));
      this.broadcast();
    }
  }
  async webSocketClose(socket: RoomSocket, code = 1000, reason = ''): Promise<void> {
    await this.ready;
    try { socket.close(code === 1005 ? 1000 : code, reason); } catch { /* Already closed. */ }
    if (this.room) this.room.state = { ...this.room.state, thinkingSeat: null };
    this.broadcast(socket);
  }
  async webSocketError(socket: RoomSocket): Promise<void> { socket.close(1011, 'Please reconnect.'); await this.webSocketClose(socket); }
  async alarm(): Promise<void> {
    await this.ready;
    if (this.room && this.room.updated + DAY > Date.now()) {
      for (const socket of this.ctx.getWebSockets()) if (socket.readyState === 1
        && socket.deserializeAttachment().lastSeen + HEARTBEAT <= Date.now()) socket.close(4002, 'Connection paused. Please reconnect.');
      this.broadcast();
      if (this.connected().size) this.room.updated = Date.now();
      await this.save(); return;
    }
    for (const socket of this.ctx.getWebSockets()) socket.close(4000, 'This room expired.');
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
  return namespace.get(namespace.idFromName(roomId)).fetch(new Request(url, request));
}
