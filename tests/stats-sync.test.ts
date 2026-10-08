import 'fake-indexeddb/auto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import { hashToken } from '../worker/accounts';
import { appendHand, listHands } from '../src/history/legacy';
import { deviceId, forgetAccount, listAccountHands, statsStatus, syncStats } from '../src/history/stats-sync';
import { finishedRecord } from './hand-fixtures';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1],db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const origin='https://plunge.texas42.workers.dev',token='d'.repeat(64),laptop='2'.repeat(32);
let cookie='',outage=false;const puts:number[]=[];let gets=0;
const first=finishedRecord('sync-one','sync-one'),second=finishedRecord('sync-two','sync-two',true,'2026-10-02T12:00:00.000Z'),third=finishedRecord('sync-three','sync-three',true,'2026-10-05T12:00:00.000Z');
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  db=await mf.getD1Database('QUESTIONS');
  const ideas=await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8');
  const [tables,trigger]=ideas.split('CREATE TRIGGER');for(const statement of tables!.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for(const file of ['0003_accounts.sql','0004_hands.sql'])
    for(const statement of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  env={QUESTIONS:db,ASSETS:{fetch:async()=>new Response('app')}};
  await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind('a'.repeat(32),'Mom',Date.now()).run();
  await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token),'a'.repeat(32),Date.now()+86400000).run();
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

it('keeps every hand on the device and makes no request while signed out',async()=>{
  await appendHand(first);await appendHand(second);
  expect(await syncStats()).toMatchObject({state:'signed-out',account:null,device:2,connected:0,waiting:2,rejected:0});
  expect(gets).toBe(0);expect(puts).toEqual([]);
  // The account page asks the service once and learns nobody is signed in.
  expect(await syncStats('full')).toMatchObject({state:'signed-out',account:null,device:2,waiting:2});
  expect(gets).toBe(1);expect(puts).toEqual([]);expect(await serverCount()).toBe(0);
  expect(await deviceId()).toBe(await deviceId());
});
it('connects the device’s hands to the account on sign-in, once, then stays quiet',async()=>{
  cookie=`__Host-plunge-session=${token}`;
  const status=await syncStats('full');
  expect(status).toMatchObject({state:'connected',account:{id:'a'.repeat(32),name:'Mom'},device:2,connected:2,waiting:0,rejected:0,hands:2,devices:1});
  expect(status.error).toBeUndefined();
  expect(puts).toEqual([2]);
  // Nothing new: the game's ticks make no request at all, and the local log is untouched.
  const before=gets;
  expect(await syncStats()).toMatchObject({state:'connected',account:{id:'a'.repeat(32)},connected:2,hands:2,devices:1});
  expect(await syncStats('light')).toMatchObject({connected:2});
  expect(gets).toBe(before);expect(puts).toEqual([2]);
  expect((await listHands()).map(h=>h.id)).toEqual([first.id,second.id]);
  expect(await statsStatus()).toMatchObject({account:{id:'a'.repeat(32)},device:2,connected:2,hands:2});
});
it('merges hands from the account’s other devices without touching the device log',async()=>{
  const other={...first,endedAt:'2026-10-03T12:00:00.000Z'};
  const upload=await worker.fetch(new Request(`${origin}/api/stats/hands`,{method:'PUT',headers:{Origin:origin,Cookie:cookie},body:JSON.stringify({device:laptop,hands:[other,third]})}),env);
  expect(upload.status).toBe(200);
  const status=await syncStats('full');
  expect(status).toMatchObject({device:2,connected:2,hands:4,devices:2});
  expect(puts).toEqual([2]);
  const merged=await listAccountHands();
  const mine=await deviceId();
  expect(merged.map(h=>[h.device===mine?'phone':'laptop',h.record.id])).toEqual([['phone',first.id],['phone',second.id],['laptop',first.id],['laptop',third.id]]);
  expect(merged.find(h=>h.device===laptop&&h.record.id===first.id)!.record.endedAt).toBe(other.endedAt);
  expect((await listHands()).map(h=>h.id)).toEqual([first.id,second.id]);
  // A later hand of the same other device arrives through the saved cursor.
  const fourth=finishedRecord('sync-four','sync-four',true,'2026-10-06T12:00:00.000Z');
  await worker.fetch(new Request(`${origin}/api/stats/hands`,{method:'PUT',headers:{Origin:origin,Cookie:cookie},body:JSON.stringify({device:laptop,hands:[fourth]})}),env);
  expect(await syncStats('full')).toMatchObject({hands:5,devices:2});
  expect((await listAccountHands()).map(h=>h.record.id)).toContain(fourth.id);
});
it('uploads only new hands with one request, and rides out an outage without inventing success',async()=>{
  const fresh=finishedRecord('sync-five','sync-five',true,'2026-10-07T12:00:00.000Z');
  await appendHand(fresh);
  outage=true;
  const down=await syncStats();
  expect(down).toMatchObject({state:'offline',account:{id:'a'.repeat(32)},device:3,connected:2,waiting:1,hands:5});
  expect(down.error).toBeTruthy();
  outage=false;
  const before=gets;
  expect(await syncStats()).toMatchObject({state:'connected',device:3,connected:3,waiting:0});
  expect(gets).toBe(before);expect(puts).toEqual([2,1]);
  expect(await serverCount()).toBe(6);
});
it('keeps a hand the service will not accept on the device and says so',async()=>{
  const broken={...first,id:'broken:1',gameId:'broken',code:first.code.slice(0,70)};
  await appendHand(broken);
  const status=await syncStats();
  expect(status).toMatchObject({device:4,connected:3,waiting:0,rejected:1});
  expect(puts).toEqual([2,1,1]);
  expect(await syncStats()).toMatchObject({rejected:1});
  expect(puts).toEqual([2,1,1]);
  expect((await listHands()).some(h=>h.id==='broken:1')).toBe(true);
});
it('notices an ended session on its next upload and goes quiet until the next sign-in',async()=>{
  cookie='';
  await appendHand(finishedRecord('sync-six','sync-six',true,'2026-10-08T12:00:00.000Z'));
  expect(await syncStats()).toMatchObject({state:'signed-out',account:null,device:5,connected:0,waiting:5});
  expect(puts).toEqual([2,1,1,1]);
  const before=gets;
  expect(await syncStats()).toMatchObject({state:'signed-out'});
  expect(gets).toBe(before);expect(puts).toEqual([2,1,1,1]);
  expect(await serverCount()).toBe(6);
  // Signing out on the account page forgets the account outright.
  cookie=`__Host-plunge-session=${token}`;
  expect(await syncStats('full')).toMatchObject({state:'connected',connected:4,hands:7});
  await forgetAccount();
  expect(await syncStats()).toMatchObject({state:'signed-out'});
  expect(puts).toEqual([2,1,1,1,1]);
});
