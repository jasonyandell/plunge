import 'fake-indexeddb/auto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import { hashToken } from '../worker/accounts';
import { appendHand, listHands } from '../src/history/legacy';
import { deviceId, syncStats } from '../src/history/stats-sync';
import { finishedRecord } from './hand-fixtures';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1],db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const origin='https://plunge.texas42.workers.dev',momToken='d'.repeat(64),dadToken='e'.repeat(64),laptop='2'.repeat(32);
const mom='a'.repeat(32),dad='b'.repeat(32);
let cookie='',outage=false;const puts:number[]=[];let gets=0;
const first=finishedRecord('sync-one','sync-one'),second=finishedRecord('sync-two','sync-two',true,'2026-10-02T12:00:00.000Z'),third=finishedRecord('sync-three','sync-three',true,'2026-10-05T12:00:00.000Z');
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  db=await mf.getD1Database('QUESTIONS');
  const ideas=await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8');
  const [tables,trigger]=ideas.split('CREATE TRIGGER');for(const statement of tables!.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for(const file of ['0003_accounts.sql','0004_family_table.sql','0004_idea_authorizations.sql','0005_idea_screenshots.sql','0006_hands.sql'])
    for(const statement of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  env={QUESTIONS:db,ASSETS:{fetch:async()=>new Response('app')}};
  for(const [id,name,token] of [[mom,'Mom',momToken],[dad,'Dad',dadToken]] as const) {
    await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(id,name,Date.now()).run();
    await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token),id,Date.now()+86400000).run();
  }
  // The browser would attach the session cookie and Origin itself.
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(outage)throw new TypeError('Failed to fetch');
    const url=new URL(String(input),origin);
    if(init?.method==='PUT')puts.push((JSON.parse(String(init.body)) as {hands:unknown[]}).hands.length);else gets++;
    return worker.fetch(new Request(url,{...init,headers:{...Object.fromEntries(new Headers(init?.headers).entries()),Origin:origin,Cookie:cookie}}),env);
  }) as typeof fetch;
},20000);
afterAll(async()=>{await mf?.dispose();});
const serverCount=async()=>(await db.prepare('SELECT COUNT(*) n FROM hands').first<{n:number}>())!.n;

it('keeps every hand on the device and uploads nothing while signed out',async()=>{
  await appendHand(first);await appendHand(second);
  expect(await syncStats()).toMatchObject({account:null,device:2,connected:0,waiting:2,rejected:0,total:null});
  expect(gets).toBe(1);expect(puts).toEqual([]);expect(await serverCount()).toBe(0);
  expect(await deviceId()).toBe(await deviceId());
});
it('connects the device’s hands to the account on sign-in, once, then sends nothing until there is a new hand',async()=>{
  cookie=`__Host-plunge-session=${momToken}`;
  const status=await syncStats();
  expect(status).toMatchObject({account:mom,device:2,connected:2,waiting:0,rejected:0,total:2});
  expect(status.error).toBeUndefined();
  expect(puts).toEqual([2]);
  // Nothing new: one look at who is signed in, no upload, and the local log is untouched.
  expect(await syncStats()).toMatchObject({account:mom,connected:2,total:null});
  expect(puts).toEqual([2]);
  expect((await listHands()).map(h=>h.id)).toEqual([first.id,second.id]);
  // The account page knows the account already and always asks for the total.
  expect(await syncStats(mom)).toMatchObject({account:mom,connected:2,total:2});
  expect(puts).toEqual([2,0]);
});
it('counts the account’s other devices and rooms server-side without touching the device log',async()=>{
  const upload=await worker.fetch(new Request(`${origin}/api/stats/hands`,{method:'PUT',headers:{Origin:origin,Cookie:cookie},body:JSON.stringify({device:laptop,hands:[{...first,endedAt:'2026-10-03T12:00:00.000Z'},third]})}),env);
  expect(upload.status).toBe(200);
  expect(await syncStats(mom)).toMatchObject({device:2,connected:2,total:4});
  expect(puts).toEqual([2,0,0]);
  expect((await listHands()).map(h=>h.id)).toEqual([first.id,second.id]);
});
it('uploads only new hands, and rides out an outage without inventing success',async()=>{
  await appendHand(finishedRecord('sync-five','sync-five',true,'2026-10-07T12:00:00.000Z'));
  outage=true;
  const down=await syncStats(mom);
  expect(down).toMatchObject({account:mom,device:3,connected:2,waiting:1,total:null});
  expect(down.error).toBeTruthy();
  outage=false;
  expect(await syncStats()).toMatchObject({account:mom,device:3,connected:3,waiting:0,total:5});
  expect(puts).toEqual([2,0,0,1]);
  expect(await serverCount()).toBe(5);
});
it('keeps a hand the service will not accept on the device and says so',async()=>{
  await appendHand({...first,id:'broken:1',gameId:'broken',code:first.code.slice(0,60)});
  expect(await syncStats()).toMatchObject({device:4,connected:3,waiting:0,rejected:1});
  expect(puts).toEqual([2,0,0,1,1]);
  expect(await syncStats()).toMatchObject({rejected:1});
  expect(puts).toEqual([2,0,0,1,1]);
  expect((await listHands()).some(h=>h.id==='broken:1')).toBe(true);
});
it('is greedy: the next account to sign in on this device claims the same hands, and an ended session marks nothing',async()=>{
  cookie=`__Host-plunge-session=${dadToken}`;
  expect(await syncStats()).toMatchObject({account:dad,device:4,connected:3,rejected:1,total:3});
  expect(puts).toEqual([2,0,0,1,1,4]);
  expect(await serverCount()).toBe(5);
  expect((await db.prepare('SELECT COUNT(*) n FROM hand_players WHERE account_id=?').bind(dad).first<{n:number}>())!.n).toBe(3);
  cookie='';
  await appendHand(finishedRecord('sync-six','sync-six',true,'2026-10-08T12:00:00.000Z'));
  expect(await syncStats()).toMatchObject({account:null,device:5,connected:0,waiting:5});
  expect(puts).toEqual([2,0,0,1,1,4]);
  // A stale idea of who is signed in (the account page's) is corrected by the 401 and marks nothing.
  expect(await syncStats(mom)).toMatchObject({account:null,waiting:5});
  expect(puts).toEqual([2,0,0,1,1,4,1]);
  expect(await serverCount()).toBe(5);
});
