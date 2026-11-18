import { accountSession, type Account, type AccountEnv } from './accounts';
import { ideasRequest } from './ideas';
import { LIVE_PLUNGE, previewFor } from '../src/ideas/model';

const PR = /^[1-9][0-9]{0,8}$/;
const PREVIEW = /^https:\/\/plunge-pr-([1-9][0-9]{0,8})\.texas42\.workers\.dev$/;
const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), char => char.charCodeAt(0));
const key = (secret: string) => crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
interface Grant {session: string; origin: string; sha: string; state: string; expires: number}
async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader(), decoder = new TextDecoder();
  let text = '', size = 0;
  if (reader) while (true) {
    const part = await reader.read();if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {await reader.cancel();throw new Error('Request is too large.');}
    text += decoder.decode(part.value,{stream:true});
  }
  return text+decoder.decode();
}
async function checkedPreview(env: AccountEnv, origin: string) {
  const match = PREVIEW.exec(origin);
  if (!match || !env.QUESTIONS) return null;
  return env.QUESTIONS.prepare("SELECT sha FROM ideas WHERE pr=? AND preview=? AND status='ready' LIMIT 1")
    .bind(Number(match[1]), origin).first<{sha: string}>();
}

/** A one-hour, ideas-only grant. The real session cookie never leaves the main site.
 * Every request rechecks the live session, family access, and checked preview commit. */
export async function ideasPreviewRequest(request: Request, env: AccountEnv): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get('Origin') ?? '';
  const path = url.pathname.slice('/api/ideas-preview'.length);
  if (url.origin !== LIVE_PLUNGE || !env.QUESTIONS || !env.IDEAS_ADMIN_TOKEN)
    return json({error:'Real sign-in for demos needs the main Plunge app update.'},503);
  if (!path) {
    if (request.method !== 'POST' || origin !== LIVE_PLUNGE) return json({error:'Use your Plunge account to open a demo.'},403);
    try {
      const account = await accountSession(request,env);
      if (!account) return json({error:'Sign in to open this demo.'},401);
      if (!account.family) return json({error:'Family access is needed to open these ideas.'},403);
      // Only a small PR identifier is accepted; never an arbitrary return URL.
      const {pr,state} = JSON.parse(await readBody(request,200)) as {pr: unknown;state: unknown};
      if ((typeof pr !== 'number' && typeof pr !== 'string') || !PR.test(String(pr))) return json({error:'Invalid demo.'},400);
      if (typeof state !== 'string' || !/^[a-f0-9]{32}$/.test(state)) return json({error:'Start sign-in from the dashboard demo.'},400);
      const target = previewFor(Number(pr)), preview = await checkedPreview(env,target);
      if (!preview?.sha) return json({error:'This demo is waiting for its checks. Please try again when it is ready.'},409);
      const sessionToken = request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith('__Host-plunge-session='))?.slice('__Host-plunge-session='.length) ?? '';
      const sessionHash = encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sessionToken))));
      const grant: Grant = {session:sessionHash,origin:target,sha:preview.sha,state,expires:Date.now()+3600000};
      const payload = encode(new TextEncoder().encode(JSON.stringify(grant)));
      const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(env.IDEAS_ADMIN_TOKEN),new TextEncoder().encode(`ideas-preview-v1:${payload}`))));
      return json({token:`${payload}.${signature}`,origin:target});
    } catch {return json({error:'Could not open this demo. Please try again.'},503);}
  }
  // No account management, owner approval or builder operations are reachable here.
  const allowed = request.method === 'GET'
    ? /^\/(?:me|board|[a-f0-9]{32}|attachments\/[a-f0-9]{32})$/.test(path)
    : request.method === 'PUT' && /^\/[a-f0-9]{32}(?:\/messages)?$/.test(path);
  const preflight = request.method === 'OPTIONS' && ['GET','PUT'].includes(request.headers.get('Access-Control-Request-Method') ?? '');
  if (!PREVIEW.test(origin) || (!allowed && !preflight)) return json({error:'Demo request not allowed.'},403);
  const cors = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  };
  try {
    const preview = await checkedPreview(env,origin);
    if (!preview?.sha) return cors(json({error:'This demo changed or is waiting for checks. Open your live ideas to continue.'},403));
    if (preflight) return cors(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, PUT','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'60'}}));
    const token = request.headers.get('Authorization')?.match(/^Preview ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
    if (!token || token.length > 2048) return cors(json({error:'Sign in with Plunge to open this demo.'},401));
    const [payload,signature] = token.split('.');
    if (!await crypto.subtle.verify('HMAC',await key(env.IDEAS_ADMIN_TOKEN),decode(signature!),new TextEncoder().encode(`ideas-preview-v1:${payload}`)))
      return cors(json({error:'Please sign in to the demo again.'},401));
    const grant = JSON.parse(new TextDecoder().decode(decode(payload!))) as Grant;
    if (grant.origin !== origin || grant.sha !== preview.sha || !Number.isFinite(grant.expires) || grant.expires <= Date.now())
      return cors(json({error:'Demo access expired or the demo changed. Sign in again.'},401));
    const hash = Array.from(decode(grant.session),byte=>byte.toString(16).padStart(2,'0')).join('');
    const account = await env.QUESTIONS.prepare(`SELECT a.id,a.name,0 owner,a.requested,a.member_id,1 family FROM accounts a
      JOIN account_sessions s ON s.account_id=a.id JOIN idea_members m ON m.id=a.member_id
      WHERE s.hash=? AND s.expires>? AND m.revoked=0`).bind(hash,Date.now()).first<Account>();
    if (!account) return cors(json({error:'Sign in again or check your family access in Plunge.'},401));
    const target = `${LIVE_PLUNGE}/api/ideas${path === '/board' ? '' : path}${url.search}`;
    const headers = new Headers({'Origin':LIVE_PLUNGE});
    if (request.headers.has('Content-Type')) headers.set('Content-Type',request.headers.get('Content-Type')!);
    const forwarded = new Request(target,{method:request.method,headers,...(request.method === 'PUT' ? {body:await readBody(request,1_100_000)} : {})});
    return cors(await ideasRequest(forwarded,env,account));
  } catch {return cors(json({error:'Demo access could not be checked. Please sign in again.'},401));}
}
