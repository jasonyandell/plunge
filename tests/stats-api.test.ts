import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import { hashToken } from '../worker/accounts';
import { finishedRecord } from './hand-fixtures';
import type { HandRecord } from '../src/history/legacy';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1],db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const origin='https://plunge.texas42.workers.dev';
const phone='1'.repeat(32),laptop='2'.repeat(32);
const call=(path='',method='GET',body?:unknown,cookie='',headers:Record<string,string>={Origin:origin})=>worker.fetch(new Request(`${origin}/api/stats${path}`,{method,headers:{Cookie:cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
async function signIn(id:string,name:string) {
  await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(id,name,Date.now()).run();
  const token=id.slice(0,1).repeat(64);
  await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token),id,Date.now()+86400000).run();
  return `__Host-plunge-session=${token}`;
}
let mom='',dad='';
const first=finishedRecord('stats-one'),second=finishedRecord('stats-two',undefined,undefined,'2026-10-02T12:00:00.000Z'),thrown=finishedRecord('stats-three','game-stats-three',false,'2026-10-03T12:00:00.000Z');
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  db=await mf.getD1Database('QUESTIONS');
  const ideas=await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8');
  const [tables,trigger]=ideas.split('CREATE TRIGGER');for(const statement of tables!.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for(const file of ['0003_accounts.sql','0004_hands.sql'])
    for(const statement of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  env={QUESTIONS:db,ASSETS:{fetch:async()=>new Response('app')}};
  mom=await signIn('a'.repeat(32),'Mom');dad=await signIn('b'.repeat(32),'Dad');
},20000);
afterAll(async()=>{await mf?.dispose();});

it('keeps stats on the device while signed out and on database-free previews',async()=>{
  expect(await (await call()).json()).toEqual({available:true,account:null});
  expect((await call('/hands')).status).toBe(401);
  expect((await call('/hands','PUT',{device:phone,hands:[first]})).status).toBe(401);
  const preview=await worker.fetch(new Request('https://plunge-pr-9.texas42.workers.dev/api/stats'),{ASSETS:env.ASSETS});
  expect(await preview.json()).toEqual({available:false,account:null});
  expect((await worker.fetch(new Request('https://plunge-pr-9.texas42.workers.dev/api/stats/hands',{method:'PUT',headers:{Origin:'https://plunge-pr-9.texas42.workers.dev'},body:'{}'}),{ASSETS:env.ASSETS})).status).toBe(503);
});
it('connects a device’s finished hands to the signed-in account once, first write kept',async()=>{
  expect(await (await call('','GET',undefined,mom)).json()).toEqual({available:true,account:{id:'a'.repeat(32),name:'Mom'},hands:0,devices:0});
  const upload=await call('/hands','PUT',{device:phone,hands:[first,second]},mom);
  expect(upload.status).toBe(200);
  expect(await upload.json()).toEqual({account:'a'.repeat(32),stored:[first.id,second.id],rejected:[]});
  // Leaderboard facts are read from the replay, never from the device.
  const row=await db.prepare('SELECT source,game_id,hand_number,deal,bidder,bid,contract,declaration,result_team,result_marks,team0_points,team1_points,team0_tricks,team1_tricks,marks_before_0,marks_after_0,practice,thrown_in FROM hands WHERE id=?').bind(`${phone}:${first.id}`).first() as Record<string,unknown>;
  expect(row.deal).toBe(first.code.slice(3,60));expect(row.deal).toHaveLength(57);
  expect(row).toMatchObject({source:'solo',game_id:first.gameId,hand_number:1,bid:30,contract:'points',result_marks:1,marks_before_0:0,marks_after_0:1,practice:0,thrown_in:0});
  expect([0,1,2,3]).toContain(row.bidder);
  expect(typeof row.declaration).toBe('string');
  expect([0,1]).toContain(row.result_team);
  // One row per seat: the human with account and device, Walt with its version.
  const seats=(await db.prepare('SELECT seat,kind,account_id,device_id,name,player FROM hand_players WHERE hand_id=? ORDER BY seat').bind(`${phone}:${first.id}`).all()).results;
  expect(seats).toEqual([{seat:0,kind:'human',account_id:'a'.repeat(32),device_id:phone,name:null,player:null},
    ...[1,2,3].map(seat=>({seat,kind:'walt',account_id:null,device_id:null,name:null,player:'native-partner'}))]);
  // A decided hand can end early, so the totals are bounded rather than fixed.
  const pts=(row.team0_points as number)+(row.team1_points as number),tricks=(row.team0_tricks as number)+(row.team1_tricks as number);
  expect(pts).toBeGreaterThan(0);expect(pts).toBeLessThanOrEqual(42);expect(tricks).toBeGreaterThan(0);expect(tricks).toBeLessThanOrEqual(7);
  // The same hand again, even with a different end time, is acknowledged and left exactly as first written.
  const again=await (await call('/hands','PUT',{device:phone,hands:[{...first,endedAt:'2026-10-09T00:00:00.000Z'},thrown]},mom)).json() as {stored:string[]};
  expect(again.stored).toEqual([first.id,thrown.id]);
  const page=await (await call('/hands','GET',undefined,mom)).json() as {items:{device:string;record:HandRecord;received:string}[];next:string|null};
  expect(page.next).toBeNull();
  expect(page.items.map(i=>i.record)).toEqual([first,second,thrown]);
  expect(page.items.every(i=>i.device===phone&&!Number.isNaN(Date.parse(i.received)))).toBe(true);
  expect(await (await call('','GET',undefined,mom)).json()).toMatchObject({hands:3,devices:1});
});
it('merges the account’s devices without letting matching ids overwrite each other',async()=>{
  // A second device reused the same game id and hand number for a different hand: both survive.
  const other={...second,endedAt:'2026-10-04T12:00:00.000Z'};
  expect(await (await call('/hands','PUT',{device:laptop,hands:[other]},mom)).json()).toEqual({account:'a'.repeat(32),stored:[second.id],rejected:[]});
  const thrownRow=await db.prepare('SELECT bidder,bid,contract,result_team,thrown_in FROM hands WHERE id=?').bind(`${phone}:${thrown.id}`).first();
  expect(thrownRow).toEqual({bidder:null,bid:null,contract:null,result_team:null,thrown_in:1});
  // A hand another account connected first stays with that account; the device is told, not retried forever.
  expect(await (await call('/hands','PUT',{device:phone,hands:[first]},dad)).json()).toEqual({account:'b'.repeat(32),stored:[],rejected:[{id:first.id,error:'This hand is already connected to another account.'}]});
  const page=await (await call('/hands','GET',undefined,mom)).json() as {items:{device:string;record:HandRecord}[]};
  expect(page.items).toHaveLength(4);
  expect(page.items.filter(i=>i.record.id===second.id).map(i=>[i.device,i.record.endedAt]).sort()).toEqual([[phone,second.endedAt],[laptop,other.endedAt]]);
  expect(await (await call('','GET',undefined,mom)).json()).toMatchObject({hands:4,devices:2});
  // Another account sees none of it.
  expect(await (await call('/hands','GET',undefined,dad)).json()).toEqual({items:[],next:null});
  expect(await (await call('','GET',undefined,dad)).json()).toMatchObject({hands:0,devices:0});
});
it('pages the merged log in a stable order',async()=>{
  const many=Array.from({length:210},(_,i)=>({...first,id:`bulk-${i}:1`,gameId:`bulk-${i}`,endedAt:`2026-09-${String(1+i%28).padStart(2,'0')}T00:00:00.000Z`}));
  for(let i=0;i<many.length;i+=100){const r=await call('/hands','PUT',{device:laptop,hands:many.slice(i,i+100)},dad);expect(r.status).toBe(200);}
  const one=await (await call('/hands','GET',undefined,dad)).json() as {items:{record:HandRecord}[];next:string|null};
  expect(one.items).toHaveLength(200);expect(one.next).not.toBeNull();
  const two=await (await call(`/hands?after=${encodeURIComponent(one.next!)}`,'GET',undefined,dad)).json() as {items:{record:HandRecord}[];next:string|null};
  expect(two.items).toHaveLength(10);expect(two.next).toBeNull();
  expect(new Set([...one.items,...two.items].map(i=>i.record.id)).size).toBe(210);
  expect((await call('/hands?after=nonsense','GET',undefined,dad)).status).toBe(400);
  expect((await call('/hands','PUT',{device:laptop,hands:many.concat([first])},dad)).status).toBe(400);
},30000);
it('rejects records that are not finished hands, naming them, without dropping the rest',async()=>{
  const unfinished={...first,id:'short:1',gameId:'short',code:first.code.slice(0,70)};
  const mismatched={...thrown,id:'flag:1',gameId:'flag',thrownIn:false};
  const stranger={...first,id:'x:1',gameId:'y'};
  const good={...first,id:'keep:1',gameId:'keep'};
  const result=await (await call('/hands','PUT',{device:phone,hands:[unfinished,mismatched,stranger,'junk',good]},dad)).json() as {stored:string[];rejected:{id:string;error:string}[]};
  expect(result.stored).toEqual(['keep:1']);
  expect(result.rejected.map(r=>r.id)).toEqual(['short:1','flag:1','x:1','']);
  expect(result.rejected[0]!.error).toMatch(/finished hand/);
  expect((await call('/hands','PUT',{device:'nope',hands:[good]},dad)).status).toBe(400);
  expect((await call('/hands','PUT',{device:phone,hands:[good]},dad,{Origin:'https://evil.test'})).status).toBe(403);
  expect((await call('/hands','PUT',{device:phone,hands:[good]},dad,{})).status).toBe(403);
});
