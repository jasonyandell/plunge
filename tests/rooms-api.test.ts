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
