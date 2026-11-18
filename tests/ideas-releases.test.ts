import {afterAll,beforeAll,afterEach,expect,it,vi} from 'vitest';
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
 // Its trigger body runs whole; everything before it splits on `;`.
 const [laneSql,laneTrigger]=(await readFile(new URL('../migrations/0008_idea_hand_lane.sql',import.meta.url),'utf8')).split('CREATE TRIGGER');
 for(const statement of laneSql!.split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();
 await db.prepare(`CREATE TRIGGER${laneTrigger}`).run();
  for(const statement of (await readFile(new URL('../migrations/0010_idea_preview_revision.sql',import.meta.url),'utf8')).split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();
  for(const statement of (await readFile(new URL('../migrations/0011_idea_releases.sql',import.meta.url),'utf8')).split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();
},20000);
afterAll(async()=>{await mf?.dispose();});

const sha='a'.repeat(40),newSha='e'.repeat(40),merge='b'.repeat(40);
const adminCall=(path:string,data?:unknown)=>call('/admin/'+path,data?'POST':'GET',data,'',{Authorization:`Bearer ${admin}`});
const ready=async(n:number)=>{await create(n);await env.QUESTIONS!.prepare("UPDATE ideas SET status='ready',preview_revision=revision,pr=74,sha=?,preview='https://plunge-pr-74.texas42.workers.dev' WHERE id=?").bind(sha,id(n)).run();};
const accept=(n:number,extra={},token=ownerToken,headers={})=>call(`/${id(n)}/accept`,'POST',{revision:1,pr:74,sha,...extra},token,headers);
const preview=()=>vi.stubGlobal('fetch',vi.fn(async()=>Response.json({build:sha,preview_pr:74})));
afterEach(()=>vi.unstubAllGlobals());
it('requires an authenticated owner and same-origin proof; build approvals are not release acceptance',async()=>{
 await ready(200);preview();
 for(const [token,headers,status] of [[familyToken,{},403],['',{Authorization:`Bearer ${invite}`},403],[ownerToken,{Origin:''},403],[ownerToken,{Origin:'https://evil.test'},403]] as const)
  expect((await accept(200,{owner:true,accountId:owner},token,headers)).status).toBe(status);
 expect(await env.QUESTIONS!.prepare('SELECT id FROM idea_releases').first()).toBeNull();
 expect((await call('/admin/releases')).status).toBe(403);
});
it('accepts exactly the preview shown, records the owner, and makes retries idempotent',async()=>{
 await ready(201);preview();
 expect((await accept(201,{sha:newSha})).status).toBe(409);
 expect((await accept(201,{revision:2})).status).toBe(409);
 expect((await accept(201)).status).toBe(200);
 expect((await accept(201)).status).toBe(200);
 const rows=await env.QUESTIONS!.prepare('SELECT account_id,status FROM idea_releases WHERE idea_id=?').bind(id(201)).all();
 expect(rows.results).toEqual([{account_id:owner,status:'queued'}]);
 const thread=await (await call(`/${id(201)}`)).json() as {release:Record<string,unknown>};
 expect(thread.release).toMatchObject({status:'queued',sha,revision:1});expect(thread.release.account_id).toBeUndefined();
 expect((await reply(201,2010)).status).toBe(409);
 expect((await adminCall('refresh',{id:id(201),sha,nextSha:newSha})).status).toBe(409);
});
it('rejects a changed hosted preview and a reply racing the preview network check',async()=>{
 await ready(202);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({build:newSha,preview_pr:74})));
 expect((await accept(202)).status).toBe(409);
 await ready(203);vi.stubGlobal('fetch',vi.fn(async()=>{await reply(203,2030);return Response.json({build:sha,preview_pr:74});}));
 expect((await accept(203)).status).toBe(409);
 expect(await env.QUESTIONS!.prepare('SELECT id FROM idea_releases WHERE idea_id=?').bind(id(203)).first()).toBeNull();
});
it('serializes release workers, rechecks owner authority, and marks shipped only after the deployment stage',async()=>{
 await ready(204);preview();await accept(204);
 const {id:releaseId}=await env.QUESTIONS!.prepare('SELECT id FROM idea_releases WHERE idea_id=?').bind(id(204)).first<{id:string}>()??{id:''};
 const action=(op:string,data={})=>adminCall(`releases/${releaseId}/${op}`,{lease:id(900),...data});
 expect((await action('claim')).status).toBe(200);
 expect((await action('claim',{lease:id(901)})).status).toBe(409);
 expect((await action('authorize')).status).toBe(200);
 await grantFamily(env.QUESTIONS!,owner,false);
 expect((await action('authorize')).status).toBe(409);
 await grantFamily(env.QUESTIONS!,owner,true);
 expect((await action('finish',{status:'shipped',mergeSha:merge,note:'Live'})).status).toBe(409);
 expect((await action('finish',{status:'deploying',mergeSha:merge,note:'Releasing'})).status).toBe(200);
 expect((await action('claim')).status).toBe(200);
 expect((await action('finish',{status:'shipped',mergeSha:merge,note:'Live'})).status).toBe(200);
 const thread=await (await call(`/${id(204)}`)).json() as {card:{status:string};release:{status:string}};
 expect(thread.card.status).toBe('shipped');expect(thread.release.status).toBe('shipped');
 expect((await accept(204)).status).toBe(200);
 expect((await reply(204,2040)).status).toBe(200);
});
it('allows an expired lease to recover the same acceptance and a blocked acceptance to be explicitly retried',async()=>{
 await ready(205);preview();await accept(205);
 const {id:releaseId}=await env.QUESTIONS!.prepare('SELECT id FROM idea_releases WHERE idea_id=?').bind(id(205)).first<{id:string}>()??{id:''};
 const action=(op:string,data={})=>adminCall(`releases/${releaseId}/${op}`,{lease:id(902),...data});
 await action('claim');await env.QUESTIONS!.prepare('UPDATE idea_releases SET lease_until=0 WHERE id=?').bind(releaseId).run();
 expect((await action('claim',{lease:id(903)})).status).toBe(200);
 expect((await action('finish',{status:'blocked',note:'Needs attention'})).status).toBe(409);
 expect((await action('finish',{lease:id(903),status:'blocked',note:'Needs attention'})).status).toBe(200);
 expect((await accept(205)).status).toBe(200);
 expect(await env.QUESTIONS!.prepare('SELECT status FROM idea_releases WHERE id=?').bind(releaseId).first()).toEqual({status:'queued'});
});
