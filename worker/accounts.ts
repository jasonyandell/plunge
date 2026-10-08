import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { IdeasDatabase } from './ideas';
export interface AccountEnv {
  QUESTIONS?: IdeasDatabase; IDEAS_ADMIN_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string; APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_PRIVATE_KEY?: string;
}
export interface Account {id:string;name:string;provider:string;email:string|null;owner:number;requested:number;member_id:string|null;family:number}
interface Login {hash:string;browser_hash:string;provider:'apple'|'google';nonce:string;verifier:string;expires:number}
const ORIGIN='https://plunge.texas42.workers.dev';
const SESSION='__Host-plunge-session', LOGIN='__Host-plunge-login';
const HEX=/^[a-f0-9]{64}$/;
export const hashToken=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const cookie=(name:string,value:string,seconds:number,sameSite='Lax')=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`;
function readCookie(request:Request,name:string):string {return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)??'';}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const redirect=(path:string,cookies:string[]=[])=>{const headers=new Headers({'Location':path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});for(const c of cookies)headers.append('Set-Cookie',c);return new Response(null,{status:303,headers});};
const columns=`SELECT a.id,a.name,a.provider,a.email,a.owner,a.requested,a.member_id,CASE WHEN m.revoked=0 THEN 1 ELSE 0 END family
  FROM accounts a LEFT JOIN idea_members m ON m.id=a.member_id`;
export async function accountSession(request:Request,env:AccountEnv):Promise<Account|null> {
  const token=readCookie(request,SESSION);
  if(!env.QUESTIONS || !HEX.test(token))return null;
  return env.QUESTIONS.prepare(`${columns} JOIN account_sessions s ON s.account_id=a.id WHERE s.hash=? AND s.expires>?`)
    .bind(await hashToken(token),Date.now()).first<Account>();
}
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export async function verifyIdentity(token:string,provider:'google'|'apple',audience:string,nonce:string):Promise<JWTPayload> {
  const {payload}=await jwtVerify(token,provider==='google'?googleKeys:appleKeys,{algorithms:['RS256'],audience,
    issuer:provider==='google'?['https://accounts.google.com','accounts.google.com']:'https://appleid.apple.com',requiredClaims:['sub','iat','exp','nonce'],maxTokenAge:'10m',clockTolerance:5});
  if(payload.nonce!==nonce || typeof payload.sub!=='string' || !payload.sub || payload.sub.length>255 || (payload.azp!==undefined && payload.azp!==audience) || (Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==audience))throw new Error('Invalid identity.');
  return payload;
}
function providers(env:AccountEnv) {return {google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),apple:!!(env.APPLE_CLIENT_ID&&env.APPLE_TEAM_ID&&env.APPLE_KEY_ID&&env.APPLE_PRIVATE_KEY)};}
async function limitedText(request:Request):Promise<string> {
  const reader=request.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();let result='',size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16000){await reader.cancel();throw new Error('Too large.');}result+=decoder.decode(part.value,{stream:true});}
  return result+decoder.decode();
}
export async function grantFamily(db:IdeasDatabase,id:string,enabled:boolean) {
  // The deterministic member key preserves authorship across revoke/regrant.
  // This non-hash token marker can never authenticate as a bearer invitation.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO idea_members(id,name,token_hash,revoked)
      SELECT id,name,'account:'||id,1 FROM accounts WHERE id=?`).bind(id),
    db.prepare('UPDATE accounts SET member_id=id,requested=0 WHERE id=?').bind(id),
    db.prepare('UPDATE idea_members SET revoked=? WHERE id=(SELECT member_id FROM accounts WHERE id=?)').bind(enabled?0:1,id),
  ]);
}
export async function accountsRequest(request:Request,env:AccountEnv):Promise<Response> {
  const url=new URL(request.url),path=url.pathname.slice('/api/account'.length),db=env.QUESTIONS;
  // Auth cookies and callbacks belong only to the stable install. Preview workers lack D1.
  if(!db || url.origin!==ORIGIN)return path===''?json({account:null,providers:{apple:false,google:false},available:false}):json({error:'Open the main Plunge app to sign in.'},503);
  try {
    if(path===''&&request.method==='GET')return json({account:await accountSession(request,env),providers:providers(env),available:true});
    const callback=/^\/callback\/(apple|google)$/.exec(path);
    if(callback) {
      const provider=callback[1] as 'apple'|'google';
      if(request.method!==(provider==='apple'?'POST':'GET'))return json({error:'Invalid sign-in response.'},405);
      const params=provider==='apple'?new URLSearchParams(await limitedText(request)):url.searchParams;
      const state=params.get('state')??'',browser=readCookie(request,LOGIN);
      if(!HEX.test(state)||!HEX.test(browser))return redirect('/?account=1&login=retry');
      // Atomic consume makes callback replay and parallel exchanges fail closed.
      const login=await db.prepare('DELETE FROM account_logins WHERE hash=? AND browser_hash=? AND provider=? AND expires>? RETURNING *')
        .bind(await hashToken(state),await hashToken(browser),provider,Date.now()).first<Login>();
      if(!login)return redirect('/?account=1&login=retry');
      const clear=cookie(LOGIN,'',0,'None');
      if(params.has('error'))return redirect('/?account=1&login=cancelled',[clear]);
      const code=params.get('code');
      if(!code||code.length>4096||!providers(env)[provider])return redirect('/?account=1&login=retry',[clear]);
      try {
        const client=provider==='google'?env.GOOGLE_CLIENT_ID!:env.APPLE_CLIENT_ID!;
        const secret=provider==='google'?env.GOOGLE_CLIENT_SECRET!:await new SignJWT({})
          .setProtectedHeader({alg:'ES256',kid:env.APPLE_KEY_ID!}).setIssuer(env.APPLE_TEAM_ID!).setSubject(client)
          .setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(await importPKCS8(env.APPLE_PRIVATE_KEY!,'ES256'));
        const form=new URLSearchParams({grant_type:'authorization_code',code,client_id:client,client_secret:secret,redirect_uri:`${ORIGIN}/api/account/callback/${provider}`});
        if(provider==='google')form.set('code_verifier',login.verifier);
        const result=await fetch(provider==='google'?'https://oauth2.googleapis.com/token':'https://appleid.apple.com/auth/token',{
          method:'POST',body:form,signal:AbortSignal.timeout(15000),redirect:'error'});
        if(!result.ok)throw new Error('Exchange failed.');
        const tokens=await result.json() as {id_token?:string};if(!tokens.id_token)throw new Error('Missing identity.');
        const identity=await verifyIdentity(tokens.id_token,provider,client,login.nonce);
        const email=(identity.email_verified===true||identity.email_verified==='true')&&typeof identity.email==='string'?identity.email.slice(0,320):null;
        const name=typeof identity.name==='string'?identity.name.trim().slice(0,40)||'Player':'Player';
        // Never merge accounts by email (including Apple relay addresses).
        await db.prepare('INSERT OR IGNORE INTO accounts(id,name,provider,subject,email,created) VALUES(?,?,?,?,?,?)')
          .bind(random().slice(0,32),name,provider,identity.sub,email,Date.now()).run();
        const account=await db.prepare('SELECT id FROM accounts WHERE provider=? AND subject=?').bind(provider,identity.sub).first<{id:string}>();
        if(!account)throw new Error('Missing account.');
        const session=random(),old=readCookie(request,SESSION);
        await db.batch([
          db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(await hashToken(session),account.id,Date.now()+30*86400000),
          db.prepare('DELETE FROM account_sessions WHERE hash=? OR expires<?').bind(await hashToken(old),Date.now()),
        ]);
        return redirect('/?account=1',[clear,cookie(SESSION,session,30*86400)]);
      }catch{return redirect('/?account=1&login=retry',[clear]);}
    }
    // Every browser mutation, including starting a login, is same-origin POST.
    // CLI bootstrap uses the existing private builder credential, never a browser field.
    const bearer=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
    const admin=!!env.IDEAS_ADMIN_TOKEN&&HEX.test(bearer)&&await hashToken(bearer)===await hashToken(env.IDEAS_ADMIN_TOKEN);
    if(request.method==='POST'&&!admin&&request.headers.get('Origin')!==ORIGIN)return json({error:'Please use the main Plunge app.'},403);
    const start=/^\/start\/(apple|google)$/.exec(path);
    if(start&&request.method==='POST') {
      const provider=start[1] as 'apple'|'google';if(!providers(env)[provider])return redirect('/?account=1&login=unavailable');
      const state=random(),browser=random(),nonce=random(),verifier=random();
      await db.batch([
        db.prepare('DELETE FROM account_logins WHERE expires<? OR browser_hash=?').bind(Date.now(),await hashToken(readCookie(request,LOGIN))),
        db.prepare('INSERT INTO account_logins(hash,browser_hash,provider,nonce,verifier,expires) VALUES(?,?,?,?,?,?)')
          .bind(await hashToken(state),await hashToken(browser),provider,nonce,verifier,Date.now()+600000),
      ]);
      const target=new URL(provider==='google'?'https://accounts.google.com/o/oauth2/v2/auth':'https://appleid.apple.com/auth/authorize');
      for(const [k,v]of Object.entries({client_id:provider==='google'?env.GOOGLE_CLIENT_ID!:env.APPLE_CLIENT_ID!,redirect_uri:`${ORIGIN}/api/account/callback/${provider}`,response_type:'code',scope:provider==='google'?'openid email profile':'email',state,nonce}))target.searchParams.set(k,v);
      if(provider==='apple')target.searchParams.set('response_mode','form_post');
      else {target.searchParams.set('code_challenge_method','S256');const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));target.searchParams.set('code_challenge',btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''));}
      return redirect(target.href,[cookie(LOGIN,browser,600,'None')]);
    }
    const account=await accountSession(request,env);
    if(path==='/members'&&request.method==='GET') {
      if(!admin&&!account?.owner)return json({error:'Only Jason can manage family access.'},403);
      return json({members:(await db.prepare(`${columns} WHERE a.requested=1 OR a.member_id IS NOT NULL OR ?=1 ORDER BY a.created DESC LIMIT 200`).bind(admin?1:0).all()).results});
    }
    if(request.method!=='POST')return json({error:'Not found.'},404);
    if(path==='/logout') {
      await db.prepare('DELETE FROM account_sessions WHERE hash=?').bind(await hashToken(readCookie(request,SESSION))).run();
      return jsonWithCookie({ok:true},cookie(SESSION,'',0));
    }
    if(!account&&!admin)return json({error:'Please sign in first.'},401);
    const data=JSON.parse(await limitedText(request)||'{}') as Record<string,unknown>;
    if(path==='/profile'&&account) {
      if(typeof data.name!=='string'||!data.name.trim()||data.name.length>40)return json({error:'Use a name of 1 to 40 characters.'},400);
      await db.batch([db.prepare('UPDATE accounts SET name=? WHERE id=?').bind(data.name.trim(),account.id),db.prepare('UPDATE idea_members SET name=? WHERE id=?').bind(data.name.trim(),account.member_id)]);
      return json({ok:true});
    }
    if(path==='/request'&&account) {await db.prepare('UPDATE accounts SET requested=1 WHERE id=?').bind(account.id).run();return json({ok:true});}
    if(path==='/grant'&&(admin||account?.owner)) {
      if(typeof data.id!=='string'||!/^[a-f0-9]{32}$/.test(data.id)||typeof data.enabled!=='boolean')return json({error:'Invalid account.'},400);
      if(!await db.prepare('SELECT id FROM accounts WHERE id=?').bind(data.id).first())return json({error:'Account not found.'},404);
      await grantFamily(db,data.id,data.enabled);return json({ok:true});
    }
    if(path==='/owner'&&admin) {
      if(typeof data.id!=='string'||!/^[a-f0-9]{32}$/.test(data.id))return json({error:'Invalid account.'},400);
      if(!await db.prepare('SELECT id FROM accounts WHERE id=?').bind(data.id).first())return json({error:'Account not found.'},404);
      await db.prepare('UPDATE accounts SET owner=1 WHERE id=?').bind(data.id).run();await grantFamily(db,data.id,true);return json({ok:true});
    }
    return json({error:'Not allowed.'},403);
  }catch{return json({error:'Accounts are temporarily unavailable. You can still play.'},503);}
}
function jsonWithCookie(value:unknown,valueCookie:string){const response=json(value);response.headers.append('Set-Cookie',valueCookie);return response;}
