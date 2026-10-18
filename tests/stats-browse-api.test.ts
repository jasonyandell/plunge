import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import type { IdeasDatabase } from '../worker/ideas';
import { hashToken } from '../worker/accounts';
import { handStatements, handId, type HandEntry } from '../worker/stats';
import { finishedRecord, partialRecord } from './hand-fixtures';
import { legalActions, type Action } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { handSteps } from '../src/engine/hand-history';
import { actionKey, ghostProgress, type ReplayAttempt } from '../src/stats/ghost';

const origin = 'https://plunge.texas42.workers.dev', alice = 'a'.repeat(32), bob = 'b'.repeat(32), outsider = 'c'.repeat(32);
let mf: Miniflare, env: Parameters<typeof worker.fetch>[1], db: IdeasDatabase;
const cookie = (id: string) => id ? `__Host-plunge-session=${id[0]!.repeat(64)}` : '';
const call = (path: string, account = alice, method = 'GET', body?: unknown, from = origin) => worker.fetch(new Request(`${origin}/api/stats/${path}`, {
  method, headers: { Cookie: cookie(account), Origin: from }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env);
const entry = (account: string, record: HandEntry['record']): HandEntry => ({ record, players: [{ seat: 0, account, device: account }] });
const own = entry(alice, finishedRecord('browse-own')), partial = entry(alice, partialRecord('browse-partial', 'part-game', 6));
const shared = entry(bob, finishedRecord('browse-family')), privateHand = entry(outsider, finishedRecord('browse-private'));
const replayPath = (id = handId(own)) => `replays?hand=${encodeURIComponent(id)}&seat=0`;
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['QUESTIONS'] });
  db = await mf.getD1Database('QUESTIONS');
  const [tables, trigger] = (await readFile(new URL('../migrations/0002_family_ideas.sql', import.meta.url), 'utf8')).split('CREATE TRIGGER');
  for (const sql of tables!.split(';').filter(s => s.trim())) await db.prepare(sql).run();
  await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for (const name of ['0003_accounts.sql', '0006_hands.sql', '0011_replay_attempts.sql']) {
    for (const sql of (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).split(';').filter(s => s.trim())) await db.prepare(sql).run();
  }
  for (const [id, name, family] of [[alice, 'Alice', true], [bob, 'Bob', true], [outsider, 'Visitor', false]] as const) {
    if (family) await db.prepare('INSERT INTO idea_members(id,name,token_hash,revoked) VALUES(?,?,?,0)').bind(id, name, id).run();
    await db.prepare('INSERT INTO accounts(id,name,created,member_id) VALUES(?,?,?,?)').bind(id, name, Date.now(), family ? id : null).run();
    await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(id[0]!.repeat(64)), id, Date.now() + 3600000).run();
  }
  await db.batch(handStatements(db, [own, partial, shared, privateHand]));
  env = { QUESTIONS: db, ASSETS: { fetch: async () => new Response('game') } };
}, 20000);
afterAll(async () => { await mf?.dispose(); });

