import { beforeAll, afterAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { isoCBOR, isoBase64URL } from '@simplewebauthn/server/helpers';
import worker from '../worker/index';
import { hashToken } from '../worker/accounts';
let mf:Miniflare,env:Parameters<typeof worker.fetch>[1];
const origin='https://plunge.texas42.workers.dev',admin='a'.repeat(64);
const encode=(v:Uint8Array<ArrayBuffer>)=>isoBase64URL.fromBuffer(v),decode=(v:string)=>isoBase64URL.toBuffer(v);
const bytes=(s:string)=>new TextEncoder().encode(s);
const sha=async(v:Uint8Array<ArrayBuffer>)=>new Uint8Array(await crypto.subtle.digest('SHA-256',v));
const join=(...values:Uint8Array[])=>{const out=new Uint8Array(values.reduce((n,v)=>n+v.length,0));let off=0;for(const v of values){out.set(v,off);off+=v.length;}return out;};
const call=(path='',method='GET',body?:unknown,cookie='',extra:Record<string,string>={})=>worker.fetch(new Request(`${origin}/api/account${path}`,{method,headers:{Origin:origin,Cookie:cookie,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
const idea=(cookie:string,method='GET',extra:Record<string,string>={})=>worker.fetch(new Request(`${origin}/api/ideas/me`,{method,headers:{Cookie:cookie,Origin:origin,...extra}}),env);
function cookieFrom(response:Response,name:string) {return `${name}=${response.headers.get('Set-Cookie')?.match(new RegExp(`${name}=([^;, ]+)`))?.[1]??''}`;}
async function authenticator() {
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
  const id=crypto.getRandomValues(new Uint8Array(24));
  const cose=isoCBOR.encode(new Map<number,Parameters<typeof isoCBOR.encode>[0]>([[1,2],[3,-7],[-1,1],[-2,decode(jwk.x!)],[-3,decode(jwk.y!)]]));
  return {keys,id,cose,handle:''};
}
type Authenticator=Awaited<ReturnType<typeof authenticator>>;
async function start(kind:string,cookie='',data:unknown={}) {
  const response=await call(`/passkey/${kind}/options`,'POST',data,cookie);expect(response.status).toBe(200);
  return {options:await response.json() as {challenge:string;user?:{id:string};rp?:{id:string};authenticatorSelection?:unknown},cookie:cookieFrom(response,'__Host-plunge-passkey')};
}
async function registration(key:Authenticator,challenge:string,responseOrigin=origin,flags=0x45,rp='plunge.texas42.workers.dev') {
  const clientDataJSON=encode(bytes(JSON.stringify({type:'webauthn.create',challenge,origin:responseOrigin,crossOrigin:false})));
  const authData=join(await sha(bytes(rp)),new Uint8Array([flags,0,0,0,0]),new Uint8Array(16),new Uint8Array([0,key.id.length]),key.id,key.cose);
  return {id:encode(key.id),rawId:encode(key.id),type:'public-key',response:{clientDataJSON,attestationObject:encode(isoCBOR.encode(new Map<string,Parameters<typeof isoCBOR.encode>[0]>([['fmt','none'],['attStmt',new Map()],['authData',authData]])))},clientExtensionResults:{credProps:{rk:true}}};
}
async function register(name:string) {
  const key=await authenticator(),flow=await start('register','',{name});key.handle=flow.options.user!.id;
  const response=await call('/passkey/register/finish','POST',{response:await registration(key,flow.options.challenge)},flow.cookie);
  expect(response.status).toBe(200);const cookie=cookieFrom(response,'__Host-plunge-session');
  const {account}=await (await call('','GET',undefined,cookie)).json() as {account:{id:string;owner:number;family:number}};
  return {key,cookie,id:account.id};
}
function der(raw:Uint8Array) {
  const integer=(v:Uint8Array<ArrayBuffer>)=>{let i=0;while(i<v.length-1&&v[i]===0)i++;let value=v.slice(i);if(value[0]!&0x80)value=join(new Uint8Array([0]),value);return join(new Uint8Array([2,value.length]),value);};
  const pair=join(integer(raw.slice(0,32)),integer(raw.slice(32)));return join(new Uint8Array([48,pair.length]),pair);
}
async function assertion(key:Authenticator,challenge:string,counter=1,responseOrigin=origin,flags=5,rp='plunge.texas42.workers.dev') {
  const client=bytes(JSON.stringify({type:'webauthn.get',challenge,origin:responseOrigin,crossOrigin:false}));
  const count=new Uint8Array(4);new DataView(count.buffer).setUint32(0,counter);
  const auth=join(await sha(bytes(rp)),new Uint8Array([flags]),count);
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.keys.privateKey,join(auth,await sha(client))));
  return {id:encode(key.id),rawId:encode(key.id),type:'public-key',response:{clientDataJSON:encode(client),authenticatorData:encode(auth),signature:encode(der(signature)),userHandle:key.handle},clientExtensionResults:{}};
}
let mom:Awaited<ReturnType<typeof register>>,dad:Awaited<ReturnType<typeof register>>;
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['QUESTIONS']});
  const db=await mf.getD1Database('QUESTIONS');
  const sql=await readFile(new URL('../migrations/0002_family_ideas.sql',import.meta.url),'utf8');
  const [tables,trigger]=sql.split('CREATE TRIGGER');for(const statement of tables!.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for(const statement of (await readFile(new URL('../migrations/0003_accounts.sql',import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  for(const statement of (await readFile(new URL('../migrations/0004_idea_authorizations.sql',import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  env={QUESTIONS:db,IDEAS_ADMIN_TOKEN:admin,ASSETS:{fetch:async()=>new Response('Game works')}};
},20000);
afterAll(async()=>{await mf?.dispose();});
it('keeps ordinary play anonymous and passkey registration off on previews',async()=>{
  expect(await (await worker.fetch(new Request(`${origin}/`),env)).text()).toBe('Game works');
  expect(await (await call()).json()).toEqual({account:null,available:true});
  expect(await (await worker.fetch(new Request('https://plunge-pr-25.texas42.workers.dev/api/account'),env)).json()).toMatchObject({available:false});
  expect((await worker.fetch(new Request(`${origin}/api/account/passkey/register/options`,{method:'POST'}),{ASSETS:env.ASSETS})).status).toBe(503);
});
it('creates optional discoverable accounts without granting family or owner access',async()=>{
  expect((await call('/passkey/register/options','POST',{name:'Mom'},'',{Origin:'https://evil.test'})).status).toBe(403);
  mom=await register('Mom');dad=await register('Dad');
  expect(mom.id).not.toBe(dad.id);expect((await idea(mom.cookie)).status).toBe(403);
  expect((await (await call('','GET',undefined,mom.cookie)).json() as {account:unknown}).account).toMatchObject({owner:0,family:0});
});
it('binds single-use challenges to the initiating browser and expires them',async()=>{
  const key=await authenticator(),flow=await start('register','',{name:'Cousin'}),proof=await registration(key,flow.options.challenge);
  expect(flow.options.authenticatorSelection).toMatchObject({residentKey:'required',userVerification:'required'});
  expect((await call('/passkey/register/finish','POST',{response:proof})).status).toBe(401);
  expect((await call('/passkey/register/finish','POST',{response:proof},flow.cookie)).status).toBe(200);
  expect((await call('/passkey/register/finish','POST',{response:proof},flow.cookie)).status).toBe(401);
  const expired=await start('login');await env.QUESTIONS!.prepare('UPDATE account_ceremonies SET expires=0').run();
  expect((await call('/passkey/login/finish','POST',{response:{}},expired.cookie)).status).toBe(401);
});
it('rejects wrong origin, RP, challenge and missing user verification at enrollment',async()=>{
  for(const variant of ['origin','rp','challenge','uv']) {
    const flow=await start('register','',{name:'Wrong'}),key=await authenticator();
    const proof=await registration(key,variant==='challenge'?'wrong':flow.options.challenge,variant==='origin'?'https://evil.test':origin,variant==='uv'?0x41:0x45,variant==='rp'?'evil.test':'plunge.texas42.workers.dev');
    expect((await call('/passkey/register/finish','POST',{response:proof},flow.cookie)).status).toBe(401);
  }
});
it('verifies real passkey signatures, handles and counters when signing in',async()=>{
  const flow=await start('login'),proof=await assertion(mom.key,flow.options.challenge);
  const response=await call('/passkey/login/finish','POST',{response:proof},flow.cookie);expect(response.status).toBe(200);
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  mom.cookie=cookieFrom(response,'__Host-plunge-session');
  expect((await (await call('','GET',undefined,mom.cookie)).json() as {account:{id:string}}).account.id).toBe(mom.id);
  for(const variant of ['signature','handle','origin','rp','challenge','uv','counter']) {
    const pending=await start('login');
    const value=await assertion(mom.key,variant==='challenge'?'wrong':pending.options.challenge,variant==='counter'?1:2,variant==='origin'?'https://evil.test':origin,variant==='uv'?1:5,variant==='rp'?'evil.test':'plunge.texas42.workers.dev');
    if(variant==='signature')value.response.signature=encode(new Uint8Array(64));
    if(variant==='handle')value.response.userHandle=dad.key.handle;
    expect((await call('/passkey/login/finish','POST',{response:value},pending.cookie)).status).toBe(401);
  }
});
it('keeps family grants explicit and prevents privilege escalation or cross-site writes',async()=>{
  expect((await call('/owner','POST',{id:mom.id},mom.cookie)).status).toBe(403);
  expect((await call('/grant','POST',{id:dad.id,enabled:true},mom.cookie)).status).toBe(403);
  await call('/request','POST',{},dad.cookie);expect((await call('/members','GET',undefined,dad.cookie)).status).toBe(403);
  expect((await call('/owner','POST',{id:mom.id},'',{Authorization:`Bearer ${admin}`})).status).toBe(200);
  expect((await call('/grant','POST',{id:dad.id,enabled:true},mom.cookie,{Origin:'https://evil.test'})).status).toBe(403);
  expect((await call('/grant','POST',{id:dad.id,enabled:true},mom.cookie)).status).toBe(200);
  expect(await (await idea(dad.cookie)).json()).toMatchObject({id:dad.id,name:'Dad'});
  await call('/grant','POST',{id:dad.id,enabled:false},mom.cookie);expect((await idea(dad.cookie)).status).toBe(403);
  await call('/grant','POST',{id:dad.id,enabled:true},mom.cookie);expect((await idea(dad.cookie)).status).toBe(200);
  expect((await idea(dad.cookie,'PUT',{Origin:''})).status).toBe(403);
});
it('adds a second passkey only to the signed-in account',async()=>{
  expect((await call('/passkey/add/options','POST',{})).status).toBe(401);
  const flow=await start('add',dad.cookie),key=await authenticator();key.handle=flow.options.user!.id;
  const result=await call('/passkey/add/finish','POST',{response:await registration(key,flow.options.challenge)},`${flow.cookie}; ${dad.cookie}`);
  expect(result.status).toBe(200);dad.cookie=cookieFrom(result,'__Host-plunge-session');
  expect(await env.QUESTIONS!.prepare('SELECT COUNT(*) n FROM account_passkeys WHERE account_id=?').bind(dad.id).first()).toEqual({n:2});
  const switched=await start('add',dad.cookie),other=await authenticator();
  expect((await call('/passkey/add/finish','POST',{response:await registration(other,switched.options.challenge)},`${switched.cookie}; ${mom.cookie}`)).status).toBe(401);
});
it('recovers the same account once, preserves family grants, and invalidates old keys and sessions',async()=>{
  expect((await call('/recovery','POST',{id:mom.id},dad.cookie)).status).toBe(403);
  expect((await call('/recovery','POST',{id:mom.id},mom.cookie)).status).toBe(403);
  const recovery=await (await call('/recovery','POST',{id:dad.id},mom.cookie)).json() as {url:string};
  const token=new URLSearchParams(new URL(recovery.url).hash.slice(1)).get('recover')!;
  const first=await start('recover','',{token}),second=await start('recover','',{token});
  const replacement=await authenticator();replacement.handle=first.options.user!.id;
  const response=await call('/passkey/recover/finish','POST',{response:await registration(replacement,first.options.challenge)},first.cookie);expect(response.status).toBe(200);
  const recoveredCookie=cookieFrom(response,'__Host-plunge-session');
  expect(await (await idea(recoveredCookie)).json()).toMatchObject({id:dad.id,name:'Dad'});
  expect((await (await call('','GET',undefined,dad.cookie)).json() as {account:unknown}).account).toBeNull();
  expect(await env.QUESTIONS!.prepare('SELECT COUNT(*) n FROM account_passkeys WHERE account_id=?').bind(dad.id).first()).toEqual({n:1});
  const old=await start('login');expect((await call('/passkey/login/finish','POST',{response:await assertion(dad.key,old.options.challenge)},old.cookie)).status).toBe(401);
  const competitor=await authenticator();expect((await call('/passkey/recover/finish','POST',{response:await registration(competitor,second.options.challenge)},second.cookie)).status).toBe(401);
  expect((await call('/passkey/recover/options','POST',{token})).status).toBe(401);
  dad.cookie=recoveredCookie;dad.key=replacement;
});
it('expires recovery links, permits private owner recovery, and revokes sessions on logout',async()=>{
  expect((await call('/recovery','POST',{id:mom.id},'',{Authorization:`Bearer ${admin}`})).status).toBe(200);
  const recovery=await (await call('/recovery','POST',{id:dad.id},mom.cookie)).json() as {url:string};
  await env.QUESTIONS!.prepare('UPDATE account_recoveries SET expires=0').run();
  expect((await call('/passkey/recover/options','POST',{token:new URLSearchParams(new URL(recovery.url).hash.slice(1)).get('recover')})).status).toBe(401);
  await call('/profile','POST',{name:'Dad the tinkerer'},dad.cookie);expect(await (await idea(dad.cookie)).json()).toMatchObject({name:'Dad the tinkerer'});
  await call('/logout','POST',{},dad.cookie);expect((await (await call('','GET',undefined,dad.cookie)).json() as {account:unknown}).account).toBeNull();
  await env.QUESTIONS!.prepare('UPDATE account_sessions SET expires=0 WHERE hash=?').bind(await hashToken(mom.cookie.split('=')[1]!)).run();
  expect((await (await call('','GET',undefined,mom.cookie)).json() as {account:unknown}).account).toBeNull();
});
