import 'fake-indexeddb/auto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions, type GameState } from '../src/engine';
import { finishedHand } from './hand-fixtures';
import { createRoom, joinRoom, roomHandEntry } from '../worker/rooms';
import { grantFamily, hashToken } from '../worker/accounts';
import type { RoomCredentials, RoomMessage, RoomState } from '../src/room/protocol';

const origin = 'https://plunge.texas42.workers.dev', token = 'e'.repeat(64), dadToken = 'f'.repeat(64), mom = 'c'.repeat(32), dad = 'd'.repeat(32);
let mf: Miniflare, directory: string, db: Awaited<ReturnType<Miniflare['getD1Database']>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plunge-room-stats-'));
  const bundled = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare({ name: 'plunge-room-stats-test', modules: true, script: bundled.outputFiles![0]!.text, compatibilityDate: '2026-05-14',
    d1Databases: ['QUESTIONS'], durableObjects: { ROOMS: { className: 'PlungeRoom', useSQLite: true } }, durableObjectsPersist: directory,
    serviceBindings: { ASSETS: async () => new Response('app') } });
  db = await mf.getD1Database('QUESTIONS');
  const ideas = await readFile(new URL('../migrations/0002_family_ideas.sql', import.meta.url), 'utf8');
  const [tables, trigger] = ideas.split('CREATE TRIGGER'); for (const statement of tables!.split(';').filter(s => s.trim())) await db.prepare(statement).run(); await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for (const file of ['0003_accounts.sql', '0004_family_table.sql', '0004_idea_authorizations.sql', '0005_idea_screenshots.sql', '0005_listed_tables.sql', '0006_hands.sql'])
    for (const statement of (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(s => s.trim())) await db.prepare(statement).run();
  for (const [id, name, t] of [[mom, 'Mom', token], [dad, 'Dad', dadToken]] as const) {
    await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(id, name, Date.now()).run();
    await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(t), id, Date.now() + 86400000).run();
    await grantFamily(db, id, true);
  }
}, 30000);
afterAll(async () => { await mf?.dispose(); await rm(directory, { recursive: true, force: true }); });
const cookie = `__Host-plunge-session=${token}`, dadCookie = `__Host-plunge-session=${dadToken}`;
async function connect(credentials: RoomCredentials) {
  const response = await mf.dispatchFetch(`${origin}/api/rooms/${credentials.roomId}/socket?token=${credentials.token}`, { headers: { Upgrade: 'websocket', Origin: origin } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!, messages: RoomMessage[] = []; let waiters: (() => void)[] = [];
  socket.addEventListener('message', event => { if (event.data !== 'pong') { messages.push(JSON.parse(String(event.data)) as RoomMessage); for (const resolve of waiters.splice(0)) resolve(); } });
  socket.accept();
  // A real client pings every few seconds; a silent seat is handed to Walt after fifteen.
  const ping = setInterval(() => { try { socket.send('ping'); } catch { clearInterval(ping); } }, 4000);
  socket.addEventListener('close', () => clearInterval(ping));
  const next = async <T extends RoomMessage>(predicate: (m: RoomMessage) => m is T, timeout = 5000): Promise<T> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0] as T;
      await Promise.race([new Promise<void>(resolve => { waiters.push(resolve); }), new Promise(resolve => setTimeout(resolve, 50))]);
    }
    throw new Error('Room response timed out.');
  };
  return { socket, next,
    until: (predicate: (s: RoomState) => boolean) => next((m): m is RoomState => m.type === 'state' && predicate(m)),
    outcome: (id: string) => next((m): m is Exclude<RoomMessage, RoomState> => (m.type === 'ack' || m.type === 'error') && m.id === id) };
}
type Client = Awaited<ReturnType<typeof connect>>;
/** One asks, the other agrees: the table settles without waiting out the window. */
async function agree(asker: Client, other: Client, kind: string, revision: number, id = `${kind}-${revision}`): Promise<RoomState> {
  asker.socket.send(JSON.stringify({ type: 'propose', id, revision, kind }));
  const asked = await other.until(m => m.proposal?.id === id);
  other.socket.send(JSON.stringify({ type: 'vote', id: `${id}-yes`, proposal: id, vote: 'yes' }));
  const settled = await asker.until(m => m.revision > asked.revision && m.proposal === null);
  expect((await other.until(m => m.revision === settled.revision)).lastVote).toMatchObject({ kind, outcome: 'passed' });
  return settled;
}
/** Play the hand out: whoever's turn it is acts, the runner acting for Walt chairs; retries past the trick-showing pause. */
async function playOut(a: Client, b: Client, state: RoomState, prefix: string, pick: (legal: ReturnType<typeof legalActions>, game: GameState) => ReturnType<typeof legalActions>[number]): Promise<RoomState> {
  for (let n = 0; state.game!.phase !== 'hand-over' && state.game!.phase !== 'game-over'; n++) {
    const game = state.game!, turn = game.turn!, actor = turn === 2 ? b : a, id = `${prefix}-${n}`;
    actor.socket.send(JSON.stringify({ type: 'action', id, revision: state.revision, action: pick(legalActions(game), game) }));
    const outcome = await actor.outcome(id);
    if (outcome.type === 'error') { expect(outcome.message).toMatch(/wait for this trick/); await new Promise(r => setTimeout(r, 250)); continue; }
    state = await actor.until(m => m.revision === state.revision + 1);
    if (actor === b) await a.until(m => m.revision === state.revision);
  }
  return state;
}
const rows = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all()).results as Record<string, unknown>[];
async function handsSettle(count: number): Promise<string[]> {
  const deadline = Date.now() + 5000; let ids: string[] = [];
  while (Date.now() < deadline && ids.length < count) { ids = (await rows('SELECT id FROM hands ORDER BY id')).map(r => String(r.id)); if (ids.length < count) await new Promise(r => setTimeout(r, 100)); }
  return ids;
}

