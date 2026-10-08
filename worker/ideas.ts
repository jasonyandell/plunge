import { screenshotBytes, validateScreenshots, type StoredScreenshot } from '../src/ideas/screenshots';
import { accountSession } from './accounts';
import { IDEA_ID, IDEA_TOKEN, previewFor, type IdeaCard } from '../src/ideas/model';
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface IdeasDatabase { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
export interface IdeasEnv { QUESTIONS?: IdeasDatabase; IDEAS_ADMIN_TOKEN?: string }
interface Member { id: string; name: string }
interface Run { id: string; idea_id: string; revision: number; through_seq: number; state: string }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const BUILD_LEASE_MS=180000;
const cards = `SELECT i.number,i.id,m.name,i.title,i.context,i.created,i.updated,i.revision,i.status,i.pr,i.sha,i.preview,CASE WHEN i.status='building' AND i.run_id IS NOT NULL THEN i.lease_until-${BUILD_LEASE_MS} ELSE NULL END heartbeat_at FROM ideas i JOIN idea_members m ON m.id=i.member_id`;
type CardRow=IdeaCard & {heartbeat_at:number|null};
function activityCard(row:CardRow):IdeaCard {
  const {heartbeat_at,...card}=row;
  return {...card,activity:{lastSeenAt:heartbeat_at,observedAt:Date.now()}};
}
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
function field(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error('Please use a shorter, nonempty message.');
  return value.trim();
}
function id(value: unknown): string { if (typeof value !== 'string' || !IDEA_ID.test(value)) throw new Error('Invalid request identifier.'); return value; }
async function body(request: Request, limit=16000): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Missing message.');
  let size = 0, text = ''; const decoder = new TextDecoder();
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Message is too large.'); }
    text += decoder.decode(next.value, { stream: true }); }
  const result: unknown = JSON.parse(text + decoder.decode());
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid message.');
  return result as Record<string, unknown>;
}
interface BuildAuthorization {scope:'limited'|'repository';accountId:string|null;source:'default'|'owner'|'approval'}
async function authorization(db:IdeasDatabase,idea:string,revision:number,through=Number.MAX_SAFE_INTEGER):Promise<BuildAuthorization> {
  // Use the actual latest requester in this frozen conversation, not a display name or card owner.
  const requester=await db.prepare(`SELECT a.id FROM accounts a JOIN idea_members m ON m.id=a.member_id
    WHERE a.owner=1 AND m.revoked=0 AND a.id=(SELECT account_id FROM idea_messages
      WHERE idea_id=? AND role='family' AND seq<=? ORDER BY seq DESC LIMIT 1)`).bind(idea,through).first<{id:string}>();
  if(requester)return {scope:'repository',accountId:requester.id,source:'owner'};
  const approval=await db.prepare(`SELECT a.id FROM idea_approvals p JOIN accounts a ON a.id=p.account_id
    JOIN idea_members m ON m.id=a.member_id WHERE p.idea_id=? AND p.revision=? AND a.owner=1 AND m.revoked=0
    ORDER BY p.created DESC LIMIT 1`).bind(idea,revision).first<{id:string}>();
  return approval?{scope:'repository',accountId:approval.id,source:'approval'}:{scope:'limited',accountId:null,source:'default'};
}
async function thread(db: IdeasDatabase, idea: string, through = Number.MAX_SAFE_INTEGER) {
  const card = await db.prepare(`${cards} WHERE i.id=?`).bind(idea).first<CardRow>();
  if (!card) return null;
  const { results: messages } = await db.prepare(`SELECT x.id,x.role,COALESCE(m.name,'Plunge builder') name,x.body,x.created,
    r.revision result_revision,(SELECT id FROM idea_messages WHERE idea_id=x.idea_id AND role='family' AND seq<=r.through_seq ORDER BY seq DESC LIMIT 1) request_id,
    (SELECT json_group_array(json_object('id',json_extract(value,'$.id'),'width',json_extract(value,'$.width'),'height',json_extract(value,'$.height')))
      FROM json_each(x.screenshots)) screenshots
    FROM idea_messages x LEFT JOIN idea_members m ON m.id=x.member_id
    LEFT JOIN idea_runs r ON r.id=x.id AND r.idea_id=x.idea_id AND r.state='done' AND x.role='builder'
    WHERE x.idea_id=? AND x.seq<=? ORDER BY x.seq`).bind(idea, through).all<{id:string;role:string;name:string;body:string;created:string;screenshots:string;result_revision:number|null;request_id:string|null}>();
  return { card:activityCard(card), messages:messages.map(({screenshots,result_revision,request_id,...message})=>({...message,screenshots:JSON.parse(screenshots),
    ...(result_revision!==null && request_id ? {result:{revision:result_revision,requestId:request_id}} : {})})), permissions:await authorization(db,idea,card.revision,through) };
}
export async function ideasRequest(request: Request, env: IdeasEnv): Promise<Response> {
  if (!env.QUESTIONS || !env.IDEAS_ADMIN_TOKEN) return json({ error: 'Ideas are not available here yet.' }, 503);
  const db = env.QUESTIONS, url = new URL(request.url), path = url.pathname.slice('/api/ideas'.length);
  if (request.method !== 'GET' && request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Please open your Plunge invite.' }, 403);
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const admin = path.startsWith('/admin/');
    if (admin) {
      if (!IDEA_TOKEN.test(token) || await hash(token) !== await hash(env.IDEAS_ADMIN_TOKEN)) return json({ error: 'Builder access required.' }, 403);
      return await adminRequest(request, path, db);
    }
    const session = await accountSession(request,env);
    if(session && request.method!=='GET' && request.headers.get('Origin')!==url.origin) return json({error:'Please use your Plunge app.'},403);
    const member = session ? (session.family && session.member_id ? {id:session.member_id,name:session.name} : null)
      : IDEA_TOKEN.test(token) ? await db.prepare('SELECT id,name FROM idea_members WHERE token_hash=? AND revoked=0').bind(await hash(token)).first<Member>() : null;
    if (!member) return json({ error: session ? 'Ask Jason to grant family access from your account.' : 'Sign in or open your family invite to join.' }, session ? 403 : 401);
    const imageMatch=/^\/attachments\/([a-f0-9]{32})$/.exec(path);
    if(imageMatch && request.method==='GET')return await screenshotResponse(db,imageMatch[1]!);
    if (path === '/me' && request.method === 'GET') return json({...member,owner:!!session?.owner});
    if (path === '' && request.method === 'GET') {
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(before) || before < 1) return json({ error: 'Invalid page.' }, 400);
      const { results } = await db.prepare(`${cards} WHERE i.number<? ORDER BY i.number DESC LIMIT 51`).bind(before).all<CardRow>();
      return json({ cards: results.slice(0, 50).map(activityCard), next: results.length > 50 ? results[49]!.number : null });
    }
    const match = /^\/([a-f0-9]{32})(\/(?:messages|approve))?$/.exec(path);
    if (!match) return json({ error: 'Not found.' }, 404);
    const idea = match[1]!;
    if (request.method === 'GET' && !match[2]) { const found = await thread(db, idea); return found ? json(found) : json({ error: 'Idea not found.' }, 404); }
    if(match[2]==='/approve' && request.method==='POST') {
      if(!session?.owner)return json({error:'Sign in to the owner account to approve this request.'},403);
      // Explicit same-origin proof is required even if an invite or admin bearer is also present.
      if(request.headers.get('Origin')!==url.origin)return json({error:'Please use your Plunge app.'},403);
      const approval=await body(request);
      if(!Number.isSafeInteger(approval.revision) || Number(approval.revision)<1)return json({error:'Invalid revision.'},400);
      // Both statements run atomically. A racing reply or build makes the approval fail closed.
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO idea_approvals(idea_id,revision,account_id,created)
          SELECT id,revision,?,? FROM ideas WHERE id=? AND revision=? AND status IN ('queued','question','failed')
          AND EXISTS(SELECT 1 FROM accounts a JOIN idea_members m ON m.id=a.member_id WHERE a.id=? AND a.owner=1 AND m.revoked=0)`)
          .bind(session.id,new Date().toISOString(),idea,approval.revision,session.id),
        db.prepare(`UPDATE ideas SET status='queued',updated=? WHERE id=? AND revision=? AND status IN ('queued','question','failed')
          AND EXISTS(SELECT 1 FROM idea_approvals WHERE idea_id=? AND revision=? AND account_id=?)`)
          .bind(new Date().toISOString(),idea,approval.revision,idea,approval.revision,session.id),
      ]);
      const current=await thread(db,idea);
      if(!current)return json({error:'Idea not found.'},404);
      const saved=await db.prepare('SELECT account_id FROM idea_approvals WHERE idea_id=? AND revision=? AND account_id=?')
        .bind(idea,approval.revision,session.id).first();
      if(!saved || current.card.revision!==approval.revision)return json({error:'This idea changed or is already building. Refresh it and review the latest request.'},409);
      return json(current);
    }
    if (request.method !== 'PUT' || match[2]==='/approve') return json({ error: 'Method not allowed.' }, 405);
    const data = await body(request,1_100_000), now = new Date().toISOString();
    const uploads=validateScreenshots(data.screenshots);
    const messageKey=match[2] ? id(data.id) : idea;
    const screenshots=JSON.stringify(await Promise.all(uploads.map(async(image,index)=>({...image,id:(await hash(`${messageKey}:screenshot:${index}`)).slice(0,32)}))));
    const emptyText=data.body===undefined || (typeof data.body==='string' && !data.body.trim());
    const text = field(emptyText && uploads.length ? 'Screenshot for this idea.' : data.body, 3000);
    if (!match[2]) {
      const context = field(data.context ?? 'No device details', 500);
      const previous = await db.prepare('SELECT member_id FROM ideas WHERE id=?').bind(idea).first<{ member_id: string }>();
      if (previous) return previous.member_id === member.id ? json(await thread(db, idea)) : json({ error: 'Identifier already used.' }, 409);
      const count = await db.prepare('SELECT COUNT(*) n FROM ideas WHERE member_id=? AND created>?').bind(member.id, new Date(Date.now() - 86400000).toISOString()).first<{ n: number }>();
      if ((count?.n ?? 0) >= 20) return json({ error: 'Twenty ideas today! Please add more tomorrow.' }, 429);
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO ideas(id,member_id,title,context,created,updated) VALUES(?,?,?,?,?,?)').bind(idea, member.id, text.length>100?text.slice(0,97)+'…':text, context, now, now),
        db.prepare(`INSERT OR IGNORE INTO idea_messages(id,idea_id,member_id,role,body,created,account_id,screenshots)
          SELECT ?,id,?,'family',?,?,?,? FROM ideas WHERE id=? AND member_id=?`).bind(idea, member.id, text, now, session?.id??null, screenshots, idea, member.id),
      ]);
      const saved = await db.prepare('SELECT member_id FROM ideas WHERE id=?').bind(idea).first<{member_id:string}>();
      return saved?.member_id === member.id ? json(await thread(db, idea)) : json({error:'Identifier already used.'},409);
    }
    const messageId = id(data.id);
    const existing = await db.prepare('SELECT idea_id,member_id FROM idea_messages WHERE id=?').bind(messageId).first<{idea_id:string;member_id:string}>();
    if (existing) return existing.idea_id === idea && existing.member_id === member.id ? json(await thread(db, idea)) : json({error:'Identifier already used.'},409);
    if (!await db.prepare('SELECT id FROM ideas WHERE id=?').bind(idea).first()) return json({error:'Idea not found.'},404);
    const count = await db.prepare('SELECT COUNT(*) n FROM idea_messages WHERE member_id=? AND created>?').bind(member.id, new Date(Date.now() - 3600000).toISOString()).first<{n:number}>();
    if ((count?.n ?? 0) >= 40) return json({error:'Please give the builder a little time before sending more.'},429);
    await db.prepare("INSERT OR IGNORE INTO idea_messages(id,idea_id,member_id,role,body,created,account_id,screenshots) VALUES(?,?,?,'family',?,?,?,?)").bind(messageId,idea,member.id,text,now,session?.id??null,screenshots).run();
    return json(await thread(db,idea));
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && /message|identifier/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: 'Could not save that yet. Your draft is still here; please retry.' }, 503);
  }
}
async function screenshotResponse(db:IdeasDatabase,imageId:string,runId?:string):Promise<Response> {
  const row=await db.prepare(`SELECT j.value FROM idea_messages m,json_each(m.screenshots) j
    WHERE json_extract(j.value,'$.id')=? ${runId ? `AND EXISTS(SELECT 1 FROM idea_runs r JOIN ideas i ON i.run_id=r.id
      WHERE r.id=? AND r.state='active' AND i.lease_until>? AND r.idea_id=m.idea_id AND m.seq<=r.through_seq)` : ''} LIMIT 1`)
    .bind(imageId,...(runId ? [runId,Date.now()] : [])).first<{value:string}>();
  if(!row)return json({error:'Screenshot not found.'},404);
  const image=JSON.parse(row.value) as StoredScreenshot;
  return new Response(screenshotBytes(image.data),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="screenshot.jpg"'}});
}
async function adminRequest(request: Request, path: string, db: IdeasDatabase): Promise<Response> {
  const imageMatch=/^\/admin\/runs\/([a-f0-9]{32})\/attachments\/([a-f0-9]{32})$/.exec(path);
  if(imageMatch && request.method==='GET')return await screenshotResponse(db,imageMatch[2]!,imageMatch[1]!);
  if (path === '/admin/tracked' && request.method === 'GET') {
    return json((await db.prepare(`${cards} WHERE i.pr IS NOT NULL AND i.status IN ('checking','ready') ORDER BY i.number`).all<CardRow>()).results.map(activityCard));
  }
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  const data = await body(request), now = new Date().toISOString();
  if (path === '/admin/retry') {
    const retried = await db.prepare("UPDATE ideas SET status='queued',updated=? WHERE id=? AND status IN ('question','failed','queued') RETURNING id")
      .bind(now,id(data.id)).first();
    return json(retried ? {ok:true} : {error:'Only a waiting or stopped idea can be retried.'},retried ? 200 : 409);
  }
  if (path === '/admin/members') {
    const name = field(data.name, 40), token = hex(crypto.getRandomValues(new Uint8Array(32))), member = hex(crypto.getRandomValues(new Uint8Array(16)));
    await db.prepare('INSERT INTO idea_members(id,name,token_hash) VALUES(?,?,?)').bind(member,name,await hash(token)).run();
    return json({id:member,name,token});
  }
  if (path === '/admin/revoke') { await db.prepare('UPDATE idea_members SET revoked=1 WHERE id=?').bind(id(data.id)).run(); return json({ok:true}); }
  if (path === '/admin/claim') {
    const requested=data.ideaId===undefined ? null : id(data.ideaId);
    const excluded=data.excludeIdeaIds ?? [];
    if(!Array.isArray(excluded) || excluded.length>4) throw new Error('Invalid excluded idea identifiers.');
    const excludedIds=JSON.stringify(excluded.map(id));
    const run = id(data.runId), until = Date.now() + BUILD_LEASE_MS;
    const previous = await db.prepare('SELECT * FROM idea_runs WHERE id=?').bind(run).first<Run>();
    if (!previous) {
      // The conditional UPDATE serializes competing builders. A run id makes lost HTTP responses retryable.
      await db.batch([
        db.prepare(`UPDATE ideas SET run_id=?,lease_until=?,status='building' WHERE id=(SELECT id FROM ideas
          WHERE (status='queued' OR (status='building' AND lease_until<?)) AND (? IS NULL OR id=?)
          AND id NOT IN (SELECT value FROM json_each(?))
          AND (? OR NOT EXISTS(SELECT 1 FROM idea_messages m WHERE m.idea_id=ideas.id AND m.screenshots!='[]'))
          ORDER BY updated,number LIMIT 1)
          AND NOT EXISTS(SELECT 1 FROM idea_runs WHERE id=?)`).bind(run,until,Date.now(),requested,requested,excludedIds,data.supportsScreenshots===true?1:0,run),
        db.prepare(`INSERT OR IGNORE INTO idea_runs(id,idea_id,revision,through_seq,created)
          SELECT ?,id,revision,(SELECT COALESCE(MAX(seq),0) FROM idea_messages WHERE idea_id=ideas.id),? FROM ideas WHERE run_id=?`).bind(run,now,run),
      ]);
    }
    const active = await db.prepare(`SELECT r.* FROM idea_runs r JOIN ideas i ON i.run_id=r.id WHERE r.id=? AND r.state='active' AND i.lease_until>?`).bind(run,Date.now()).first<Run>();
    return json(active ? {run:active,...await thread(db,active.idea_id,active.through_seq),authorization:await authorization(db,active.idea_id,active.revision,active.through_seq)} : null);
  }
  const match = /^\/admin\/runs\/([a-f0-9]{32})\/(heartbeat|progress|finish)$/.exec(path);
  if (match) {
    const run = await db.prepare('SELECT * FROM idea_runs WHERE id=?').bind(match[1]).first<Run>();
    if (!run) return json({error:'Run not found.'},404);
    if (run.state === 'done' && match[2] === 'finish') return json({ok:true});
    const current = await db.prepare('SELECT id FROM ideas WHERE run_id=? AND lease_until>?').bind(run.id,Date.now()).first();
    if (!current) return json({error:'Build lease expired.'},409);
    const authorized=await authorization(db,run.idea_id,run.revision,run.through_seq);
    if(data.authorization && JSON.stringify(data.authorization)!==JSON.stringify(authorized))return json({error:'Build authorization changed.'},409);
    if (match[2] === 'progress') {
      const sequence=data.sequence, message=field(data.message,800);
      if(!Number.isSafeInteger(sequence) || Number(sequence)<0 || Number(sequence)>=20)return json({error:'Invalid update sequence.'},400);
      const messageId=(await hash(`${run.id}:progress:${sequence}`)).slice(0,32);
      const result=await db.prepare(`INSERT OR IGNORE INTO idea_messages(id,idea_id,role,body,created)
        SELECT ?,id,'builder',?,? FROM ideas WHERE run_id=? AND lease_until>? RETURNING id`)
        .bind(messageId,message,now,run.id,Date.now()).first();
      // Idempotent retry succeeds, but a replaced/expired worker cannot append.
      if(!result && !await db.prepare('SELECT id FROM idea_messages WHERE id=?').bind(messageId).first())return json({error:'Build lease expired.'},409);
      return json({ok:true});
    }
    if (match[2] === 'heartbeat') {
      const result = await db.prepare('UPDATE ideas SET lease_until=? WHERE run_id=? AND lease_until>? RETURNING id').bind(Date.now()+BUILD_LEASE_MS,run.id,Date.now()).first();
      return json(result ? {ok:true,authorization:authorized} : {error:'Build lease expired.'},result ? 200 : 409);
    }
    const finishedAt=Date.now();
    const message = field(data.message,3000), status = data.status;
    if (!['checking','question','failed'].includes(String(status))) return json({error:'Invalid result.'},400);
    const pr = data.pr ?? null, sha = data.sha ?? null;
    if (status === 'checking' && (!Number.isSafeInteger(pr) || Number(pr)<1 || typeof sha!=='string' || !/^[a-f0-9]{40}$/.test(sha))) return json({error:'Missing build identity.'},400);
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO idea_messages(id,idea_id,role,body,created)
        SELECT ?,id,'builder',?,? FROM ideas WHERE run_id=? AND lease_until>?`).bind(run.id,message,now,run.id,finishedAt),
      db.prepare(`UPDATE idea_runs SET state='done' WHERE id=? AND EXISTS(SELECT 1 FROM ideas WHERE run_id=? AND lease_until>?)`).bind(run.id,run.id,finishedAt),
      db.prepare(`UPDATE ideas SET status=CASE WHEN revision>? THEN 'queued' ELSE ? END,
        pr=COALESCE(?,pr),sha=COALESCE(?,sha),preview=NULL,updated=?,run_id=NULL,lease_until=NULL WHERE run_id=? AND lease_until>?`)
        .bind(run.revision,status,status==='checking'?pr:null,status==='checking'?sha:null,now,run.id,finishedAt),
    ]);
    return json({ok:true});
  }
  if (path === '/admin/refresh') {
    const idea=id(data.id);
    if(typeof data.nextSha!=='string'||!/^[a-f0-9]{40}$/.test(data.nextSha))return json({error:'Invalid build.'},400);
    await db.prepare("UPDATE ideas SET status='checking',sha=?,preview=NULL,updated=? WHERE id=? AND sha=? AND status IN ('checking','ready')")
      .bind(data.nextSha,now,idea,data.sha).run();
    return json({ok:true});
  }
  if (path === '/admin/publish') {
    const idea = id(data.id), status = data.status;
    if (!['ready','failed','shipped','closed'].includes(String(status))) return json({error:'Invalid publication.'},400);
    const card = await db.prepare(`${cards} WHERE i.id=?`).bind(idea).first<IdeaCard>();
    if (!card || card.sha !== data.sha || !card.pr) return json({error:'Build changed.'},409);
    if (status === 'ready') {
      // Only our own deployment URL, never a URL supplied by a model or client.
      const response = await fetch(`${previewFor(card.pr)}/version.json`, {signal:AbortSignal.timeout(8000),cache:'no-store'});
      const version = await response.json() as {build?:string;preview_pr?:number};
      if (!response.ok || version.build!==card.sha || version.preview_pr!==card.pr) return json({error:'Preview is not ready.'},409);
    }
    await db.prepare(`UPDATE ideas SET status=?,preview=?,updated=? WHERE id=? AND sha=? AND status IN ('checking','ready')`)
      .bind(status,status==='ready'?previewFor(card.pr):null,now,idea,card.sha).run();
    return json({ok:true});
  }
  return json({error:'Not found.'},404);
}
