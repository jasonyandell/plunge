import {afterAll,beforeAll,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {grantFamily,hashToken} from '../worker/accounts';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1];
const origin='https://plunge.texas42.workers.dev',admin='a'.repeat(64),id=(n:number)=>n.toString(16).padStart(32,'0');
const owner=id(1),family=id(2),ownerToken='b'.repeat(64),familyToken='c'.repeat(64),invite='d'.repeat(64);
const call=(path:string,method='GET',data?:unknown,token=ownerToken,headers:Record<string,string>={})=>worker.fetch(new Request(`${origin}/api/ideas${path}`,{
  method,headers:{Cookie:`__Host-plunge-session=${token}`,Origin:origin,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})
}),env);
const create=(n:number,token=familyToken,extra={})=>call(`/${id(n)}`,'PUT',{body:'Add account-linked stats',context:'Phone',...extra},token);
const reply=(n:number,m:number,token=familyToken)=>call(`/${id(n)}/messages`,'PUT',{id:id(m),body:'One more change'},token);
const approve=(n:number,revision=1,token=ownerToken,headers={})=>call(`/${id(n)}/approve`,'POST',{revision,accountId:owner},token,headers);
const claim=async(n:number,r:number)=> (await call('/admin/claim','POST',{ideaId:id(n),runId:id(r)},'',{Authorization:`Bearer ${admin}`})).json() as Promise<{authorization:{scope:string;accountId:string|null;source:string};run:{revision:number;through_seq:number};messages:unknown[]}>;
const runCall=(r:number,action:string,data:unknown)=>call(`/admin/runs/${id(r)}/${action}`,'POST',data,'',{Authorization:`Bearer ${admin}`});
async function migrate(file:string){for(const statement of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await env.QUESTIONS!.prepare(statement).run();}
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
 const db=await mf.getD1Database('QUESTIONS');env={QUESTIONS:db,IDEAS_ADMIN_TOKEN:admin,ASSETS:{fetch:async()=>new Response('app')}};
 const [tables,trigger]=(await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8')).split('CREATE TRIGGER');
 for(const s of tables!.split(';').filter(s=>s.trim()))await db.prepare(s).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
 await migrate('0003_accounts.sql');
 for(const [account,token,role] of [[owner,ownerToken,1],[family,familyToken,0]] as const){
  await db.prepare('INSERT INTO accounts(id,name,owner,created) VALUES(?,?,?,0)').bind(account,'Jason',role).run();
  await grantFamily(db,account,true);
  await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(token),account,Date.now()+86400000).run();
 }
 await db.prepare('INSERT INTO idea_members(id,name,token_hash) VALUES(?,?,?)').bind(id(3),'Jason',await hashToken(invite)).run();
 // Existing authenticated and invitation posts predate the new provenance column.
 for(const [n,member] of [[10,owner],[11,id(3)]] as const){
  await db.prepare('INSERT INTO ideas(id,member_id,title,context,created,updated) VALUES(?,?,?,\'Phone\',\'now\',\'now\')').bind(id(n),member,'Legacy').run();
  await db.prepare("INSERT INTO idea_messages(id,idea_id,member_id,role,body,created) VALUES(?,?,?,'family','Legacy','now')").bind(id(n),id(n),member).run();
 }
 await migrate('0004_idea_authorizations.sql');
 await migrate('0005_idea_screenshots.sql');
},20000);
afterAll(async()=>{await mf?.dispose();});
it('preserves verified legacy authorship without trusting matching invitation names',async()=>{
 expect((await claim(10,100)).authorization).toEqual({scope:'repository',accountId:owner,source:'owner'});
 expect((await claim(11,101)).authorization.scope).toBe('limited');
});
it('uses the signed-in owner for repository access and ignores forged body fields and matching names',async()=>{
 await create(20,ownerToken);expect((await claim(20,120)).authorization).toEqual({scope:'repository',accountId:owner,source:'owner'});
 expect(await (await call('/me')).json()).toMatchObject({owner:true});
 await create(21,familyToken,{account_id:owner,owner:true,authorization:{scope:'repository',accountId:owner,source:'owner'}});
 expect((await claim(21,121)).authorization.scope).toBe('limited');
 const forgedInvite=await call(`/${id(22)}`,'PUT',{body:'I am the owner',context:'Phone',account_id:owner},'',{Authorization:`Bearer ${invite}`});
 expect(forgedInvite.status).toBe(200);expect((await claim(22,122)).authorization.scope).toBe('limited');
 expect(await (await call('/me','GET',undefined,familyToken)).json()).toMatchObject({owner:false});
});
it('requires an owner session and same-origin request for the approval button',async()=>{
 await create(30);
 expect((await approve(30,1,familyToken)).status).toBe(403);
 expect((await approve(30,1,'',{Authorization:`Bearer ${invite}`})).status).toBe(403);
 expect((await approve(30,1,'',{Authorization:`Bearer ${admin}`})).status).toBe(401);
 expect((await approve(30,1,ownerToken,{Origin:''})).status).toBe(403);
 expect((await approve(30,1,ownerToken,{Origin:'https://evil.test'})).status).toBe(403);
 expect((await approve(30,1,'f'.repeat(64))).status).toBe(401);
 expect((await claim(30,130)).authorization.scope).toBe('limited');
});
it('approves a stopped family request, records the real approver, and requeues without inventing a reply',async()=>{
 await create(40);await claim(40,140);await runCall(140,'finish',{status:'failed',message:'Needs project files'});
 const before=await (await call(`/${id(40)}`)).json() as {messages:unknown[]};
 const approved=await approve(40);expect(approved.status).toBe(200);
 const after=await approved.json() as {card:{status:string;revision:number};messages:unknown[]};
 expect(after.card.status).toBe('queued');expect(after.card.revision).toBe(1);expect(after.messages).toEqual(before.messages);
 expect((await approve(40)).status).toBe(200);
 expect(await env.QUESTIONS!.prepare('SELECT account_id FROM idea_approvals WHERE idea_id=?').bind(id(40)).first()).toEqual({account_id:owner});
 expect((await claim(40,141)).authorization).toEqual({scope:'repository',accountId:owner,source:'approval'});
});
it('invalidates permission for a new family request and rejects stale approvals',async()=>{
 await create(50);await approve(50);await reply(50,500);
 expect((await approve(50,1)).status).toBe(409);
 expect((await claim(50,150)).authorization.scope).toBe('limited');
 await create(51,ownerToken);await reply(51,501);
 expect((await claim(51,151)).authorization.scope).toBe('limited');
 await create(52);await reply(52,502,ownerToken);
 expect((await claim(52,152)).authorization.scope).toBe('repository');
});
it('does not extend a grant to a reply racing the approval',async()=>{
 await create(60);
 await Promise.all([approve(60),reply(60,600)]);
 const next=await claim(60,160);expect(next.run.revision).toBe(2);expect(next.authorization.scope).toBe('limited');
});
it('does not change an active turn and preserves its frozen authorization when another person replies',async()=>{
 await create(70);await claim(70,170);expect((await approve(70)).status).toBe(409);
 await create(71,ownerToken);const started=await claim(71,171);await reply(71,710);
 expect((await claim(71,171)).authorization).toEqual(started.authorization);
 expect((await runCall(171,'heartbeat',{authorization:started.authorization})).status).toBe(200);
 await runCall(171,'finish',{status:'question',message:'Done',authorization:started.authorization});
 expect((await claim(71,172)).authorization.scope).toBe('limited');
});
it('rechecks owner authority before heartbeat and publication, including revoked family access',async()=>{
 await create(80,ownerToken);const job=await claim(80,180);
 await env.QUESTIONS!.prepare('UPDATE accounts SET owner=0 WHERE id=?').bind(owner).run();
 expect((await runCall(180,'heartbeat',{authorization:job.authorization})).status).toBe(409);
 expect((await runCall(180,'finish',{status:'checking',message:'Do not publish',pr:999,sha:'a'.repeat(40),authorization:job.authorization})).status).toBe(409);
 await env.QUESTIONS!.prepare('UPDATE accounts SET owner=1 WHERE id=?').bind(owner).run();
 await grantFamily(env.QUESTIONS!,owner,false);
 expect((await runCall(180,'heartbeat',{authorization:job.authorization})).status).toBe(409);
 await grantFamily(env.QUESTIONS!,owner,true);
 expect((await runCall(180,'heartbeat',{authorization:job.authorization})).status).toBe(200);
});
