import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../src/engine';
import type { RoomCredentials, RoomMessage, RoomState } from '../src/room/protocol';

let mf: Miniflare, script: string, directory: string;
const options = () => ({ name: 'plunge-rooms-test', modules: true, script,
  compatibilityDate: '2026-05-14', durableObjects: { ROOMS: { className: 'PlungeRoom', useSQLite: true } },
  durableObjectsPersist: directory, serviceBindings: { ASSETS: async () => new Response('app') } });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plunge-rooms-'));
  const bundled = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  script = bundled.outputFiles![0]!.text; mf = new Miniflare(options());
}, 20000);
afterAll(async () => { await mf?.dispose(); await rm(directory, { recursive: true, force: true }); });
const post = async (path: string, body: unknown) => mf.dispatchFetch(`https://plunge.test/api/rooms${path}`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: 'https://plunge.test' },
});
async function connect(credentials: RoomCredentials) {
  const response = await mf.dispatchFetch(`https://plunge.test/api/rooms/${credentials.roomId}/socket?token=${credentials.token}`, {
    headers: { Upgrade: 'websocket', Origin: 'https://plunge.test' },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const messages: (RoomMessage | 'pong')[] = [];
  let waiters: (() => void)[] = [];
  socket.addEventListener('message', event => {
    messages.push(event.data === 'pong' ? 'pong' : JSON.parse(String(event.data)) as RoomMessage);
    for (const resolve of waiters.splice(0)) resolve();
  });
  socket.accept();
  const next = async <T extends RoomMessage | 'pong'>(predicate: (message: RoomMessage | 'pong') => message is T, timeout = 3000): Promise<T> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0] as T;
      await Promise.race([new Promise<void>(resolve => { waiters.push(resolve); }), new Promise(resolve => setTimeout(resolve, 100))]);
    }
    throw new Error('Room response timed out.');
  };
  return { socket, next, state: (revision?: number) => next((m): m is RoomState => m !== 'pong' && m.type === 'state' && (revision === undefined || m.revision === revision)) };
}

it('synchronizes two clients, acknowledges duplicate/stale actions, and restores the exact game after a worker restart', async () => {
  const create = await post('', { name: 'Host' }); expect(create.status).toBe(200);
  const host = await create.json() as RoomCredentials;
  expect(host.roomId).toMatch(/^[a-f0-9]{32}$/); expect(host.token).toMatch(/^[a-f0-9]{64}$/);
  const joinResponse = await post(`/${host.roomId}/join`, { name: 'Partner' }); expect(joinResponse.status).toBe(200);
  const partner = await joinResponse.json() as RoomCredentials; expect(partner.seat).toBe(2);
  const a = await connect(host), b = await connect(partner);
  const lobby = await b.state(); expect(lobby.hostConnected).toBe(true);
  a.socket.send(JSON.stringify({ type: 'start', id: 'start', revision: lobby.revision }));
  const startA = await a.state(lobby.revision + 1), startB = await b.state(lobby.revision + 1);
  expect(startA.game).toEqual(startB.game); expect(startB.seats[2]!.connected).toBe(true);
  const turn = startA.game!.turn!, actor = turn === 2 ? b : a;
  const command = { type: 'action', id: 'move', revision: startA.revision, action: legalActions(startA.game!)[0] };
  actor.socket.send(JSON.stringify(command));
  const movedA = await a.state(startA.revision + 1), movedB = await b.state(startA.revision + 1);
  expect(movedA.game).toEqual(movedB.game);
  actor.socket.send(JSON.stringify(command));
  const duplicate = await actor.next((m): m is Extract<RoomMessage, { type: 'ack' }> => m !== 'pong' && m.type === 'ack' && m.id === 'move');
  expect(duplicate.revision).toBe(movedA.revision);
  const duplicateState = await actor.state(movedA.revision); expect(duplicateState.game).toEqual(movedA.game);
  actor.socket.send(JSON.stringify({ ...command, id: 'stale' }));
  const stale = await actor.next((m): m is Extract<RoomMessage, { type: 'error' }> => m !== 'pong' && m.type === 'error' && m.id === 'stale');
  expect(stale.message).toContain('table changed');
  expect((await post(`/${host.roomId}/join`, { name: 'Too late' })).status).toBe(400);
  b.socket.send('ping'); expect(await b.next((m): m is 'pong' => m === 'pong')).toBe('pong');
  a.socket.close();
  const paused = await b.next((m): m is RoomState => m !== 'pong' && m.type === 'state' && !m.hostConnected);
  expect(paused.game).toEqual(movedA.game);
  const rejoined = await connect(host); expect((await rejoined.state()).game).toEqual(movedA.game);
  rejoined.socket.close(); b.socket.close(); await mf.dispose();
  mf = new Miniflare(options());
  const restored = await connect(host), snapshot = await restored.state();
  expect(snapshot.game).toEqual(movedA.game); expect(snapshot.revision).toBe(movedA.revision);
  expect(snapshot.sessionId).toBe(startA.sessionId); restored.socket.close();
}, 20000);

