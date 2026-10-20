import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {grantFamily,hashToken} from '../worker/accounts';

let mf:Miniflare,env:Parameters<typeof worker.fetch>[1];
const live='https://plunge.texas42.workers.dev',preview='https://plunge-pr-58.texas42.workers.dev';
const account='1'.repeat(32),session='2'.repeat(64),state='3'.repeat(32),idea='4'.repeat(32),sha='5'.repeat(40);
const request=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>worker.fetch(new Request(`${live}/api/ideas-preview${path}`,{
  method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
}),env);
const mint=(headers:Record<string,string>={},pr:unknown=58)=>request('','POST',{pr,state},{Origin:live,Cookie:`__Host-plunge-session=${session}`,...headers});
const use=(token:string,path='/me',origin=preview,method='GET',body?:unknown)=>request(path,method,body,{Origin:origin,Authorization:`Preview ${token}`});
const grant=async()=>{const response=await mint();expect(response.status).toBe(200);return (await response.json() as {token:string}).token;};
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  const db=await mf.getD1Database('QUESTIONS');
  env={QUESTIONS:db,IDEAS_ADMIN_TOKEN:'a'.repeat(64),ASSETS:{fetch:async()=>new Response('app')}};
  for(const file of ['0002_family_ideas.sql','0003_accounts.sql','0004_idea_authorizations.sql','0005_idea_screenshots.sql','0008_idea_hand_lane.sql','0010_idea_preview_revision.sql','0011_idea_releases.sql']) {
    const [tables,trigger]=(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split('CREATE TRIGGER');
    for(const statement of tables!.split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();
    if(trigger)await db.prepare(`CREATE TRIGGER${trigger}`).run();
  }
  await db.prepare('INSERT INTO accounts(id,name,owner,created) VALUES(?,?,1,0)').bind(account,'Jason').run();
  await grantFamily(db,account,true);
  await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(session),account,Date.now()+86400000).run();
  await db.prepare("INSERT INTO ideas(id,member_id,title,context,created,updated,status,pr,sha,preview) VALUES(?,?,'Dashboard','Phone','now','now','ready',58,?,?)")
    .bind(idea,account,sha,preview).run();
},20000);
afterAll(async()=>{await mf?.dispose();});

it('requires real same-origin sign-in and existing family access before issuing a checked-demo grant',async()=>{
  expect((await mint({Cookie:''})).status).toBe(401);
  expect((await mint({Origin:preview})).status).toBe(403);
  expect((await mint({},'https://evil.test')).status).toBe(400);
  expect((await mint({},59)).status).toBe(409);
  await grantFamily(env.QUESTIONS!,account,false);
  expect((await mint()).status).toBe(403);
  await grantFamily(env.QUESTIONS!,account,true);
  const token=await grant();
  const response=await use(token);
  expect(await response.json()).toEqual({id:account,name:'Jason',owner:false});
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(preview);
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  expect(response.headers.get('Set-Cookie')).toBeNull();
  expect((await use(token,'/board')).status).toBe(200);
});
it('limits cross-origin access to this preview and to ideas, with no session-cookie fallback or owner approval',async()=>{
  const token=await grant();
  expect((await use(token,'/me','https://evil.test')).status).toBe(403);
  expect((await use(token,'/me','https://plunge-pr-59.texas42.workers.dev')).status).toBe(403);
  expect((await request('/me','GET',undefined,{Origin:preview,Cookie:`__Host-plunge-session=${session}`})).status).toBe(401);
  for(const path of ['/admin/claim',`/${idea}/approve`,`/${idea}/accept`,'/account'])expect((await use(token,path,preview,'POST',{})).status).toBe(403);
  const preflight=await request('/me','OPTIONS',undefined,{Origin:preview,'Access-Control-Request-Method':'GET'});
  expect(preflight.status).toBe(204);expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(preview);
  expect((await request('/me','OPTIONS',undefined,{Origin:'https://evil.test','Access-Control-Request-Method':'GET'})).status).toBe(403);
  // The grant is not a normal invitation and cannot reach the non-delegated API.
  expect((await worker.fetch(new Request(`${live}/api/ideas/me`,{headers:{Authorization:`Bearer ${token}`}}),env)).status).toBe(401);
});
it('preserves real family authorship and replies without delegating owner build authorization',async()=>{
  const token=await grant(),id='6'.repeat(32);
  const created=await use(token,`/${id}`,preview,'PUT',{body:'Show our ideas',context:'Demo'});
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({card:{name:'Jason'},permissions:{scope:'limited'},messages:[{name:'Jason',body:'Show our ideas'}]});
  const replied=await use(token,`/${id}/messages`,preview,'PUT',{id:'7'.repeat(32),body:'A real reply'});
  expect(replied.status).toBe(200);
  expect((await use(token,`/${id}`)).status).toBe(200);
});
it('rejects forged, expired, replaced and revoked grants',async()=>{
  const token=await grant(),[payload,signature]=token.split('.');
  expect((await use(`${payload}.${signature![0]==='a'?'b':'a'}${signature!.slice(1)}`)).status).toBe(401);
  const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+3600001);
  try {expect((await use(token)).status).toBe(401);}finally{clock.mockRestore();}
  await env.QUESTIONS!.prepare('UPDATE ideas SET sha=? WHERE id=?').bind('b'.repeat(40),idea).run();
  expect((await use(token)).status).toBe(401);
  await env.QUESTIONS!.prepare('UPDATE ideas SET sha=?,status=? WHERE id=?').bind(sha,'checking',idea).run();
  expect((await use(token)).status).toBe(403);
  await env.QUESTIONS!.prepare('UPDATE ideas SET status=? WHERE id=?').bind('ready',idea).run();
  await grantFamily(env.QUESTIONS!,account,false);
  expect((await use(token)).status).toBe(401);
  await grantFamily(env.QUESTIONS!,account,true);
  await env.QUESTIONS!.prepare('DELETE FROM account_sessions').run();
  expect((await use(token)).status).toBe(401);
});
it('keeps preview workers database-free and unable to issue grants',async()=>{
  expect((await worker.fetch(new Request(`${preview}/api/ideas-preview`,{method:'POST',headers:{Origin:preview},body:'{}'}),env)).status).toBe(503);
  expect((await worker.fetch(new Request(`${live}/api/ideas-preview`),{ASSETS:env.ASSETS})).status).toBe(503);
});
