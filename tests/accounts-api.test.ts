import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT } from 'jose';
import worker from '../worker/index';
import { hashToken } from '../worker/accounts';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1];
let signing:CryptoKey,appleSigning:CryptoKey,jwk:unknown,appleJwk:unknown;
const origin='https://plunge.texas42.workers.dev',admin='a'.repeat(64);
let momCookie='',momId='',dadCookie='',dadId='';
const call=(path='',method='GET',body?:unknown,cookie='',extra:Record<string,string>={})=>worker.fetch(new Request(`${origin}/api/account${path}`,{method,headers:{Origin:origin,Cookie:cookie,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);
const idea=(cookie:string,method='GET',extra:Record<string,string>={})=>worker.fetch(new Request(`${origin}/api/ideas/me`,{method,headers:{Cookie:cookie,Origin:origin,...extra}}),env);
function cookieFrom(response:Response,name:string) {return `${name}=${response.headers.get('Set-Cookie')?.match(new RegExp(`${name}=([^;, ]+)`))?.[1]??''}`;}
async function start(provider='google') {
  const response=await call(`/start/${provider}`,'POST');expect(response.status).toBe(303);
  const target=new URL(response.headers.get('Location')!);
  return {target,cookie:cookieFrom(response,'__Host-plunge-login'),state:target.searchParams.get('state')!,nonce:target.searchParams.get('nonce')!};
}
async function signed(provider='google',nonce:string,sub='mom',extra:Record<string,unknown>={}) {
  return new SignJWT({nonce,email:'shared@example.test',email_verified:true,name:sub,sub,
    iss:provider==='google'?'https://accounts.google.com':'https://appleid.apple.com',
    aud:provider==='google'?'google-client':'apple-client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...extra})
    .setProtectedHeader({alg:'RS256',kid:provider}).sign(provider==='google'?signing:appleSigning);
}
function mockExchange(token:string) {
  return vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
    const url=String(input);
    if(url.includes('/certs'))return Response.json({keys:[jwk]});
    if(url.includes('/auth/keys'))return Response.json({keys:[appleJwk]});
    if(url.includes('/token'))return Response.json({id_token:token});
    throw new Error(`Unexpected request ${url}`);
  });
}
async function login(provider:string,sub:string) {
  const flow=await start(provider);mockExchange(await signed(provider,flow.nonce,sub));
  const response=provider==='google'?await call(`/callback/google?code=example&state=${flow.state}`,'GET',undefined,flow.cookie)
    :await call('/callback/apple','POST',`code=example&state=${flow.state}`,flow.cookie,{'Content-Type':'application/x-www-form-urlencoded'});
  expect(response.headers.get('Location')).toBe('/?account=1');
  vi.restoreAllMocks();return cookieFrom(response,'__Host-plunge-session');
}
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  const db=await mf.getD1Database('QUESTIONS');
  const sql=await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8');
  const [tables,trigger]=sql.split('CREATE TRIGGER');for(const statement of tables!.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for(const statement of (await readFile(new URL('../migrations/0003_accounts.sql',import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  const google=await generateKeyPair('RS256',{extractable:true}),apple=await generateKeyPair('RS256',{extractable:true}),secret=await generateKeyPair('ES256',{extractable:true});
  signing=google.privateKey;appleSigning=apple.privateKey;jwk={...await exportJWK(google.publicKey),kid:'google',alg:'RS256'};appleJwk={...await exportJWK(apple.publicKey),kid:'apple',alg:'RS256'};
  env={QUESTIONS:db,IDEAS_ADMIN_TOKEN:admin,ASSETS:{fetch:async()=>new Response('Game works')},GOOGLE_CLIENT_ID:'google-client',GOOGLE_CLIENT_SECRET:'test-secret',APPLE_CLIENT_ID:'apple-client',APPLE_TEAM_ID:'team',APPLE_KEY_ID:'key',APPLE_PRIVATE_KEY:await exportPKCS8(secret.privateKey)};
},20000);
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await mf?.dispose();});
it('keeps ordinary play anonymous and auth off on previews',async()=>{
  expect(await (await worker.fetch(new Request(`${origin}/`),env)).text()).toBe('Game works');
  const anonymous=await (await call()).json() as {account:unknown;providers:unknown};expect(anonymous.account).toBeNull();expect(anonymous.providers).toEqual({apple:true,google:true});
  expect(await (await worker.fetch(new Request('https://plunge-pr-25.texas42.workers.dev/api/account'),env)).json()).toMatchObject({available:false});
  expect((await worker.fetch(new Request(`${origin}/api/account/start/google`,{method:'POST'}),{ASSETS:env.ASSETS})).status).toBe(503);
});
it('binds state to the browser, uses Google PKCE, and rejects replay',async()=>{
  expect((await call('/start/google','POST',undefined,'',{Origin:'https://evil.test'})).status).toBe(403);
  const flow=await start();expect(flow.target.searchParams.get('code_challenge_method')).toBe('S256');expect(flow.target.searchParams.get('code_challenge')).toHaveLength(43);
  mockExchange(await signed('google',flow.nonce));
  const wrong=await call(`/callback/google?code=example&state=${flow.state}`);expect(wrong.headers.get('Location')).toContain('retry');
  const response=await call(`/callback/google?code=example&state=${flow.state}`,'GET',undefined,flow.cookie);
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  momCookie=cookieFrom(response,'__Host-plunge-session');
  expect((await call(`/callback/google?code=example&state=${flow.state}`,'GET',undefined,flow.cookie)).headers.get('Location')).toContain('retry');
  const {account}=await (await call('','GET',undefined,momCookie)).json() as {account:{id:string;owner:number;family:number}};momId=account.id;expect(account.owner).toBe(0);expect(account.family).toBe(0);
});
it('does not grant family access merely for signing in or reusing an email',async()=>{
  expect((await idea(momCookie)).status).toBe(403);
  dadCookie=await login('apple','dad');
  const {account}=await (await call('','GET',undefined,dadCookie)).json() as {account:{id:string;owner:number;family:number}};dadId=account.id;
  expect(dadId).not.toBe(momId);expect(account.owner).toBe(0);expect(account.family).toBe(0);
  const again=await login('google','mom');expect((await (await call('','GET',undefined,again)).json() as {account:{id:string}}).account.id).toBe(momId);
});
it('rejects wrong audience, nonce, issuer, expiry, and forged signatures',async()=>{
  for(const extra of [{aud:'wrong'},{azp:'wrong'},{nonce:'wrong'},{iss:'https://evil.test'},{exp:1}]) {
    const flow=await start();mockExchange(await signed('google',flow.nonce,'attacker',extra));
    const response=await call(`/callback/google?code=bad&state=${flow.state}`,'GET',undefined,flow.cookie);expect(response.headers.get('Location')).toContain('retry');expect(response.headers.get('Set-Cookie')).not.toContain('__Host-plunge-session');vi.restoreAllMocks();
  }
  const flow=await start();const token=await signed('google',flow.nonce);const parts=token.split('.');parts[2]=(parts[2]![0]==='a'?'b':'a')+parts[2]!.slice(1);mockExchange(parts.join('.'));
  expect((await call(`/callback/google?code=bad&state=${flow.state}`,'GET',undefined,flow.cookie)).headers.get('Location')).toContain('retry');
});
it('expires abandoned transactions and handles cancellation without creating a session',async()=>{
  const flow=await start('apple');expect(flow.target.searchParams.get('response_mode')).toBe('form_post');
  const response=await call('/callback/apple','POST',`error=access_denied&state=${flow.state}`,flow.cookie);expect(response.headers.get('Location')).toContain('cancelled');
  const old=await start();await env.QUESTIONS!.prepare('UPDATE account_logins SET expires=0').run();
  expect((await call(`/callback/google?code=bad&state=${old.state}`,'GET',undefined,old.cookie)).headers.get('Location')).toContain('retry');
});
it('lets Jason grant and revoke access without changing identity or losing conversations',async()=>{
  expect((await call('/owner','POST',{id:momId},momCookie)).status).toBe(403);
  expect((await call('/grant','POST',{id:dadId,enabled:true},momCookie)).status).toBe(403);
  await call('/request','POST',{},dadCookie);expect((await call('/members','GET',undefined,dadCookie)).status).toBe(403);
  expect((await call('/owner','POST',{id:momId},'',{Authorization:`Bearer ${admin}`})).status).toBe(200);
  expect((await call('/members','GET',undefined,momCookie)).status).toBe(200);
  expect((await call('/grant','POST',{id:dadId,enabled:true},momCookie,{Origin:'https://evil.test'})).status).toBe(403);
  expect((await call('/grant','POST',{id:dadId,enabled:true},momCookie)).status).toBe(200);
  const member=await (await idea(dadCookie)).json();expect(member).toMatchObject({id:dadId,name:'dad'});
  const ideaId='b'.repeat(32);
  const create=await worker.fetch(new Request(`${origin}/api/ideas/${ideaId}`,{method:'PUT',headers:{Cookie:dadCookie,Origin:origin},body:JSON.stringify({body:'Make my bid visible',context:'Phone'})}),env);expect(create.status).toBe(200);
  await call('/grant','POST',{id:dadId,enabled:false},momCookie);expect((await idea(dadCookie)).status).toBe(403);
  await call('/grant','POST',{id:dadId,enabled:true},momCookie);expect((await idea(dadCookie)).status).toBe(200);
  expect(await env.QUESTIONS!.prepare('SELECT member_id FROM ideas WHERE id=?').bind(ideaId).first()).toEqual({member_id:dadId});
  expect((await idea(dadCookie,'PUT',{Origin:''})).status).toBe(403);
});
it('saves a family name, keeps grants private, and rejects expired or logged-out sessions',async()=>{
  await call('/profile','POST',{name:'Dad'},dadCookie);expect(await (await idea(dadCookie)).json()).toMatchObject({name:'Dad'});
  expect(JSON.stringify(await (await call('','GET',undefined,dadCookie)).json())).not.toContain('test-secret');
  await call('/logout','POST',{},dadCookie);expect((await (await call('','GET',undefined,dadCookie)).json() as {account:unknown}).account).toBeNull();
  await env.QUESTIONS!.prepare('UPDATE account_sessions SET expires=0 WHERE hash=?').bind(await hashToken(momCookie.split('=')[1]!)).run();
  expect((await (await call('','GET',undefined,momCookie)).json() as {account:unknown}).account).toBeNull();
});
