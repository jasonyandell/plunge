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
  const state = (revision?: number) => next((m): m is RoomState => m !== 'pong' && m.type === 'state' && (revision === undefined || m.revision === revision));
  const until = (predicate: (state: RoomState) => boolean, timeout = 3000) => next((m): m is RoomState => m !== 'pong' && m.type === 'state' && predicate(m), timeout);
  const error = (id: string) => next((m): m is Extract<RoomMessage, { type: 'error' }> => m !== 'pong' && m.type === 'error' && m.id === id);
  const ack = (id: string) => next((m): m is Extract<RoomMessage, { type: 'ack' }> => m !== 'pong' && m.type === 'ack' && m.id === id);
  return { socket, next, state, until, error, ack };
}
type Client = Awaited<ReturnType<typeof connect>>;
/** One person asks, the other agrees: the table settles without waiting out the window. */
async function agree(asker: Client, other: Client, kind: string, revision: number, id = `${kind}-${revision}`) {
  asker.socket.send(JSON.stringify({ type: 'propose', id, revision, kind }));
  const asked = await other.until(m => m.proposal?.id === id);
  other.socket.send(JSON.stringify({ type: 'vote', id: `${id}-yes`, proposal: id, vote: 'yes' }));
  const settled = await asker.until(m => m.revision > asked.revision && m.proposal === null);
  expect((await other.until(m => m.revision === settled.revision)).lastVote).toMatchObject({ kind, outcome: 'passed' });
  return settled;
}


