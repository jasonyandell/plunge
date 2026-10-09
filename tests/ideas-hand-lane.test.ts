import {afterAll,beforeAll,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {grantFamily,hashToken} from '../worker/accounts';
import type {IdeaThread} from '../src/ideas/model';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1];
const origin='https://plunge.texas42.workers.dev',admin='a'.repeat(64),id=(n:number)=>n.toString(16).padStart(32,'0');
const owner=id(1),mom=id(2),ownerToken='b'.repeat(64),momToken='c'.repeat(64),sha='e'.repeat(40),nextSha='f'.repeat(40);
const call=(path:string,method='GET',data?:unknown,token=momToken)=>worker.fetch(new Request(`${origin}/api/ideas${path}`,{
  method,headers:{Cookie:`__Host-plunge-session=${token}`,Origin:origin},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
const adminCall=(path:string,data?:unknown)=>worker.fetch(new Request(`${origin}/api/ideas/admin/${path}`,{
  method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${admin}`},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
const thread=async(n:number)=>await (await call(`/${id(n)}`)).json() as IdeaThread;
const claim=async(r:number,ideaId?:string)=>await (await adminCall('claim',{runId:id(r),...(ideaId?{ideaId}:{})})).json();
/** Statements split on `;`, except a trigger body, which runs whole. */
async function migrate(file:string){
  const [plain,trigger]=(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split('CREATE TRIGGER');
  for(const statement of plain!.split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await env.QUESTIONS!.prepare(statement).run();
  if(trigger)await env.QUESTIONS!.prepare(`CREATE TRIGGER${trigger}`).run();
}
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  env={QUESTIONS:await mf.getD1Database('QUESTIONS'),IDEAS_ADMIN_TOKEN:admin,ASSETS:{fetch:async()=>new Response('app')}};
  for(const file of ['0002_family_ideas.sql','0003_accounts.sql','0004_idea_authorizations.sql','0005_idea_screenshots.sql','0008_idea_hand_lane.sql'])await migrate(file);
  for(const [account,name,token,role] of [[owner,'Jason',ownerToken,1],[mom,'Mom',momToken,0]] as const){
    await env.QUESTIONS!.prepare('INSERT INTO accounts(id,name,owner,created) VALUES(?,?,?,0)').bind(account,name,role).run();
    await grantFamily(env.QUESTIONS!,account,true);
    await env.QUESTIONS!.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token),account,Date.now()+86400000).run();
  }
},20000);
afterAll(async()=>{await mf?.dispose();});

it('only the builder key adopts, with a real PR and commit',async()=>{
  expect((await call('/admin/adopt','POST',{newId:id(50),body:'Let Benny log in',pr:42,sha})).status).toBe(403);
  expect((await adminCall('adopt',{newId:id(50),body:'Let Benny log in',pr:42,sha:'nope'})).status).toBe(400);
  expect((await adminCall('adopt',{newId:id(50),body:'Let Benny log in',pr:0,sha})).status).toBe(400);
});
it('makes a hand-built card from a PR that the builder never claims and replies never queue',async()=>{
  const adopted=await adminCall('adopt',{newId:id(50),title:'Let Benny log in',body:'Invites, a name chip, and one name at every table.',pr:42,sha});
  expect(await adopted.json()).toEqual({id:id(50)});
  let card=await thread(50);
  expect(card.card).toMatchObject({lane:'hand',status:'checking',pr:42,sha,title:'Let Benny log in',name:'Jason',preview:null});
  expect(card.messages.map(m=>[m.role,m.name])).toEqual([['family','Jason'],['builder','Jason']]);
  expect(card.messages[1]!.body).toMatch(/pull request #42/);
  // Readiness tracking is shared with builder cards.
  expect((await (await adminCall('tracked')).json() as {id:string}[]).map(c=>c.id)).toContain(id(50));
  expect(await claim(900)).toBeNull();
  expect(await claim(901,id(50))).toBeNull();
  // Mom's reply is conversation for Jason, not a build.
  expect((await call(`/${id(50)}/messages`,'PUT',{id:id(60),body:'Can Benny try it tonight?'})).status).toBe(200);
  card=await thread(50);
  expect(card.card).toMatchObject({status:'checking',revision:2});
  expect(await claim(902)).toBeNull();
  // Neither the owner's approval nor an admin retry can hand it to the builder.
  expect((await adminCall('retry',{id:id(50)})).status).toBe(409);
  expect((await call(`/${id(50)}/approve`,'POST',{revision:2},ownerToken)).status).toBe(409);
  expect((await thread(50)).card.status).toBe('checking');
});
it('keeps watching a hand-built PR whose checks failed, until the next push',async()=>{
  expect((await adminCall('publish',{id:id(50),sha,status:'failed'})).status).toBe(200);
  expect((await thread(50)).card.status).toBe('failed');
  expect((await (await adminCall('tracked')).json() as {id:string}[]).map(c=>c.id)).toContain(id(50));
  expect((await adminCall('refresh',{id:id(50),sha,nextSha})).status).toBe(200);
  expect((await thread(50)).card).toMatchObject({status:'checking',sha:nextSha});
  // Adopting the same build again adds no second note.
  await adminCall('adopt',{id:id(50),pr:42,sha:nextSha});await adminCall('adopt',{id:id(50),pr:42,sha:nextSha});
  expect((await thread(50)).messages.filter(m=>m.role==='builder')).toHaveLength(2);
});
it('adopts an existing family card, but never one the builder is working on',async()=>{
  expect((await call(`/${id(70)}`,'PUT',{body:'How do we let Benny log in?',context:'Phone'})).status).toBe(200);
  expect((await call(`/${id(71)}`,'PUT',{body:'Something else',context:'Phone'})).status).toBe(200);
  expect(await claim(903,id(71))).not.toBeNull();
  expect((await adminCall('adopt',{id:id(71),pr:43,sha})).status).toBe(409);
  expect((await adminCall('adopt',{id:id(70),pr:42,sha})).status).toBe(200);
  const card=await thread(70);
  expect(card.card).toMatchObject({lane:'hand',status:'checking',pr:42,name:'Mom'});
  expect(await claim(904,id(70))).toBeNull();
  // Ordinary family cards still build as before.
  expect((await call(`/${id(72)}`,'PUT',{body:'Bigger dominoes',context:'Phone'})).status).toBe(200);
  expect((await claim(905,id(72)) as {card:{id:string}}).card.id).toBe(id(72));
  expect((await adminCall('adopt',{id:id(99),pr:42,sha})).status).toBe(404);
});
