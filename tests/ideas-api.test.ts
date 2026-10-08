import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index';
import type { IdeaThread } from '../src/ideas/model';
let mf: Miniflare;
let env: Parameters<typeof worker.fetch>[1];
const admin='a'.repeat(64), id=(n:number)=>n.toString(16).padStart(32,'0');
let mom: {id:string;token:string}, dad: {id:string;token:string};
const call=(path='',method='GET',data?:unknown,token=mom?.token,origin?:string) => worker.fetch(new Request(`https://plunge.test/api/ideas${path}`,{
  method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},
  ...(data===undefined?{}:{body:JSON.stringify(data)}),
}),env);
const claim=async(n:number)=> (await call('/admin/claim','POST',{runId:id(n)},admin)).json() as Promise<{run:{id:string;revision:number};card:{id:string};messages:{body:string}[]}|null>;
const finish=(n:number,data:unknown)=>call(`/admin/runs/${id(n)}/finish`,'POST',data,admin);
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  const db=await mf.getD1Database('QUESTIONS');
  const sql=await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8');
  const [tables,trigger]=sql.split('CREATE TRIGGER');
  for(const statement of tables!.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for(const file of ['0003_accounts.sql','0004_idea_authorizations.sql','0005_idea_screenshots.sql'])
    for(const statement of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  env={QUESTIONS:db,IDEAS_ADMIN_TOKEN:admin,ASSETS:{fetch:async()=>new Response('app')}};
  mom=await (await call('/admin/members','POST',{name:'Mom'},admin)).json() as typeof mom;
  dad=await (await call('/admin/members','POST',{name:'Dad'},admin)).json() as typeof dad;
},20000);
afterAll(async()=>{await mf?.dispose();});
describe('family idea conversations and automatic builds',()=>{
  it('requires a personal invite, keeps builder operations separate, rejects other origins',async()=>{
    expect((await call('','GET',undefined,'')).status).toBe(401);
    expect((await call('/admin/claim','POST',{runId:id(99)},mom.token)).status).toBe(403);
    expect((await call(`/${id(1)}`,'PUT',{body:'Idea',context:'Phone'},mom.token,'https://elsewhere.test')).status).toBe(403);
    expect(await (await call('/me')).json()).toEqual({id:mom.id,name:'Mom',owner:false});
  });
  it('creates multiple cards and makes lost-response retries idempotent',async()=>{
    for(const n of [1,2])expect((await call(`/${id(n)}`,'PUT',{body:`I cannot see my bid ${n}`,context:'iPhone 320×780'})).status).toBe(200);
    await call(`/${id(1)}`,'PUT',{body:'Do not replace original',context:'other'});
    const thread=await (await call(`/${id(1)}`)).json() as IdeaThread;
    expect(thread.messages).toHaveLength(1);expect(thread.card.revision).toBe(1);expect(thread.messages[0]!.body).toBe('I cannot see my bid 1');
    expect((await call(`/${id(1)}`,'PUT',{body:'Other owner',context:'Phone'},dad.token)).status).toBe(409);
  });
  it('claims each card once even with concurrent builders and retries',async()=>{
    const results=await Promise.all([claim(100),claim(101)]);
    expect(new Set(results.map(r=>r!.card.id)).size).toBe(2);
    const again=await claim(100);expect(again!.card.id).toBe(results[0]!.card.id);
    expect(await claim(102)).toBeNull();
  });
  it('preserves replies arriving during a build and schedules another pass',async()=>{
    const job=(await claim(100))!;
    await call(`/${job.card.id}/messages`,'PUT',{id:id(20),body:'Can you make it bigger too?'},dad.token);
    await call(`/${job.card.id}/messages`,'PUT',{id:id(20),body:'Duplicate retry'},dad.token);
    expect((await finish(100,{status:'checking',message:'The bid is visible.',pr:99,sha:'b'.repeat(40)})).status).toBe(200);
    await finish(100,{status:'failed',message:'Duplicate must not change state.'});
    const thread=await (await call(`/${job.card.id}`)).json() as IdeaThread;
    expect(thread.card.status).toBe('queued');expect(thread.card.revision).toBe(2);expect(thread.messages).toHaveLength(3);
    expect(thread.messages[1]!.name).toBe('Dad');
    const next=(await claim(103))!;expect(next.card.id).toBe(job.card.id);expect(next.messages.some(m=>m.body.includes('bigger'))).toBe(true);
  });
  it('rejects stale builders after expiry and gives a replacement the conversation',async()=>{
    const old=(await claim(101))!;
    await env.QUESTIONS!.prepare('UPDATE ideas SET lease_until=0 WHERE run_id=?').bind(id(101)).run();
    const next=(await claim(104))!;expect(next.card.id).toBe(old.card.id);
    expect((await finish(101,{status:'question',message:'Old builder'})).status).toBe(409);
    expect((await finish(104,{status:'question',message:'Is it the number or the trump that is hard to see?'})).status).toBe(200);
    const thread=await (await call(`/${old.card.id}`)).json() as IdeaThread;
    expect(thread.card.status).toBe('question');expect(thread.messages.some(m=>m.body==='Old builder')).toBe(false);
  });
  it('waits for the exact live PR build and ignores stale deployment reports',async()=>{
    const job=(await claim(103))!;
    await finish(103,{status:'checking',message:'Larger bid ready for checks.',pr:99,sha:'c'.repeat(40)});
    const publish=()=>call('/admin/publish','POST',{id:job.card.id,sha:'c'.repeat(40),status:'ready'},admin);
    const fetch=vi.spyOn(globalThis,'fetch');
    fetch.mockResolvedValueOnce(Response.json({build:'b'.repeat(40),preview_pr:99}));expect((await publish()).status).toBe(409);
    fetch.mockResolvedValueOnce(Response.json({build:'c'.repeat(40),preview_pr:99}));expect((await publish()).status).toBe(200);
    fetch.mockRestore();
    let thread=await (await call(`/${job.card.id}`)).json() as IdeaThread;
    expect(thread.card.status).toBe('ready');expect(thread.card.preview).toBe('https://plunge-pr-99.texas42.workers.dev');
    await call(`/${job.card.id}/messages`,'PUT',{id:id(30),body:'One more adjustment'});
    expect((await call('/admin/publish','POST',{id:job.card.id,sha:'b'.repeat(40),status:'shipped'},admin)).status).toBe(409);
    await call('/admin/publish','POST',{id:job.card.id,sha:'c'.repeat(40),status:'shipped'},admin);
    thread=await (await call(`/${job.card.id}`)).json() as IdeaThread;expect(thread.card.status).toBe('queued');
  });
  it('targets a specific card and invalidates a preview after a manual PR update',async()=>{
    const idea=id(50);
    await call(`/${idea}`,'PUT',{body:'A separate idea',context:'Phone'});
    const picked=await (await call('/admin/claim','POST',{runId:id(150),ideaId:idea},admin)).json() as {card:{id:string}};
    expect(picked.card.id).toBe(idea);
    await finish(150,{status:'checking',message:'Ready for checks.',pr:150,sha:'e'.repeat(40)});
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({build:'e'.repeat(40),preview_pr:150}));
    await call('/admin/publish','POST',{id:idea,sha:'e'.repeat(40),status:'ready'},admin);fetch.mockRestore();
    await call('/admin/refresh','POST',{id:idea,sha:'e'.repeat(40),nextSha:'f'.repeat(40)},admin);
    const updated=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(updated.card.status).toBe('checking');expect(updated.card.preview).toBeNull();expect(updated.card.sha).toBe('f'.repeat(40));
    expect((await call('/admin/publish','POST',{id:idea,sha:'e'.repeat(40),status:'closed'},admin)).status).toBe(409);
  });
  it('lets only the private coordinator retry a stopped card without changing its conversation or interrupting a build',async()=>{
    const idea=id(60);
    await call(`/${idea}`,'PUT',{body:'Room voting',context:'Phone'});
    await call('/admin/claim','POST',{runId:id(160),ideaId:idea},admin);
    expect((await call('/admin/retry','POST',{id:idea},admin)).status).toBe(409);
    await finish(160,{status:'failed',message:'This needs a private scope adjustment.'});
    const before=await (await call(`/${idea}`)).json() as IdeaThread;
    expect((await call('/admin/retry','POST',{id:idea},mom.token)).status).toBe(403);
    expect((await call('/admin/retry','POST',{id:idea},admin)).status).toBe(200);
    expect((await call('/admin/retry','POST',{id:idea},admin)).status).toBe(200);
    const after=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(after.card.status).toBe('queued');expect(after.card.revision).toBe(before.card.revision);
    expect(after.messages).toEqual(before.messages);
    const next=await (await call('/admin/claim','POST',{runId:id(161),ideaId:idea},admin)).json() as {card:{id:string}};
    expect(next.card.id).toBe(idea);
    await finish(161,{status:'question',message:'A product question.'});
    expect((await call('/admin/retry','POST',{id:idea},admin)).status).toBe(200);
    expect((await call('/admin/retry','POST',{id:id(999)},admin)).status).toBe(409);
  });
  it('excludes locally active ideas even after lease expiry while other cards can progress',async()=>{
    const idea=id(70),other=id(71);
    for(const n of [70,71])await call(`/${id(n)}`,'PUT',{body:'Concurrent idea',context:'Phone'});
    await call('/admin/claim','POST',{runId:id(170),ideaId:idea},admin);
    await env.QUESTIONS!.prepare('UPDATE ideas SET lease_until=0 WHERE id=?').bind(idea).run();
    const skipped=await (await call('/admin/claim','POST',{runId:id(171),ideaId:idea,excludeIdeaIds:[idea]},admin)).json();
    expect(skipped).toBeNull();
    const picked=await (await call('/admin/claim','POST',{runId:id(172),ideaId:other,excludeIdeaIds:[idea]},admin)).json() as {card:{id:string}};
    expect(picked.card.id).toBe(other);
    const previous=await env.QUESTIONS!.prepare('SELECT run_id FROM ideas WHERE id=?').bind(idea).first<{run_id:string}>();
    expect(previous!.run_id).toBe(id(170));
    for(const excludeIdeaIds of [['invalid'],[idea,idea,idea,idea,idea],idea])
      expect((await call('/admin/claim','POST',{runId:id(173),excludeIdeaIds},admin)).status).toBe(400);
  });
  it('exposes check-in times on the board and conversation, keeps stale activity honest, and clears it on finish',async()=>{
    const idea=id(80),run=id(180);
    await call(`/${idea}`,'PUT',{body:'Show progress',context:'Phone'});
    const before=Date.now();
    await call('/admin/claim','POST',{runId:run,ideaId:idea},admin);
    let current=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(current.card.activity!.lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(current.card.activity!.observedAt).toBeGreaterThanOrEqual(current.card.activity!.lastSeenAt!);
    expect(JSON.stringify(current.card)).not.toMatch(/run_id|lease_until|heartbeat_at/);
    const old=Date.now()-120000;
    await env.QUESTIONS!.prepare('UPDATE ideas SET lease_until=? WHERE id=?').bind(old+180000,idea).run();
    const board=await (await call()).json() as {cards:IdeaThread['card'][]};
    expect(board.cards.find(c=>c.id===idea)!.activity!.lastSeenAt).toBe(old);
    await call(`/admin/runs/${run}/heartbeat`,'POST',{},admin);
    current=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(current.card.activity!.lastSeenAt).toBeGreaterThan(old);
    await finish(180,{status:'question',message:'Which part should be clearer?'});
    current=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(current.card.activity!.lastSeenAt).toBeNull();
  });
  it('streams idempotent conversation updates only from the live builder without requeueing or losing family replies',async()=>{
    const idea=id(90),run=id(190),path=`/admin/runs/${run}/progress`;
    await call(`/${idea}`,'PUT',{body:'Keep my bid visible',context:'Phone'});
    const job=await (await call('/admin/claim','POST',{runId:run,ideaId:idea},admin)).json() as {authorization:unknown};
    const update={sequence:0,message:'I understand: keep your own bid visible while others bid.',authorization:job.authorization};
    expect((await call(path,'POST',update)).status).toBe(403);
    expect((await call(path,'POST',{...update,authorization:{scope:'repository'}},admin)).status).toBe(409);
    expect((await call(path,'POST',update,admin)).status).toBe(200);
    expect((await call(path,'POST',update,admin)).status).toBe(200);
    let thread=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(thread.messages.map(m=>m.body)).toEqual(['Keep my bid visible',update.message]);
    expect(thread.card).toMatchObject({status:'building',revision:1});
    await call(`/${idea}/messages`,'PUT',{id:id(91),body:'Yes, including when I pass.'});
    expect((await call(path,'POST',{...update,sequence:1,message:'Checking the change now.'},admin)).status).toBe(200);
    expect((await call(path,'POST',{...update,sequence:20},admin)).status).toBe(400);
    expect((await call(path,'POST',{...update,sequence:2,message:'x'.repeat(801)},admin)).status).toBe(400);
    await finish(190,{status:'question',message:'Would larger letters help too?'});
    expect((await call(path,'POST',{...update,sequence:2},admin)).status).toBe(409);
    thread=await (await call(`/${idea}`)).json() as IdeaThread;
    expect(thread.card).toMatchObject({status:'queued',revision:2});
    expect(thread.messages.map(m=>m.body)).toContain('Yes, including when I pass.');
  });
  it('bounds inputs, supports invite revocation, and keeps previews isolated',async()=>{
    expect((await call(`/${id(4)}`,'PUT',{body:'x'.repeat(16001)})).status).toBe(400);
    expect((await call('/admin/revoke','POST',{id:dad.id},admin)).status).toBe(200);
    expect((await call('','GET',undefined,dad.token)).status).toBe(401);
    const res=await worker.fetch(new Request('https://preview.test/api/ideas'),{ASSETS:env.ASSETS});expect(res.status).toBe(503);
    const serialized=JSON.stringify(await (await call()).json());expect(serialized).not.toContain(mom.token);expect(serialized).not.toContain('token_hash');
  });
});