it('isolates room capability tokens, checks origin, and retains no question backend', async () => {
  const response = await post('', { name: 'Other host' }), host = await response.json() as RoomCredentials;
  const bad = await mf.dispatchFetch(`https://plunge.test/api/rooms/${host.roomId}/socket?token=${'0'.repeat(64)}`, { headers: { Upgrade: 'websocket' } });
  expect(bad.status).toBe(401);
  expect((await mf.dispatchFetch('https://plunge.test/api/rooms', { method: 'POST', headers: { Origin: 'https://other.test' }, body: '{}' })).status).toBe(403);
  expect((await post('', { name: 'x'.repeat(2000) })).status).toBe(400);
  expect((await mf.dispatchFetch('https://plunge.test/api/questions')).status).toBe(503);
  expect(await (await mf.dispatchFetch('https://plunge.test/api/rooms/status')).json()).toEqual({ experimental: true });
}, 10000);

it('synchronizes host Undo, rejects old callbacks and duplicate takebacks, and preserves retry lineage after restart', async () => {
  const host = await (await post('', { name: 'Undo host' })).json() as RoomCredentials;
  const partner = await (await post(`/${host.roomId}/join`, { name: 'Undo partner' })).json() as RoomCredentials;
  const a = await connect(host), b = await connect(partner), lobby = await b.state();
  a.socket.send(JSON.stringify({ type: 'start', id: 'start', revision: lobby.revision }));
  let state = await a.state(lobby.revision + 1); await b.state(state.revision);
  const action = async (at: RoomState) => {
    const turn = at.game!.turn!, actor = turn === 2 ? b : a;
    const choices = legalActions(at.game!);
    const chosen = choices.find(candidate => candidate.type === 'bid' && candidate.bid.kind === 'marks' && candidate.bid.value === 1) ?? choices[0]!;
    const command = { type: 'action', id: `action-${at.revision}`, revision: at.revision, action: chosen };
    actor.socket.send(JSON.stringify(command));
    const next = await a.state(at.revision + 1); expect((await b.state(next.revision)).game).toEqual(next.game);
    return next;
  };
  while (!state.seats[state.game!.turn!]) state = await action(state);
  const beforeHuman = state, humanSeat = state.game!.turn!;
  state = await action(state);
  if (!state.seats[state.game!.turn!]) state = await action(state);
  expect(state.canUndo).toBe(true);
  b.socket.send(JSON.stringify({ type: 'undo', id: 'guest-takeback', revision: state.revision }));
  const guestError = await b.next((m): m is Extract<RoomMessage, { type: 'error' }> => m !== 'pong' && m.type === 'error' && m.id === 'guest-takeback');
  expect(guestError.message).toContain('Only the host');
  const command = { type: 'undo', id: 'host-takeback', revision: state.revision };
  a.socket.send(JSON.stringify(command));
  const undone = await a.state(state.revision + 1), shared = await b.state(state.revision + 1);
  expect(undone.game).toEqual(beforeHuman.game); expect(shared.game).toEqual(undone.game);
  expect(undone.retry).toMatchObject({ kind: 'undo', attempt: 1 }); expect(undone.practiceHands).toEqual([1]);
  expect(undone.lastUndo).toMatchObject({ revision: undone.revision, seat: humanSeat });
  a.socket.send(JSON.stringify(command));
  await a.next((m): m is Extract<RoomMessage, { type: 'ack' }> => m !== 'pong' && m.type === 'ack' && m.id === 'host-takeback');
  expect((await a.state(undone.revision)).game).toEqual(undone.game);
  a.socket.send(JSON.stringify({ type: 'action', id: 'old-callback', revision: state.revision, action: legalActions(state.game!)[0] }));
  const stale = await a.next((m): m is Extract<RoomMessage, { type: 'error' }> => m !== 'pong' && m.type === 'error' && m.id === 'old-callback');
  expect(stale.message).toContain('table changed');
  a.socket.close(); b.socket.close(); await mf.dispose(); mf = new Miniflare(options());
  const restoredHost = await connect(host), restoredPartner = await connect(partner);
  const restored = await restoredPartner.state();
  expect(restored.game).toEqual(undone.game); expect(restored.revision).toBe(undone.revision);
  expect(restored.retry).toEqual(undone.retry); expect(restored.practiceHands).toEqual(undone.practiceHands);
  expect(restored.lastUndo).toEqual(undone.lastUndo); expect(restored.sessionId).toBe(undone.sessionId);
  restoredHost.socket.close(); restoredPartner.socket.close();
}, 20000);

it('pauses a silently suspended host within fifteen seconds while the partner remains connected', async () => {
  const host = await (await post('', { name: 'Host heartbeat' })).json() as RoomCredentials;
  const partner = await (await post(`/${host.roomId}/join`, { name: 'Partner heartbeat' })).json() as RoomCredentials;
  const a = await connect(host), b = await connect(partner);
  const lobby = await b.state(), began = Date.now();
  expect(lobby.hostConnected).toBe(true);
  const heartbeat = setInterval(() => b.socket.send('ping'), 1000);
  try {
    const paused = await b.next((m): m is RoomState => m !== 'pong' && m.type === 'state' && !m.hostConnected, 17000);
    expect(Date.now() - began).toBeLessThan(17000);
    expect(paused.seats[2]!.connected).toBe(true);
    const resumed = await connect(host); expect((await resumed.state()).hostConnected).toBe(true); resumed.socket.close();
  } finally { clearInterval(heartbeat); a.socket.close(); b.socket.close(); }
}, 19000);
