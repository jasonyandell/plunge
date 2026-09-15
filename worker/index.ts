import { MAX_QUESTION_BYTES, OWNER_TOKEN, QUESTION_ID, publicQuestion, validQuestion, validUpdate,
  type Question, type RemoteQuestion } from '../src/questions/model';

// Minimal D1 surface keeps the browser and worker type environments independent.
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{results:T[]}>;
  run(): Promise<unknown>;
}
interface Env { QUESTIONS: { prepare(sql:string):Statement }; ASSETS: { fetch(request:Request):Promise<Response> } }
interface Row { id:string; owner_hash:string; revision:number; payload:string; answer:string|null; answered_at:string|null }
const json = (value: unknown, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const remote = (r:Row):RemoteQuestion => ({question:JSON.parse(r.payload) as Question,revision:r.revision,
  answer:r.answer && r.answered_at ? {body:r.answer,updated:r.answered_at} : null});
async function owner(request:Request):Promise<string|null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /,'') ?? '';
  if (!OWNER_TOKEN.test(token)) return null;
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function body(request:Request):Promise<unknown> {
  const reader=request.body?.getReader();
  if (!reader) throw new Error('Missing question.');
  let size=0, text=''; const decoder=new TextDecoder();
  while (true) {
    const r=await reader.read(); if(r.done) break;
    size+=r.value.length;
    if(size>MAX_QUESTION_BYTES) {await reader.cancel();throw new Error('Question is too large.');}
    text+=decoder.decode(r.value,{stream:true});
  }
  return JSON.parse(text+decoder.decode());
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const match=/^\/api\/questions(?:\/([a-f0-9]{32}))?$/.exec(url.pathname);
    if (!match) return json({error:'Not found.'},404);
    const id=match[1];
    try {
      if(request.method==='GET' && id) {
        const row=await env.QUESTIONS.prepare('SELECT * FROM questions WHERE id = ?').bind(id).first<Row>();
        return row ? json(publicQuestion(remote(row).question,remote(row).answer)) : json({error:'Question not found.'},404);
      }
      const hash=await owner(request);
      if(!hash) return json({error:'A browser question key is required.'},401);
      if(request.method==='GET' && !id) {
        const before=url.searchParams.get('before');
        if(before && !QUESTION_ID.test(before)) return json({error:'Invalid page.'},400);
        const {results}=await env.QUESTIONS.prepare('SELECT * FROM questions WHERE owner_hash = ? AND id < ? ORDER BY id DESC LIMIT 51')
          .bind(hash,before ?? 'g').all<Row>();
        return json({items:results.slice(0,50).map(remote),next:results.length>50 ? results[49]!.id : null});
      }
      if(request.method!=='PUT' || !id) return json({error:'Method not allowed.'},405);
      const origin=request.headers.get('Origin');
      if(origin && origin!==url.origin) return json({error:'Wrong origin.'},403);
      let q:Question,revision:number;
      try {
        const data=await body(request) as {question:unknown;revision:number};
        q=validQuestion(data.question);revision=data.revision;
        if(q.id!==id || !Number.isSafeInteger(revision) || revision<1) throw new Error('Invalid version.');
      } catch(e) {return json({error:e instanceof Error ? e.message : 'Invalid question.'},400);}
      const previous=await env.QUESTIONS.prepare('SELECT * FROM questions WHERE id = ?').bind(id).first<Row>();
      if(previous && previous.owner_hash!==hash) return json({error:'Question belongs to another browser.'},403);
      if(previous && revision<=previous.revision) return json({revision:previous.revision,answer:remote(previous).answer});
      if(previous && !validUpdate(remote(previous).question,q)) return json({error:'Original evidence cannot be replaced.'},409);
      const now=new Date().toISOString();
      // CAS prevents a delayed upload from replacing a newer one, even with simultaneous tabs.
      await env.QUESTIONS.prepare(`INSERT INTO questions(id,owner_hash,revision,payload,created,updated) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated=excluded.updated
        WHERE questions.owner_hash=excluded.owner_hash AND questions.revision=?`)
        .bind(id,hash,revision,JSON.stringify(q),now,now,previous?.revision ?? 0).run();
      const saved=await env.QUESTIONS.prepare('SELECT * FROM questions WHERE id = ?').bind(id).first<Row>();
      if(!saved || saved.owner_hash!==hash) return json({error:'Please retry the saved question.'},409);
      if(saved.revision!==revision) return json({error:'A newer upload arrived. Please refresh.'},409);
      return json({revision:saved.revision,answer:remote(saved).answer});
    } catch {return json({error:'Questions are temporarily unavailable. Your device can retry.'},503);}
  },
};