it('records a finished family-table hand with every human seat, the branch a takeback leaves, and nothing twice', async () => {
  // Mom and Dad sit at the family's standing table through their accounts.
  const table = await mf.dispatchFetch(`${origin}/api/rooms/family`, { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
  expect(table.status).toBe(200);
  const momSeat = await table.json() as RoomCredentials; expect(momSeat.seat).toBe(0);
  const dadSeat = await (await mf.dispatchFetch(`${origin}/api/rooms/family`, { method: 'POST', headers: { Origin: origin, Cookie: dadCookie } })).json() as RoomCredentials;
  expect(dadSeat.roomId).toBe(momSeat.roomId); expect(dadSeat.seat).toBe(2);
  const a = await connect(momSeat), b = await connect(dadSeat);
  const lobby = await b.until(m => m.seats[0]?.connected === true && m.seats[2]?.connected === true);
  let state = await agree(a, b, 'start', lobby.revision);
  expect(state.game).not.toBeNull();
  state = await playOut(a, b, state, 'move', (legal, game) => game.bids.length === 0 ? legal.find(x => x.type === 'bid' && x.bid.kind === 'points') ?? legal[0]! : legal[0]!);
  const [handId] = await handsSettle(1);
  expect(handId).toBe(`room:${momSeat.roomId}:${state.sessionId}:1`);
  const [hand] = await rows('SELECT * FROM hands WHERE id=?', handId);
  expect(hand).toMatchObject({ room_id: momSeat.roomId, walt: null, finished: 1 });
  expect(String(hand!.deal)).toHaveLength(57);
  expect(JSON.parse(String(hand!.payload))).toMatchObject({ schema: 'plunge-hand-v1', gameId: state.sessionId, handNumber: 1, player: 'room', marksAfter: state.game!.marks });
  expect(await rows('SELECT seat,account_id,device_id,name FROM hand_players WHERE hand_id=? ORDER BY seat', handId)).toEqual([
    { seat: 0, account_id: mom, device_id: null, name: 'Mom' }, { seat: 2, account_id: dad, device_id: null, name: 'Dad' }]);
  // Mom's account counts the room hand as its own.
  const mine = await mf.dispatchFetch(`${origin}/api/stats/hands`, { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ device: '3'.repeat(32), hands: [] }) });
  expect(await mine.json()).toMatchObject({ account: mom, total: 1 });
  // The table takes back the last human move: the finished hand stays as written, and the replayed ending is its own attempt.
  state = await agree(a, b, 'undo', state.revision);
  expect(state.retry).toMatchObject({ handNumber: 1, attempt: 1 });
  state = await playOut(a, b, state, 'again', legal => legal[legal.length - 1]!);
  expect(await handsSettle(2)).toEqual([`room:${momSeat.roomId}:${state.sessionId}-r1:1`, handId]);
  expect(JSON.parse(String((await rows('SELECT payload FROM hands WHERE id=?', handId))[0]!.payload))).toEqual(JSON.parse(String(hand!.payload)));
  // Shaking the next hand (once the last trick has been shown) records nothing new.
  await new Promise(r => setTimeout(r, 2200));
  state = await agree(a, b, 'next-hand', state.revision);
  expect(state.game!.handNumber).toBe(2);
  expect((await rows('SELECT COUNT(*) n FROM hands'))[0]!.n).toBe(2);
  a.socket.close(); b.socket.close();
}, 60000);

it('records each attempt once: a finished hand, a branch left part-way, a retry under its own id', () => {
  // An invite room: open to anyone by name. A seat may carry an account or not.
  const room = createRoom('1'.repeat(32), 'Host');
  room.players[0]!.account = mom;
  joinRoom(room, 'Dad');
  const game: GameState = finishedHand('room-unit');
  room.state = { ...room.state, sessionId: 'abcd', game };
  const entry = roomHandEntry(room);
  expect(entry).toMatchObject({ roomId: '1'.repeat(32), record: { id: 'abcd:1', player: 'room' } });
  expect(entry!.players).toEqual([{ seat: 0, name: 'Host', account: mom }, { seat: 2, name: 'Dad', account: null }]);
  expect(roomHandEntry(room)).toBeNull();
  const partial = finishedHand('room-unit', true, 6);
  expect(partial.phase).toBe('playing');
  expect(roomHandEntry(room, { ...room.state, sessionId: 'left', game: partial })).toMatchObject({ record: { id: 'left:1' } });
  const retry = { handNumber: 1, attempt: 1, kind: 'undo' as const, kept: 3, from: { code: null, phase: 'hand-over' as const, marks: [0, 0] as [number, number], handResult: null, winner: null, thrownIn: false }, sawResult: true };
  expect(roomHandEntry(room, { ...room.state, retry, practiceHands: [1] })).toMatchObject({ record: { id: 'abcd-r1:1', gameId: 'abcd-r1', practiceHands: [1] } });
  expect(roomHandEntry(room, { ...room.state, game: { ...game, bids: [] } })).toBeNull();
});
