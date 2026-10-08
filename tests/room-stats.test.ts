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
import { hashToken } from '../worker/accounts';
import type { RoomCredentials, RoomMessage, RoomState } from '../src/room/protocol';

const origin = 'https://plunge.texas42.workers.dev', token = 'e'.repeat(64), host = 'c'.repeat(32);
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
  for (const file of ['0003_accounts.sql', '0004_hands.sql'])
    for (const statement of (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(s => s.trim())) await db.prepare(statement).run();
  await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(host, 'Jason', Date.now()).run();
  await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token), host, Date.now() + 86400000).run();
}, 30000);
afterAll(async () => { await mf?.dispose(); await rm(directory, { recursive: true, force: true }); });
const cookie = `__Host-plunge-session=${token}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => mf.dispatchFetch(`${origin}/api/rooms${path}`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: origin, ...headers } });
async function connect(credentials: RoomCredentials, headers: Record<string, string> = {}) {
  const response = await mf.dispatchFetch(`${origin}/api/rooms/${credentials.roomId}/socket?token=${credentials.token}`, { headers: { Upgrade: 'websocket', Origin: origin, ...headers } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!, messages: RoomMessage[] = []; let waiters: (() => void)[] = [];
  socket.addEventListener('message', event => { if (event.data !== 'pong') { messages.push(JSON.parse(String(event.data)) as RoomMessage); for (const resolve of waiters.splice(0)) resolve(); } });
  socket.accept();
  const next = async <T extends RoomMessage>(predicate: (m: RoomMessage) => m is T, timeout = 5000): Promise<T> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0] as T;
      await Promise.race([new Promise<void>(resolve => { waiters.push(resolve); }), new Promise(resolve => setTimeout(resolve, 50))]);
    }
    throw new Error('Room response timed out.');
  };
  return { socket, next, state: (revision?: number) => next((m): m is RoomState => m.type === 'state' && (revision === undefined || m.revision === revision)),
    outcome: (id: string) => next((m): m is RoomMessage => (m.type === 'ack' || m.type === 'error') && m.id === id) };
}

it('records a finished room hand once, with every human seat, the moment it ends, and the branch a takeback leaves', async () => {
  const create = await post('', { name: 'Jason' }, { Cookie: cookie }); expect(create.status).toBe(200);
  const hostSeat = await create.json() as RoomCredentials;
  const partner = await (await post(`/${hostSeat.roomId}/join`, { name: 'Dad' })).json() as RoomCredentials; expect(partner.seat).toBe(2);
  const a = await connect(hostSeat), b = await connect(partner);
  let state = await a.state();
  a.socket.send(JSON.stringify({ type: 'start', id: 'start', revision: state.revision }));
  state = await a.state(state.revision + 1);
  let n = 0;
  while (state.game!.phase !== 'hand-over' && state.game!.phase !== 'game-over') {
    const game = state.game!, turn = game.turn!, actor = turn === 2 ? b : a, id = `move-${n++}`;
    const legal = legalActions(game), action = game.bids.length === 0 ? legal.find(x => x.type === 'bid' && x.bid.kind === 'points') ?? legal[0] : legal[0];
    actor.socket.send(JSON.stringify({ type: 'action', id, revision: state.revision, action }));
    const outcome = await actor.outcome(id);
    if (outcome.type === 'error') { expect(outcome.message).toMatch(/wait for this trick/); await new Promise(r => setTimeout(r, 250)); continue; }
    state = await actor.state(state.revision + 1);
    if (actor === b) await a.state(state.revision);
  }
  expect(n).toBeGreaterThan(10);
  const deadline = Date.now() + 5000; let rows: Record<string, unknown>[] = [];
  while (Date.now() < deadline && !rows.length) { rows = (await db.prepare('SELECT * FROM hands').all()).results as Record<string, unknown>[]; if (!rows.length) await new Promise(r => setTimeout(r, 100)); }
  expect(rows).toHaveLength(1);
  const hand = rows[0]!;
  expect(hand).toMatchObject({ id: `room:${hostSeat.roomId}:${state.sessionId}:1`, room_id: hostSeat.roomId, walt: null, finished: 1 });
  expect(hand.deal).toHaveLength(57);
  expect(JSON.parse(String(hand.payload))).toMatchObject({ schema: 'plunge-hand-v1', gameId: state.sessionId, handNumber: 1, player: 'room', marksAfter: state.game!.marks });
  // Only human seats: the host's carries the account from the session cookie, the partner's just a name.
  expect((await db.prepare('SELECT seat,account_id,device_id,name FROM hand_players WHERE hand_id=? ORDER BY seat').bind(hand.id).all()).results).toEqual([
    { seat: 0, account_id: host, device_id: null, name: 'Jason' }, { seat: 2, account_id: null, device_id: null, name: 'Dad' }]);
  // The host's account counts the room hand as its own.
  const mine = await mf.dispatchFetch(`${origin}/api/stats/hands`, { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ device: '3'.repeat(32), hands: [] }) });
  expect(await mine.json()).toMatchObject({ account: host, total: 1 });
  // The host takes back the last human move: the finished hand stays as written, and the replayed ending is its own attempt.
  a.socket.send(JSON.stringify({ type: 'undo', id: 'undo', revision: state.revision }));
  expect((await a.outcome('undo')).type).toBe('ack');
  state = await a.state(state.revision + 1);
  expect(state.retry).toMatchObject({ handNumber: 1, attempt: 1 });
  while (state.game!.phase !== 'hand-over' && state.game!.phase !== 'game-over') {
    const game = state.game!, turn = game.turn!, actor = turn === 2 ? b : a, id = `again-${n++}`;
    const legal = legalActions(game), action = legal[legal.length - 1];
    actor.socket.send(JSON.stringify({ type: 'action', id, revision: state.revision, action }));
    const outcome = await actor.outcome(id);
    if (outcome.type === 'error') { expect(outcome.message).toMatch(/wait for this trick/); await new Promise(r => setTimeout(r, 250)); continue; }
    state = await actor.state(state.revision + 1);
    if (actor === b) await a.state(state.revision);
  }
  const after = Date.now() + 5000; let ids: string[] = [];
  while (Date.now() < after && ids.length < 2) { ids = ((await db.prepare('SELECT id FROM hands ORDER BY id').all()).results as { id: string }[]).map(r => r.id); if (ids.length < 2) await new Promise(r => setTimeout(r, 100)); }
  expect(ids).toEqual([`room:${hostSeat.roomId}:${state.sessionId}-r1:1`, `room:${hostSeat.roomId}:${state.sessionId}:1`]);
  expect(JSON.parse(String((await db.prepare('SELECT payload FROM hands WHERE id=?').bind(hand.id).first<{ payload: string }>())!.payload))).toEqual(JSON.parse(String(hand.payload)));
  // Dealing the next hand (after the trick-showing pause) records nothing new.
  for (let attempt = 0; ; attempt++) {
    a.socket.send(JSON.stringify({ type: 'action', id: `deal-${attempt}`, revision: state.revision, action: { type: 'next-hand' } }));
    const outcome = await a.outcome(`deal-${attempt}`);
    if (outcome.type !== 'error') break;
    expect(outcome.message).toMatch(/wait for this trick/); await new Promise(r => setTimeout(r, 300));
  }
  state = await a.state(state.revision + 1);
  expect(state.game!.handNumber).toBe(2);
  expect((await db.prepare('SELECT COUNT(*) n FROM hands').first<{ n: number }>())!.n).toBe(2);
  a.socket.close(); b.socket.close();
}, 60000);

it('records each attempt once: a finished hand, a branch left part-way, a retry under its own id', () => {
  const room = createRoom('1'.repeat(32), 'Host', undefined, undefined, host);
  joinRoom(room, 'Mom', undefined, undefined, null);
  const game: GameState = finishedHand('room-unit');
  room.state = { ...room.state, sessionId: 'abcd', game };
  const entry = roomHandEntry(room);
  expect(entry).toMatchObject({ roomId: '1'.repeat(32), record: { id: 'abcd:1', player: 'room' } });
  expect(entry!.players).toEqual([{ seat: 0, name: 'Host', account: host }, { seat: 2, name: 'Mom', account: null }]);
  expect(roomHandEntry(room)).toBeNull();
  const partial = finishedHand('room-unit', true, 6);
  expect(partial.phase).toBe('playing');
  expect(roomHandEntry(room, { ...room.state, sessionId: 'left', game: partial })).toMatchObject({ record: { id: 'left:1', code: expect.not.stringMatching(new RegExp(`^${entry!.record.code}$`)) } });
  const retry = { handNumber: 1, attempt: 1, kind: 'undo' as const, kept: 3, from: { code: null, phase: 'hand-over' as const, marks: [0, 0] as [number, number], handResult: null, winner: null, thrownIn: false }, sawResult: true };
  expect(roomHandEntry(room, { ...room.state, retry, practiceHands: [1] })).toMatchObject({ record: { id: 'abcd-r1:1', gameId: 'abcd-r1', practiceHands: [1] } });
  expect(roomHandEntry(room, { ...room.state, game: { ...game, bids: [] } })).toBeNull();
});
