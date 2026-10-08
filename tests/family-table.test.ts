import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grantFamily, hashToken } from '../worker/accounts';
import { createRoom, roomLifetime } from '../worker/rooms';
import type { ListedTable, RoomCredentials } from '../src/room/protocol';

let mf: Miniflare, directory: string;
const origin = 'https://plunge.test';
const sessions: Record<string, string> = {};
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plunge-family-'));
  const bundled = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare({ name: 'plunge-family-test', modules: true, script: bundled.outputFiles![0]!.text, compatibilityDate: '2026-05-14',
    durableObjects: { ROOMS: { className: 'PlungeRoom', useSQLite: true } }, durableObjectsPersist: directory,
    d1Databases: ['QUESTIONS'], serviceBindings: { ASSETS: async () => new Response('app') } });
  const db = await mf.getD1Database('QUESTIONS');
  const ideas = await readFile(new URL('../migrations/0002_family_ideas.sql', import.meta.url), 'utf8');
  const [tables, trigger] = ideas.split('CREATE TRIGGER');
  for (const statement of tables!.split(';').filter(s => s.trim())) await db.prepare(statement).run();
  await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for (const file of ['0003_accounts.sql', '0004_family_table.sql', '0005_listed_tables.sql'])
    for (const statement of (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).split(';').filter(s => s.trim())) await db.prepare(statement).run();
  for (const [id, name, family] of [['1'.repeat(32), 'Mom', true], ['2'.repeat(32), 'Dad', true], ['3'.repeat(32), 'Stranger', false]] as const) {
    await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(id, name, Date.now()).run();
    const token = id.slice(0, 1).repeat(64);
    await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token), id, Date.now() + 86400000).run();
    sessions[name] = `__Host-plunge-session=${token}`;
    if (family) await grantFamily(db, id, true);
  }
}, 30000);
afterAll(async () => { await mf?.dispose(); await rm(directory, { recursive: true, force: true }); });
const family = (cookie?: string, extra: Record<string, string> = {}) => mf.dispatchFetch(`${origin}/api/rooms/family`, { method: 'POST',
  headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...extra } });
const post = (path: string, body: unknown, extra: Record<string, string> = {}) => mf.dispatchFetch(`${origin}/api/rooms${path}`, { method: 'POST',
  body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: origin, ...extra } });

it('seats signed-in family at one standing table, gives each account its own chair back, and ignores forged identities', async () => {
  const probe = (cookie?: string) => mf.dispatchFetch(`${origin}/api/rooms/family`, { headers: cookie ? { Cookie: cookie } : {} }).then(r => r.json());
  expect(await probe()).toEqual({ family: false }); expect(await probe(sessions.Stranger)).toEqual({ family: false }); expect(await probe(sessions.Mom)).toEqual({ family: true, name: 'Mom' });
  expect((await family()).status).toBe(401);
  expect((await family(sessions.Stranger)).status).toBe(403);
  expect((await family(sessions.Mom, { Origin: 'https://other.test' })).status).toBe(403);
  const first = await family(sessions.Mom); expect(first.status).toBe(200);
  const mom = await first.json() as RoomCredentials;
  expect(mom.roomId).toMatch(/^[a-f0-9]{32}$/); expect(mom.seat).toBe(0);
  const again = await (await family(sessions.Mom)).json() as RoomCredentials;
  expect(again).toEqual(mom); // Same table, same chair, same key from another device.
  const dad = await (await family(sessions.Dad)).json() as RoomCredentials;
  expect(dad.roomId).toBe(mom.roomId); expect(dad.seat).toBe(2); expect(dad.token).not.toBe(mom.token);
  // A browser cannot claim Mom's chair by naming her account; the entry worker strips that
  // header, so the impostor meets the closed door like any newcomer instead of getting her key.
  const forged = await post(`/${mom.roomId}/join`, { name: 'Mom' }, { 'X-Plunge-Account': JSON.stringify({ id: '1'.repeat(32), name: 'Mom' }) });
  expect(forged.status).toBe(403);
  expect(await forged.json()).toMatchObject({ closed: true });
  // Nor can an invite room be made standing from outside.
  const plain = await (await post('', { name: 'Anyone', standing: true })).json() as RoomCredentials;
  expect(plain.roomId).not.toBe(mom.roomId);
  const standing = createRoom('a'.repeat(32), 'Mom', undefined, 1000, { standing: true, account: '1'.repeat(32) });
  expect(roomLifetime(standing)).toBe(30 * 24 * 60 * 60 * 1000);
  expect(roomLifetime(createRoom('b'.repeat(32), 'Anyone'))).toBe(24 * 60 * 60 * 1000);
  expect(standing.players[0]).toMatchObject({ account: '1'.repeat(32) });
  // A table a signed-in member opens is listed for anyone, so it starts closed; an invite room stays open.
  expect(standing.state.open).toBe(false);
  expect(createRoom('b'.repeat(32), 'Anyone').state.open).toBe(true);
}, 20000);

