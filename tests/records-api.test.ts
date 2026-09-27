/** The hand upload service: owned, validated, write-once, partitioned by deployment. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import worker from '../worker/index';
import manifest from '../src/ai/phone/manifest.json';
import { canonicalJson } from '../src/records/canonical';
import { playRecorded } from './record-fixtures';

let mf: Miniflare;
let env: Parameters<typeof worker.fetch>[1];
const token = 'b'.repeat(64), other = 'c'.repeat(64);
const [hand] = playRecorded('records-api', 1).records;
const put = (id: string, body: unknown, owner?: string, origin?: string) => worker.fetch(new Request(`https://plunge.test/api/hands/${id}`, {
  method: 'PUT', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Bearer ${owner}` } : {}), ...(origin ? { Origin: origin } : {}) },
}), env);
const rows = async () => (await env.QUESTIONS.prepare('SELECT partition, id, owner_hash, outcome, body FROM hands').all<
  { partition: string; id: string; owner_hash: string; outcome: string; body: string }>()).results;

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['QUESTIONS'] });
  const database = await mf.getD1Database('QUESTIONS');
  for (const file of ['0001_questions.sql', '0002_records.sql']) {
    const sql = (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').filter(s => s.trim())) await database.prepare(statement).run();
  }
  env = { QUESTIONS: database, ASSETS: { fetch: async () => new Response('app') }, PARTITION: 'pr-9' };
}, 20000);
afterAll(async () => { await mf?.dispose(); });

describe('hand uploads', () => {
  it('require a browser key and a same-origin request', async () => {
    expect((await put(hand!.id, { hand })).status).toBe(401);
    expect((await put(hand!.id, { hand }, token, 'https://elsewhere.test')).status).toBe(403);
    expect(await rows()).toHaveLength(0);
  });

  it('store a valid hand once, in this deployment\'s partition, and register the serving Walt', async () => {
    expect((await put(hand!.id, { hand }, token)).status).toBe(200);
    expect((await put(hand!.id, { hand }, token)).status).toBe(200); // retry is a no-op
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ partition: 'pr-9', id: hand!.id, outcome: 'finished' });
    expect(stored[0]!.owner_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.parse(stored[0]!.body)).toEqual(hand);
    const walts = (await env.QUESTIONS.prepare('SELECT partition, id FROM walts').all<{ partition: string; id: string }>()).results;
    expect(walts).toEqual([{ partition: 'pr-9', id: createHash('sha256').update(canonicalJson(manifest)).digest('hex') }]);
  });

  it('never rewrite a stored hand, and refuse another browser\'s id', async () => {
    expect((await put(hand!.id, { hand: { ...hand, app: 'rewritten' } }, token)).status).toBe(200);
    expect(JSON.parse((await rows())[0]!.body).app).toBe('test');
    expect((await put(hand!.id, { hand }, other)).status).toBe(409);
  });

  it('reject records that disagree with their replay or their address', async () => {
    const id = 'd'.repeat(32);
    expect((await put(id, { hand })).status).toBe(401);
    expect((await put(id, { hand }, token)).status).toBe(400);
    expect((await put(id, { hand: { ...hand, id, actions: hand!.actions.slice(1) } }, token)).status).toBe(400);
    expect((await put(id, { hand: { ...hand, id, code: `${hand!.code.slice(0, -2)}00` } }, token)).status).toBe(400);
    expect((await put(id, { hand: { ...hand, id, seats: [] } }, token)).status).toBe(400);
    expect(await rows()).toHaveLength(1);
  });
});