it('browses only the signed-in account’s hands and refuses unsigned requests', async () => {
  expect((await call('browse', '')).status).toBe(401);
  const result = await (await call('browse')).json() as {items:{id:string}[]; account:string; next:string|null};
  expect(result.account).toBe(alice); expect(result.next).toBeNull();
  expect(result.items.map(h => h.id).sort()).toEqual([handId(own), handId(partial)].sort());
  expect((await call(replayPath(handId(privateHand)))).status).toBe(404);
});
it('family browsing includes completed family hands, excludes unfinished/private hands, and enforces membership', async () => {
  expect((await call('browse?scope=family', outsider)).status).toBe(403);
  const result = await (await call('browse?scope=family')).json() as {items:{id:string; players:{name:string}[]}[]};
  expect(result.items.map(h => h.id).sort()).toEqual([handId(own), handId(shared)].sort());
  expect(result.items.find(h => h.id === handId(shared))?.players[0]?.name).toBe('Bob');
  expect((await call(replayPath(handId(shared)))).status).toBe(200);
  expect((await call(replayPath(handId(shared)), outsider)).status).toBe(404);
  expect((await call(replayPath(handId(partial)))).status).toBe(400);
});
it('starts one durable first attempt and prevents account-switch and cross-site writes', async () => {
  const id = '10000000-0000-0000-0000-000000000001';
  expect((await call(replayPath(), alice, 'POST', { account: bob, id })).status).toBe(409);
  expect((await call(replayPath(), alice, 'POST', { account: alice, id }, 'https://evil.example')).status).toBe(403);
  for (let n = 0; n < 2; n++) expect((await call(replayPath(), alice, 'POST', { account: alice, id })).status).toBe(200);
  const response = await (await call(replayPath())).json() as {attempts:ReplayAttempt[]};
  expect(response.attempts).toHaveLength(1); expect(response.attempts[0]).toMatchObject({ id, matched: 0, done: false });
  expect((await call(replayPath(), alice, 'POST', { account: alice, id: '20000000-0000-0000-0000-000000000002' })).status).toBe(409);
  expect((await (await call(replayPath(), bob)).json() as {attempts:ReplayAttempt[]}).attempts).toEqual([]);
});
it('computes scores from legal choices, preserves the first result and records a separate personal best', async () => {
  const original = decodeReplay(own.record.code)!, steps = handSteps(original), firstId = '10000000-0000-0000-0000-000000000001';
  const initial = ghostProgress(original, 0, []), wrong = legalActions(initial.game).find(a => actionKey(a) !== actionKey(steps[initial.index]!.action))!;
  expect((await call(replayPath(), alice, 'PUT', { account: alice, id: firstId, choices: [wrong], matched: 999 })).status).toBe(200);
  expect((await call(replayPath(), alice, 'PUT', { account: alice, id: firstId, choices: [] })).status).toBe(409);
  const retryId = '20000000-0000-0000-0000-000000000002';
  expect((await call(replayPath(), alice, 'POST', { account: alice, id: retryId })).status).toBe(200);
  const choices: Action[] = [];
  let progress = ghostProgress(original, 0, choices);
  while (!progress.done) {
    choices.push(steps[progress.index]!.action);
    // Retrying the same write is safe, including a lost final acknowledgement.
    for (let n = 0; n < 2; n++) expect((await call(replayPath(), alice, 'PUT', { account: alice, id: retryId, choices })).status).toBe(200);
    progress = ghostProgress(original, 0, choices);
  }
  const saved = (await (await call(replayPath())).json() as {attempts:ReplayAttempt[]}).attempts;
  expect(saved).toHaveLength(2); expect(saved[0]).toMatchObject({ id: firstId, matched: 0, done: true });
  expect(saved[1]).toMatchObject({ id: retryId, matched: progress.total, done: true });
  expect(await db.prepare('SELECT COUNT(*) n FROM hands').first()).toEqual({ n: 4 });
});
it('pages without duplicates or gaps and leaves account data out of database-free previews', async () => {
  const additions = Array.from({ length: 101 }, (_, i) => entry(alice, { ...own.record, gameId: `page-${i}`, id: `page-${i}:1` }));
  for (let i = 0; i < additions.length; i += 20) await db.batch(handStatements(db, additions.slice(i, i + 20)));
  const first = await (await call('browse')).json() as {items:{id:string}[]; next:string};
  expect(first.items).toHaveLength(100); expect(first.next).toBeTruthy();
  const second = await (await call(`browse?before=${encodeURIComponent(first.next)}`)).json() as {items:{id:string}[]; next:null};
  expect(second.items).toHaveLength(3); expect(second.next).toBeNull();
  expect(new Set([...first.items, ...second.items].map(h => h.id)).size).toBe(103);
  expect((await worker.fetch(new Request(`${origin}/api/stats/browse`), { ASSETS: env.ASSETS })).status).toBe(503);
});