it('synchronizes two clients, acknowledges duplicate/stale actions, hands Walt to whoever stays, and restores the exact game after a worker restart', async () => {
  const create = await post('', { name: 'Host' }); expect(create.status).toBe(200);
  const host = await create.json() as RoomCredentials;
  expect(host.roomId).toMatch(/^[a-f0-9]{32}$/); expect(host.token).toMatch(/^[a-f0-9]{64}$/);
  const joinResponse = await post(`/${host.roomId}/join`, { name: 'Partner' }); expect(joinResponse.status).toBe(200);
  const partner = await joinResponse.json() as RoomCredentials; expect(partner.seat).toBe(2);
  const a = await connect(host), b = await connect(partner);
  const lobby = await b.until(m => m.seats[0]?.connected === true && m.seats[2]?.connected === true);
  expect(lobby.runner).toBe(0); expect(lobby.open).toBe(true);
  a.socket.send(JSON.stringify({ type: 'propose', id: 'start', revision: lobby.revision, kind: 'start' }));
  const asked = await b.until(m => m.proposal?.kind === 'start');
  expect(asked.game).toBeNull(); expect(asked.proposal).toMatchObject({ by: 0, byName: 'Host', mode: 'veto', votes: { 0: 'yes' } });
  b.socket.send(JSON.stringify({ type: 'vote', id: 'start-yes', proposal: 'start', vote: 'yes' }));
  const startB = await b.until(m => m.game !== null), startA = await a.until(m => m.revision === startB.revision);
  expect(startA.game).toEqual(startB.game); expect(startB.seats[2]!.connected).toBe(true); expect(startB.proposal).toBeNull();
  const turn = startA.game!.turn!, actor = turn === 2 ? b : a;
  const command = { type: 'action', id: 'move', revision: startA.revision, action: legalActions(startA.game!)[0] };
  actor.socket.send(JSON.stringify(command));
  const movedA = await a.state(startA.revision + 1), movedB = await b.state(startA.revision + 1);
  expect(movedA.game).toEqual(movedB.game);
  actor.socket.send(JSON.stringify(command));
  const duplicate = await actor.ack('move');
  expect(duplicate.revision).toBe(movedA.revision);
  const duplicateState = await actor.state(movedA.revision); expect(duplicateState.game).toEqual(movedA.game);
  actor.socket.send(JSON.stringify({ ...command, id: 'stale' }));
  const stale = await actor.error('stale');
  expect(stale.message).toContain('table changed');
  // Sitting down mid-hand is fine: the newcomer takes a Walt chair and its dominoes.
  const lateResponse = await post(`/${host.roomId}/join`, { name: 'Late' }); expect(lateResponse.status).toBe(200);
  const late = await lateResponse.json() as RoomCredentials; expect(late.seat).toBe(1);
  const seated = await b.until(m => m.seats[1]?.name === 'Late');
  expect(seated.game).toEqual(movedA.game); expect(seated.seats[1]).toMatchObject({ connected: false, away: false });
  b.socket.send('ping'); expect(await b.next((m): m is 'pong' => m === 'pong')).toBe('pong');
  a.socket.close();
  const handed = await b.until(m => m.runner === 2);
  expect(handed.game).toEqual(movedA.game); expect(handed.seats[0]).toMatchObject({ connected: false, away: false });
  const rejoined = await connect(host); expect((await rejoined.until(m => m.runner === 0)).game).toEqual(movedA.game);
  rejoined.socket.close(); b.socket.close(); await mf.dispose();
  mf = new Miniflare(options());
  const restored = await connect(host), snapshot = await restored.state();
  expect(snapshot.game).toEqual(movedA.game); expect(snapshot.revision).toBe(seated.revision);
  expect(snapshot.sessionId).toBe(startA.sessionId); expect(snapshot.seats[1]?.name).toBe('Late'); restored.socket.close();
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

it('settles a shared Undo by vote, rejects old callbacks and duplicate asks, and preserves retry lineage after restart', async () => {
  const host = await (await post('', { name: 'Undo host' })).json() as RoomCredentials;
  const partner = await (await post(`/${host.roomId}/join`, { name: 'Undo partner' })).json() as RoomCredentials;
  const a = await connect(host), b = await connect(partner);
  const lobby = await b.until(m => m.seats[0]?.connected === true && m.seats[2]?.connected === true);
  let state = await agree(a, b, 'start', lobby.revision);
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
  // The partner asks; the host says no within the window.
  b.socket.send(JSON.stringify({ type: 'propose', id: 'guest-takeback', revision: state.revision, kind: 'undo' }));
  const asked = await a.until(m => m.proposal?.id === 'guest-takeback');
  a.socket.send(JSON.stringify({ type: 'vote', id: 'host-no', proposal: 'guest-takeback', vote: 'no' }));
  const refused = await b.until(m => m.revision > asked.revision);
  expect(refused.proposal).toBeNull(); expect(refused.game).toEqual(state.game);
  expect(refused.lastVote).toMatchObject({ kind: 'undo', outcome: 'failed', noFrom: 'Undo host', byName: 'Undo partner' });
  const command = { type: 'propose', id: 'host-takeback', revision: refused.revision, kind: 'undo' };
  a.socket.send(JSON.stringify(command));
  const pendingVote = await b.until(m => m.proposal?.id === 'host-takeback');
  b.socket.send(JSON.stringify({ type: 'vote', id: 'partner-yes', proposal: 'host-takeback', vote: 'yes' }));
  const undone = await a.until(m => m.revision > pendingVote.revision), shared = await b.state(undone.revision);
  expect(undone.game).toEqual(beforeHuman.game); expect(shared.game).toEqual(undone.game);
  expect(undone.retry).toMatchObject({ kind: 'undo', attempt: 1 }); expect(undone.practiceHands).toEqual([1]);
  expect(undone.lastUndo).toMatchObject({ revision: undone.revision, seat: humanSeat });
  expect(undone.lastVote).toMatchObject({ kind: 'undo', outcome: 'passed', revision: undone.revision });
  a.socket.send(JSON.stringify(command));
  await a.ack('host-takeback');
  expect((await a.state(undone.revision)).game).toEqual(undone.game);
  a.socket.send(JSON.stringify({ type: 'action', id: 'old-callback', revision: state.revision, action: legalActions(state.game!)[0] }));
  const stale = await a.error('old-callback');
  expect(stale.message).toContain('table changed');
  a.socket.close(); b.socket.close(); await mf.dispose(); mf = new Miniflare(options());
  const restoredHost = await connect(host), restoredPartner = await connect(partner);
  const restored = await restoredPartner.state();
  expect(restored.game).toEqual(undone.game); expect(restored.revision).toBe(undone.revision);
  expect(restored.retry).toEqual(undone.retry); expect(restored.practiceHands).toEqual(undone.practiceHands);
  expect(restored.lastUndo).toEqual(undone.lastUndo); expect(restored.sessionId).toBe(undone.sessionId);
  restoredHost.socket.close(); restoredPartner.socket.close();
}, 20000);

it('closes the table by vote, lets a visitor knock and come in on one yes, and tells a kicked seat why', async () => {
  const host = await (await post('', { name: 'Door host' })).json() as RoomCredentials;
  const partner = await (await post(`/${host.roomId}/join`, { name: 'Door partner' })).json() as RoomCredentials;
  const a = await connect(host), b = await connect(partner);
  const heartbeat = setInterval(() => { for (const s of [a, b]) if (s.socket.readyState === 1) s.socket.send('ping'); }, 1000);
  const lobby = await b.until(m => m.seats[0]?.connected === true && m.seats[2]?.connected === true);
  const closed = await agree(a, b, 'close', lobby.revision);
  expect(closed.open).toBe(false);
  const refused = await post(`/${host.roomId}/join`, { name: 'Cousin' });
  expect(refused.status).toBe(403); expect(await refused.json()).toMatchObject({ closed: true });
  const visitorId = '0123456789abcdef';
  const visitorSocket = await mf.dispatchFetch(`https://plunge.test/api/rooms/${host.roomId}/socket?visitor=${visitorId}`, { headers: { Upgrade: 'websocket', Origin: 'https://plunge.test' } });
  expect(visitorSocket.status).toBe(101);
  const visitor = await connect({ roomId: host.roomId, token: '', seat: 0 }).catch(() => null);
  expect(visitor).toBeNull(); // A blank token is refused; visitors connect with their visitor id instead.
  const v = visitorSocket.webSocket!; const seen: RoomMessage[] = []; v.addEventListener('message', e => { if (e.data !== 'pong') seen.push(JSON.parse(String(e.data)) as RoomMessage); }); v.accept();
  const wait = async (predicate: (m: RoomMessage) => boolean) => { const end = Date.now() + 3000; while (Date.now() < end) { const found = seen.find(predicate); if (found) return found; await new Promise(r => setTimeout(r, 50)); } throw new Error('Visitor timed out.'); };
  const doorway = await wait(m => m.type === 'state') as RoomState; expect(doorway.visitors).toBe(1); expect(doorway.open).toBe(false);
  v.send(JSON.stringify({ type: 'action', id: 'cheeky', revision: doorway.revision, action: { type: 'next-hand' } }));
  expect(((await wait(m => m.type === 'error')) as Extract<RoomMessage, { type: 'error' }>).message).toContain('Take a seat');
  // The knock lands mid-vote; the vote and the doorbell are answered separately.
  const busy = await a.until(m => m.visitors === 1);
  a.socket.send(JSON.stringify({ type: 'propose', id: 'busy', revision: busy.revision, kind: 'open' }));
  await b.until(m => m.proposal?.id === 'busy');
  v.send(JSON.stringify({ type: 'knock', id: 'knock', name: 'Cousin' }));
  const knocking = await b.until(m => !!m.knocks?.some(entry => entry.visitor === visitorId));
  expect(knocking.proposal).toMatchObject({ id: 'busy', kind: 'open' });
  expect(knocking.knocks).toEqual([{ visitor: visitorId, name: 'Cousin', at: expect.any(Number) }]);
  b.socket.send(JSON.stringify({ type: 'vote', id: 'stay-shut', proposal: 'busy', vote: 'no' }));
  b.socket.send(JSON.stringify({ type: 'door', id: 'let-in', visitor: visitorId, yes: true }));
  const letIn = await wait(m => m.type === 'state' && !!m.knocks?.some(entry => entry.visitor === visitorId && entry.answer)) as RoomState;
  expect(letIn.knocks![0]!.answer).toMatchObject({ by: 'Door partner', yes: true });
  expect(letIn.open).toBe(false);
  const stillClosed = await post(`/${host.roomId}/join`, { name: 'Cousin', knock: 'fedcba9876543210' }); expect(stillClosed.status).toBe(403);
  const admitted = await post(`/${host.roomId}/join`, { name: 'Cousin', knock: visitorId }); expect(admitted.status).toBe(200);
  const cousin = await admitted.json() as RoomCredentials; expect(cousin.seat).toBe(1);
  const c = await connect(cousin); expect((await c.until(m => m.seats[1]?.connected === true)).seats[1]!.name).toBe('Cousin');
  v.close(); c.socket.close();
  // Two of three ask Cousin, now away, to step out; the kicked key no longer opens the seat and its browser is told why.
  const atTable = await a.until(m => m.visitors === 0 && m.seats[1]?.connected === false);
  a.socket.send(JSON.stringify({ type: 'propose', id: 'kick', revision: atTable.revision, kind: 'kick', target: 1 }));
  const asked = await b.until(m => m.proposal?.kind === 'kick');
  expect(asked.proposal).toMatchObject({ target: 1, needs: 'majority' });
  b.socket.send(JSON.stringify({ type: 'vote', id: 'kick-yes', proposal: 'kick', vote: 'yes' }));
  const freed = await a.until(m => m.revision > asked.revision && m.seats[1] === null);
  expect(freed.lastVote).toMatchObject({ kind: 'kick', outcome: 'passed', targetName: 'Cousin' });
  const again = await mf.dispatchFetch(`https://plunge.test/api/rooms/${host.roomId}/socket?token=${cousin.token}`, { headers: { Upgrade: 'websocket', Origin: 'https://plunge.test' } });
  expect(again.status).toBe(101);
  const gone = await new Promise<{ code: number; reason: string }>(resolve => { again.webSocket!.addEventListener('close', e => resolve({ code: e.code, reason: e.reason })); again.webSocket!.accept(); again.webSocket!.send('ping'); });
  expect(gone).toEqual({ code: 4003, reason: 'The table asked you to step out.' });
  expect((await mf.dispatchFetch(`https://plunge.test/api/rooms/${host.roomId}/socket?token=${'1'.repeat(64)}`, { headers: { Upgrade: 'websocket', Origin: 'https://plunge.test' } })).status).toBe(401);
  // Leaving frees the chair the same way, and the leaver's own browser hears it.
  const leftFor = new Promise<{ code: number; reason: string }>(resolve => b.socket.addEventListener('close', e => resolve({ code: e.code, reason: e.reason })));
  b.socket.send(JSON.stringify({ type: 'leave', id: 'bye' }));
  expect(await leftFor).toEqual({ code: 4003, reason: 'You left the table.' });
  expect((await a.until(m => m.revision > freed.revision && m.seats[2] === null)).runner).toBe(0);
  clearInterval(heartbeat); a.socket.close();
}, 20000);

it('hands Walt to the partner within fifteen seconds when the first seat goes silent', async () => {
  const host = await (await post('', { name: 'Host heartbeat' })).json() as RoomCredentials;
  const partner = await (await post(`/${host.roomId}/join`, { name: 'Partner heartbeat' })).json() as RoomCredentials;
  const a = await connect(host), b = await connect(partner);
  const lobby = await b.until(m => m.runner === 0 && m.seats[2]?.connected === true), began = Date.now();
  const heartbeat = setInterval(() => b.socket.send('ping'), 1000);
  try {
    const handed = await b.until(m => m.runner === 2, 17000);
    expect(Date.now() - began).toBeLessThan(17000);
    expect(handed.seats[2]!.connected).toBe(true); expect(handed.seats[0]).toMatchObject({ connected: false, away: false });
    expect(handed.revision).toBe(lobby.revision);
    const resumed = await connect(host); expect((await resumed.until(m => m.runner === 0)).seats[0]!.connected).toBe(true); resumed.socket.close();
  } finally { clearInterval(heartbeat); a.socket.close(); b.socket.close(); }
}, 19000);