it('keeps screenshots private, atomic, immutable on retry, and frozen to the claimed conversation',async()=>{
  const data=await readFile(new URL('./fixtures/screenshot.base64',import.meta.url),'utf8');
  const idea=id(800),message=id(801),run=id(802);
  // Isolate this case from the earlier revocation test.
  const member=await (await call('/admin/members','POST',{name:'Picture sender'},admin)).json() as {token:string};
  const other=await (await call('/admin/members','POST',{name:'Picture viewer'},admin)).json() as {id:string;token:string};
  const create=()=>call(`/${idea}`,'PUT',{body:'Put bidding beside these names',screenshots:[{data}]},member.token);
  expect((await create()).status).toBe(200);
  const first=await (await create()).json() as IdeaThread;
  expect(first.card.revision).toBe(1);expect(first.messages).toHaveLength(1);
  const images=first.messages[0]!.screenshots!;
  expect(images).toHaveLength(1);expect(images[0]).toMatchObject({width:20,height:30});
  expect(JSON.stringify(first)).not.toContain(data);
  const imagePath=`/attachments/${images[0]!.id}`;
  expect((await call(imagePath,'GET',undefined,'')).status).toBe(401);
  const picture=await call(imagePath,'GET',undefined,other.token);
  expect(picture.headers.get('cache-control')).toBe('private, no-store');
  expect(Buffer.from(await picture.arrayBuffer()).toString('base64')).toBe(data);
  expect((await call(`/${idea}`,'PUT',{body:'Retry must not add another image',screenshots:[{data},{data}]},member.token)).status).toBe(200);
  expect(((await (await call(`/${idea}`,'GET',undefined,member.token)).json()) as IdeaThread).messages[0]!.screenshots).toHaveLength(1);
  expect(await (await call('/admin/claim','POST',{runId:run,ideaId:idea},admin)).json()).toBeNull();
  const job=await (await call('/admin/claim','POST',{runId:run,ideaId:idea,supportsScreenshots:true},admin)).json() as IdeaThread;
  expect(job.messages[0]!.screenshots).toEqual(images);
  const download=(image:string)=>call(`/admin/runs/${run}/attachments/${image}`,'GET',undefined,admin);
  expect((await download(images[0]!.id)).status).toBe(200);
  const reply=await (await call(`/${idea}/messages`,'PUT',{id:message,body:'',screenshots:[{data}]},member.token)).json() as IdeaThread;
  expect(reply.messages[1]!.body).toBe('Screenshot for this idea.');
  expect((await download(reply.messages[1]!.screenshots![0]!.id)).status).toBe(404);
  expect((await call(`/admin/runs/${id(803)}/attachments/${images[0]!.id}`,'GET',undefined,admin)).status).toBe(404);
  await call('/admin/revoke','POST',{id:other.id},admin);
  expect((await call(imagePath,'GET',undefined,other.token)).status).toBe(401);
  await env.QUESTIONS!.prepare('UPDATE ideas SET lease_until=0 WHERE run_id=?').bind(run).run();
  expect((await download(images[0]!.id)).status).toBe(404);
  for(const screenshots of [[{data:'<svg></svg>'}],[{data:'AAAA'}],[{data:'A'.repeat(540000)}],[{data},{data},{data}]]) {
    expect((await call(`/${id(804)}`,'PUT',{body:'Rejected picture',screenshots},member.token)).status).toBe(400);
    expect((await call(`/${id(804)}`,'GET',undefined,member.token)).status).toBe(404);
  }
});
