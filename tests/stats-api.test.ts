import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import { hashToken } from '../worker/accounts';
import { finishedRecord, partialRecord } from './hand-fixtures';
import type { HandRecord } from '../src/history/legacy';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1],db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const origin='https://plunge.texas42.workers.dev';
const phone='1'.repeat(32),laptop='2'.repeat(32);
const put=(body:unknown,cookie='',headers:Record<string,string>={Origin:origin})=>worker.fetch(new Request(`${origin}/api/stats/hands`,{method:'PUT',headers:{Cookie:cookie,...headers},body:JSON.stringify(body)}),env);
const row=async(sql:string,...binds:unknown[])=>db.prepare(sql).bind(...binds).first() as Promise<Record<string,unknown>|null>;
const rows=async(sql:string,...binds:unknown[])=>(await db.prepare(sql).bind(...binds).all()).results as Record<string,unknown>[];
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
  expect((await put({device:phone,hands:[first]})).status).toBe(401);
  expect((await worker.fetch(new Request(`${origin}/api/stats`),env)).status).toBe(404);
  const preview=await worker.fetch(new Request('https://plunge-pr-9.texas42.workers.dev/api/stats/hands',{method:'PUT',headers:{Origin:'https://plunge-pr-9.texas42.workers.dev'},body:'{}'}),{ASSETS:env.ASSETS});
  expect(preview.status).toBe(503);expect(await preview.json()).toMatchObject({local_only:true});
  expect(await (await put({device:phone,hands:[]},mom)).json()).toEqual({account:'a'.repeat(32),stored:[],rejected:[],total:0});
});
it('connects a device’s hands to the signed-in account once, first write kept, facts decoded from the replay',async()=>{
  const upload=await put({device:phone,hands:[first,second]},mom);
  expect(upload.status).toBe(200);
  expect(await upload.json()).toEqual({account:'a'.repeat(32),stored:[first.id,second.id],rejected:[],total:2});
  const hand=(await row('SELECT * FROM hands WHERE id=?',`${phone}:${first.id}`))!;
  expect(hand).toMatchObject({room_id:null,walt:'native-partner',finished:1,bid:30,contract:'points',result_marks:1,ended_at:first.endedAt});
  expect(hand.deal).toBe(first.code.slice(3,60));expect(hand.deal).toHaveLength(57);
  expect([0,1,2,3]).toContain(hand.bidder);expect([0,1]).toContain(hand.result_team);expect(typeof hand.declaration).toBe('string');
  const pts=(hand.team0_points as number)+(hand.team1_points as number),tricks=(hand.team0_tricks as number)+(hand.team1_tricks as number);
  expect(pts).toBeGreaterThan(0);expect(pts).toBeLessThanOrEqual(42);expect(tricks).toBeGreaterThan(0);expect(tricks).toBeLessThanOrEqual(7);
  expect(JSON.parse(String(hand.payload))).toEqual(first);
  expect(await rows('SELECT seat,account_id,device_id,name FROM hand_players WHERE hand_id=?',`${phone}:${first.id}`)).toEqual([{seat:0,account_id:'a'.repeat(32),device_id:phone,name:null}]);
  // The same hand again, even with a different end time, is acknowledged and left exactly as first written.
  expect(await (await put({device:phone,hands:[{...first,endedAt:'2026-10-09T00:00:00.000Z'},thrown]},mom)).json()).toMatchObject({stored:[first.id,thrown.id],total:3});
  expect(JSON.parse(String((await row('SELECT payload FROM hands WHERE id=?',`${phone}:${first.id}`))!.payload))).toEqual(first);
  expect(await row('SELECT finished,bidder,bid,contract,result_team FROM hands WHERE id=?',`${phone}:${thrown.id}`)).toEqual({finished:1,bidder:null,bid:null,contract:null,result_team:null});
});
it('keeps every attempt: a hand left part-way, and the same ids from another device',async()=>{
  const left=partialRecord('stats-left','left-game',6,'2026-10-04T12:00:00.000Z');
  expect(await (await put({device:phone,hands:[left]},mom)).json()).toMatchObject({stored:[left.id],rejected:[],total:4});
  const hand=(await row('SELECT finished,bidder,bid,result_team,team0_tricks,team1_tricks FROM hands WHERE id=?',`${phone}:${left.id}`))!;
  expect(hand).toMatchObject({finished:0,bid:30,result_team:null});
  expect((hand.team0_tricks as number)+(hand.team1_tricks as number)).toBeLessThan(7);
  // Another device reused the same game id and hand number for a different hand: both survive.
  const other={...second,endedAt:'2026-10-05T12:00:00.000Z'};
  expect(await (await put({device:laptop,hands:[other]},mom)).json()).toMatchObject({stored:[second.id],total:5});
  expect((await rows('SELECT id,payload FROM hands WHERE id IN (?,?) ORDER BY id',`${phone}:${second.id}`,`${laptop}:${second.id}`)).map(r=>[r.id,(JSON.parse(String(r.payload)) as HandRecord).endedAt]))
    .toEqual([[`${phone}:${second.id}`,second.endedAt],[`${laptop}:${second.id}`,other.endedAt]]);
});
it('is greedy: another account signing in on the device claims the same hands',async()=>{
  expect(await (await put({device:phone,hands:[first]},dad)).json()).toEqual({account:'b'.repeat(32),stored:[first.id],rejected:[],total:1});
  expect(await rows('SELECT seat,account_id FROM hand_players WHERE hand_id=? ORDER BY account_id',`${phone}:${first.id}`)).toEqual([{seat:0,account_id:'a'.repeat(32)},{seat:0,account_id:'b'.repeat(32)}]);
  expect((await row('SELECT COUNT(*) n FROM hands'))!.n).toBe(5);
  expect(await (await put({device:phone,hands:[]},mom)).json()).toMatchObject({total:5});
});
it('stores the record exactly as sent, so a client can attach more detail later',async()=>{
  const detailed={...first,id:'detail:1',gameId:'detail',build:'abc123',walt:{player:'walt-table-v2',source_commit:'c'.repeat(40),wasm_sha256:'d'.repeat(64)},hints:[{ply:3,shown:'64',chose:'55'}]};
  expect(await (await put({device:phone,hands:[detailed]},mom)).json()).toMatchObject({stored:['detail:1'],rejected:[]});
  expect(JSON.parse(String((await row('SELECT payload FROM hands WHERE id=?',`${phone}:detail:1`))!.payload))).toEqual(detailed);
  expect(await row("SELECT json_extract(payload,'$.walt.wasm_sha256') hash, json_extract(payload,'$.hints[0].chose') chose, walt FROM hands WHERE id=?",`${phone}:detail:1`)).toEqual({hash:'d'.repeat(64),chose:'55',walt:'native-partner'});
  const bloated={...first,id:'bloat:1',gameId:'bloat',notes:'x'.repeat(70000)};
  expect(await (await put({device:phone,hands:[bloated]},mom)).json()).toMatchObject({stored:[],rejected:[{id:'bloat:1',error:'Hand record is too large.'}]});
});
it('takes a long device log in batches and refuses an oversized one',async()=>{
  const many=Array.from({length:210},(_,i)=>({...first,id:`bulk-${i}:1`,gameId:`bulk-${i}`,endedAt:`2026-09-${String(1+i%28).padStart(2,'0')}T00:00:00.000Z`}));
  for(let i=0;i<many.length;i+=100){const r=await put({device:laptop,hands:many.slice(i,i+100)},dad);expect(r.status).toBe(200);}
  expect(await (await put({device:laptop,hands:[]},dad)).json()).toMatchObject({total:211});
  expect((await put({device:laptop,hands:many.concat([first])},dad)).status).toBe(400);
},30000);
it('rejects what is not a hand, naming it, without dropping the rest',async()=>{
  const empty={...first,id:'empty:1',gameId:'empty',code:first.code.slice(0,60)};
  const mismatched={...thrown,id:'flag:1',gameId:'flag',thrownIn:false};
  const stranger={...first,id:'x:1',gameId:'y'};
  const good={...first,id:'keep:1',gameId:'keep'};
  const result=await (await put({device:phone,hands:[empty,mismatched,stranger,'junk',good]},dad)).json() as {stored:string[];rejected:{id:string;error:string}[]};
  expect(result.stored).toEqual(['keep:1']);
  expect(result.rejected.map(r=>r.id)).toEqual(['empty:1','flag:1','x:1','']);
  expect(result.rejected[0]!.error).toMatch(/no moves/);
  expect((await put({device:'nope',hands:[good]},dad)).status).toBe(400);
  expect((await put({device:phone,hands:[good]},dad,{Origin:'https://evil.test'})).status).toBe(403);
  expect((await put({device:phone,hands:[good]},dad,{})).status).toBe(403);
});