it('lists the tables family members opened for anyone to find, seats members under their account name, and forgets tables that are gone', async () => {
  const db = await mf.getD1Database('QUESTIONS');
  const live = () => mf.dispatchFetch(`${origin}/api/rooms/live`).then(r => r.json() as Promise<{ tables: ListedTable[] }>).then(b => b.tables);
  const mom = await (await family(sessions.Mom)).json() as RoomCredentials;
  // Signed out, Mom's standing table is still there to knock at.
  let tables = await live();
  expect(tables.map(t => t.roomId)).toContain(mom.roomId);
  const standing = tables.find(t => t.roomId === mom.roomId)!;
  expect(standing).toMatchObject({ standing: true, open: false, started: false });
  expect(standing.seats[0]).toEqual({ name: 'Mom', connected: false });
  // A table Mom opens sits under her account name whatever the browser typed, and is listed, closed.
  const opened = await (await post('', { name: 'Whoever' }, { Cookie: sessions.Mom! })).json() as RoomCredentials;
  const anon = await (await post('', { name: 'Passerby' })).json() as RoomCredentials;
  const stranger = await (await post('', { name: 'Stranger' }, { Cookie: sessions.Stranger! })).json() as RoomCredentials;
  tables = await live();
  expect(tables.map(t => t.roomId)).toEqual([mom.roomId, opened.roomId]); // Standing first; strangers' and anonymous rooms stay private to their links.
  expect(tables[1]!.seats[0]).toEqual({ name: 'Mom', connected: false });
  expect(tables[1]!.open).toBe(false);
  expect((await post(`/${opened.roomId}/join`, { name: 'Cousin' })).status).toBe(403); // Knock, like anyone.
  expect((await post(`/${anon.roomId}/join`, { name: 'Cousin' })).status).toBe(200); // The link is the door.
  expect((await post(`/${stranger.roomId}/join`, { name: 'Cousin' })).status).toBe(200);
  // Mom joining her own listed table from another device gets the same chair back by account.
  const again = await (await post(`/${opened.roomId}/join`, { name: 'Mom on the tablet' }, { Cookie: sessions.Mom! })).json() as RoomCredentials;
  expect(again).toEqual(opened);
  // A row for a room the coordinator no longer has is dropped the first time the list is read.
  await db.prepare('INSERT INTO listed_tables(room_id, account_id, created) VALUES (?, ?, ?)').bind('c'.repeat(32), '1'.repeat(32), Date.now() + 1).run();
  expect((await live()).map(t => t.roomId)).toEqual([mom.roomId, opened.roomId]);
  expect(await db.prepare('SELECT room_id FROM listed_tables WHERE room_id = ?').bind('c'.repeat(32)).first()).toBeNull();
  // Browsers reach tables through the list, never the coordinator's peek.
  expect((await mf.dispatchFetch(`${origin}/api/rooms/${mom.roomId}/peek`)).status).toBe(404);
  expect((await mf.dispatchFetch(`${origin}/api/rooms/live`, { method: 'POST' })).status).toBe(405);
}, 20000);
