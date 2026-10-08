import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grantFamily, hashToken } from '../worker/accounts';
import { createRoom, roomLifetime } from '../worker/rooms';
import type { RoomCredentials } from '../src/room/protocol';

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
  for (const file of ['0003_accounts.sql', '0004_family_table.sql'])
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
  expect(await probe()).toEqual({ family: false }); expect(await probe(sessions.Stranger)).toEqual({ family: false }); expect(await probe(sessions.Mom)).toEqual({ family: true });
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
  // A browser cannot claim Mom's chair by naming her account; the entry worker strips that header.
  const forged = await post(`/${mom.roomId}/join`, { name: 'Mom' }, { 'X-Plunge-Account': JSON.stringify({ id: '1'.repeat(32), name: 'Mom' }) });
  expect(forged.status).toBe(200);
  const impostor = await forged.json() as RoomCredentials;
  expect(impostor.seat).toBe(1); expect(impostor.token).not.toBe(mom.token);
  // Nor can an invite room be made standing from outside.
  const plain = await (await post('', { name: 'Anyone', standing: true })).json() as RoomCredentials;
  expect(plain.roomId).not.toBe(mom.roomId);
  const standing = createRoom('a'.repeat(32), 'Mom', undefined, 1000, { standing: true, account: '1'.repeat(32) });
  expect(roomLifetime(standing)).toBe(30 * 24 * 60 * 60 * 1000);
  expect(roomLifetime(createRoom('b'.repeat(32), 'Anyone'))).toBe(24 * 60 * 60 * 1000);
  expect(standing.players[0]).toMatchObject({ account: '1'.repeat(32) });
}, 20000);
