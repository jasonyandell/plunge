import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import { hintQuestion, auctionFixture, bookEvidence, finish, moveFixture } from './hint-question-fixtures';
import { encodeReplay } from '../src/engine/replay-code';
import type { Question } from '../src/questions/model';
const code='v1t366615143403021656463533231106250423320110060555452444122.P303132D9222132624440644255515350';
const prefix=code.slice(0,code.indexOf('D9')+4);
let mf:Miniflare;
let env:Parameters<typeof worker.fetch>[1];
const id='a'.repeat(32),token='b'.repeat(64),other='c'.repeat(64);
const question:Question={schema:'plunge-question-v1',id,created:'2026-09-15T00:00:00Z',game_id:'api-test',hand_number:1,
  ply:0,seed:2642199461,snapshot:prefix,replay:prefix,note:'Why?',alternative:null,receipt_id:null,receipt:null,build:'test'};
const call=(path='',method='GET',body?:unknown,owner?:string)=>worker.fetch(new Request(`https://plunge.test/api/questions${path}`,{
  method,headers:{...(owner ? {Authorization:`Bearer ${owner}`} : {}),...(body ? {'Content-Type':'application/json'} : {})},
  ...(body ? {body:JSON.stringify(body)} : {}),
}),env);
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  const database=await mf.getD1Database('QUESTIONS');
  const sql=await readFile(new URL('../migrations/0001_questions.sql',import.meta.url),'utf8');
  for(const statement of sql.split(';').filter(s=>s.trim()))await database.prepare(statement).run();
  env={QUESTIONS:database,ASSETS:{fetch:async()=>new Response('app')}};
},20000);
afterAll(async()=>{await mf?.dispose();});
describe('anonymous question service',()=>{
  it('requires a private browser key for submission and personal lists',async()=>{
    expect((await call('', 'GET')).status).toBe(401);
    expect((await call(`/${id}`,'PUT',{question,revision:1})).status).toBe(401);
    expect((await call(`/${id}`,'PUT',{question,revision:1},token)).status).toBe(200);
  });
  it('isolates notebooks, hides incomplete hands on short links, and makes retries idempotent',async()=>{
    const own=await (await call('','GET',undefined,token)).json() as {items:unknown[]};expect(own.items).toHaveLength(1);
    const theirs=await (await call('','GET',undefined,other)).json() as {items:unknown[]};expect(theirs.items).toHaveLength(0);
    const shared=await (await call(`/${id}`)).json() as {question:unknown;domino:string};expect(shared.question).toBeNull();expect(shared.domino).toBe('22');
    expect((await call(`/${id}`,'PUT',{question,revision:2},other)).status).toBe(403);
    expect((await call(`/${id}`,'PUT',{question,revision:1},token)).status).toBe(200);
    const ownAgain=await (await call('','GET',undefined,token)).json() as {items:unknown[]};expect(ownAgain.items).toHaveLength(1);
  });
  it('attaches a completed replay, rejects evidence replacement, and ignores stale retries',async()=>{
    const complete={...question,replay:code};
    expect((await call(`/${id}`,'PUT',{question:complete,revision:2},token)).status).toBe(200);
    expect((await call(`/${id}`,'PUT',{question:{...complete,snapshot:code},revision:3},token)).status).toBe(409);
    expect((await call(`/${id}`,'PUT',{question,revision:1},token)).status).toBe(200);
    const shared=await (await call(`/${id}`)).json() as {question:Question;complete:boolean};
    expect(shared.complete).toBe(true);expect(shared.question.replay).toBe(code);expect(shared.question.snapshot).toBe(prefix);
  });
  it('retains a reviewer answer when the submitter edits their note',async()=>{
    await env.QUESTIONS.prepare('UPDATE questions SET answer=?,answered_at=? WHERE id=?').bind('The six-four is ten count.','2026-09-15T01:00:00Z',id).run();
    const updated={...question,replay:code,note:'A follow-up'};
    await call(`/${id}`,'PUT',{question:updated,revision:3},token);
    const shared=await (await call(`/${id}`)).json() as {answer:{body:string}};
    expect(shared.answer.body).toContain('six-four');
  });
  it('rejects oversized and malformed submissions and does not expose an admin route',async()=>{
    expect((await call(`/${id}`,'PUT',{question:{...question,note:'x'.repeat(100000)},revision:4},token)).status).toBe(400);
    expect((await call(`/${id}`,'PUT',{question:{...question,replay:'garbage'},revision:4},token)).status).toBe(400);
    expect((await call('/admin','GET',undefined,token)).status).toBe(404);
  });
});

describe('hint evidence through D1', () => {
  it('stores all three hint kinds, keeps original advice, and withholds unfinished private evidence', async () => {
    for (const [i,g] of [moveFixture(),auctionFixture(),auctionFixture(true)].entries()) {
      const id = (i+1).toString(16).repeat(32);
      const q = {...(g.phase === 'playing' ? hintQuestion(g) : hintQuestion(g,bookEvidence(g))),id};
      expect((await call(`/${id}`,'PUT',{question:q,revision:1},token)).status).toBe(200);
      const publicBefore = await (await call(`/${id}`)).json() as {question:unknown;domino:unknown};
      expect(publicBefore.question).toBeNull(); expect(publicBefore.domino).toBeNull();
      const changed = structuredClone(q); changed.hint!.explanation = 'Replaced';
      expect((await call(`/${id}`,'PUT',{question:changed,revision:2},token)).status).toBe(409);
      const complete = {...q,replay:encodeReplay(finish(g))!,note:'My question'};
      expect((await call(`/${id}`,'PUT',{question:complete,revision:2},token)).status).toBe(200);
      const publicAfter = await (await call(`/${id}`)).json() as {question:Question;complete:boolean};
      expect(publicAfter.complete).toBe(true); expect(publicAfter.question.hint).toEqual(q.hint);
      expect((await call(`/${id}`,'PUT',{question:complete,revision:3},other)).status).toBe(403);
    }
  });
});
