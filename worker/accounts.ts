import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { IdeasDatabase } from './ideas';
export interface AccountEnv { QUESTIONS?: IdeasDatabase; IDEAS_ADMIN_TOKEN?: string }
export interface Account {id:string;name:string;owner:number;requested:number;member_id:string|null;family:number}
interface Ceremony {kind:'register'|'login'|'add'|'recover';challenge:string;account_id:string|null;name:string|null;recovery_hash:string|null}
interface Passkey {id:string;account_id:string;public_key:string;counter:number}
const ORIGIN='https://plunge.texas42.workers.dev', RP_ID='plunge.texas42.workers.dev';
const SESSION='__Host-plunge-session', CEREMONY='__Host-plunge-passkey';
const HEX=/^[a-f0-9]{64}$/;
/** A recovery link lasts fifteen minutes; an invite waits a week for someone to get to it. */
const RECOVERY_MS=900000, INVITE_MS=7*86400000, MAX_WAITING_INVITES=10, FAMILY_LINK_MS=7*86400000, MAX_LINK_REQUESTS=30;
const familyAccess=(account:Account|null)=>!!account&&(!!account.family||!!account.owner);
const cleanName=(value:unknown)=>typeof value==='string'&&value.trim()&&value.length<=40?value.trim():null;
export const hashToken=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const cookie=(name:string,value:string,seconds:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
function readCookie(request:Request,name:string):string {return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)??'';}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const columns=`SELECT a.id,a.name,a.owner,a.requested,a.member_id,CASE WHEN m.revoked=0 THEN 1 ELSE 0 END family
  FROM accounts a LEFT JOIN idea_members m ON m.id=a.member_id`;
export async function accountSession(request:Request,env:AccountEnv):Promise<Account|null> {
  const token=readCookie(request,SESSION);
  if(!env.QUESTIONS || !HEX.test(token))return null;
  return env.QUESTIONS.prepare(`${columns} JOIN account_sessions s ON s.account_id=a.id WHERE s.hash=? AND s.expires>?`)
    .bind(await hashToken(token),Date.now()).first<Account>();
}
async function body(request:Request):Promise<Record<string,unknown>> {
  const reader=request.body?.getReader();const decoder=new TextDecoder();let result='',size=0;
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32000){await reader.cancel();throw new SyntaxError('Too large.');}result+=decoder.decode(part.value,{stream:true});}
  const data:unknown=JSON.parse(result+decoder.decode()||'{}');
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SyntaxError('Invalid request.');
  return data as Record<string,unknown>;
}
function jsonWithCookie(value:unknown,valueCookie:string){const response=json(value);response.headers.append('Set-Cookie',valueCookie);return response;}
/** Store a one-use link secret for an account, replacing any earlier one. */
async function linkSecret(db:IdeasDatabase,id:string,lifetime:number):Promise<string> {
  const token=random();
  await db.prepare('INSERT INTO account_recoveries(hash,account_id,expires) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET hash=excluded.hash,expires=excluded.expires')
    .bind(await hashToken(token),id,Date.now()+lifetime).run();
  return token;
}
async function liveFamilyLink(db:IdeasDatabase,token:string) {
  return db.prepare('SELECT a.name by_name,l.expires FROM family_links l JOIN accounts a ON a.id=l.created_by WHERE l.hash=? AND l.expires>?')
    .bind(await hashToken(token),Date.now()).first<{by_name:string;expires:number}>();
}
const passkeyCount=`(SELECT COUNT(*) FROM account_passkeys p WHERE p.account_id=a.id)`;
async function signedIn(request:Request,db:IdeasDatabase,id:string,keyId:string) {
  const session=random();
  await db.batch([
    db.prepare('INSERT INTO account_sessions(hash,account_id,expires) SELECT ?,account_id,? FROM account_passkeys WHERE id=? AND account_id=?').bind(await hashToken(session),Date.now()+30*86400000,keyId,id),
    db.prepare('DELETE FROM account_sessions WHERE hash=? OR expires<?').bind(await hashToken(readCookie(request,SESSION)),Date.now()),
  ]);
  if(!await db.prepare('SELECT hash FROM account_sessions WHERE hash=?').bind(await hashToken(session)).first())throw new Error('Passkey was removed.');
  const response=jsonWithCookie({ok:true},cookie(SESSION,session,30*86400));
  response.headers.append('Set-Cookie',cookie(CEREMONY,'',0));return response;
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
  // RP identity is fixed to the stable install. PR workers never bind account storage.
  if(!db || url.origin!==ORIGIN)return path===''?json({account:null,available:false}):json({error:'Open the main Plunge app to sign in.'},503);
  try {
    const account=await accountSession(request,env);
    // The owner also hears how many people are waiting to be let in.
    if(path===''&&request.method==='GET')return json({account,available:true,...(account?.owner?{waiting:(await db.prepare('SELECT COUNT(*) n FROM accounts WHERE requested=1').first<{n:number}>())?.n??0}:{})});
    const bearer=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
    const admin=!!env.IDEAS_ADMIN_TOKEN&&HEX.test(bearer)&&await hashToken(bearer)===await hashToken(env.IDEAS_ADMIN_TOKEN);
    if(request.method==='POST'&&!admin&&request.headers.get('Origin')!==ORIGIN)return json({error:'Please use the main Plunge app.'},403);
    const data=request.method==='POST'?await body(request):{};
    const options=/^\/passkey\/(register|login|add|recover)\/options$/.exec(path);
    if(options&&request.method==='POST') {
      const kind=options[1] as Ceremony['kind'];
      if(kind==='add'&&!account)return json({error:'Sign in before adding another passkey.'},401);
      if(kind==='register'&&account)return json({error:'You already have an account. Add a passkey instead.'},409);
      let accountId=kind==='register'?random().slice(0,32):account?.id??null;
      let name=account?.name??'',recoveryHash:string|null=null;
      if(kind==='register') {
        const chosen=cleanName(data.name);if(!chosen)return json({error:'Choose a name of 1 to 40 characters.'},400);
        name=chosen;
        // Through the family link: the account becomes a request the owner answers.
        if(data.family!==undefined) {
          if(typeof data.family!=='string'||!HEX.test(data.family)||!await liveFamilyLink(db,data.family))return json({error:'That family link has been turned off or expired. Ask Jason for the new one.'},401);
          const open=await db.prepare('SELECT COUNT(*) n FROM accounts WHERE requested=1').first<{n:number}>();
          if((open?.n??0)>=MAX_LINK_REQUESTS)return json({error:'Lots of people are waiting to be let in. Please try again tomorrow.'},429);
          recoveryHash=await hashToken(data.family);
        }
      }
      if(kind==='recover') {
        if(typeof data.token!=='string'||!HEX.test(data.token))return json({error:'That link is incomplete. Ask whoever sent it for a new one.'},401);
        recoveryHash=await hashToken(data.token);
        const recover=await db.prepare('SELECT a.id,a.name FROM accounts a JOIN account_recoveries r ON r.account_id=a.id WHERE r.hash=? AND r.expires>?')
          .bind(recoveryHash,Date.now()).first<{id:string;name:string}>();
        if(!recover)return json({error:'That link has expired or was already used. Ask whoever sent it for a new one.'},401);
        accountId=recover.id;name=recover.name;
      }
      const credentials=kind==='add'?(await db.prepare('SELECT id FROM account_passkeys WHERE account_id=?').bind(accountId).all<{id:string}>()).results:[];
      if(credentials.length>=10)return json({error:'You already have ten passkeys. Ask Jason for help before adding more.'},409);
      const result=kind==='login'?await generateAuthenticationOptions({rpID:RP_ID,userVerification:'required'}):await generateRegistrationOptions({
        rpName:'Plunge',rpID:RP_ID,userID:new TextEncoder().encode(accountId!),userName:name,userDisplayName:name,
        attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},
        supportedAlgorithmIDs:[-7,-257],excludeCredentials:credentials,
      });
      const token=random();
      await db.batch([
        db.prepare('DELETE FROM account_ceremonies WHERE expires<? OR hash=?').bind(Date.now(),await hashToken(readCookie(request,CEREMONY))),
        db.prepare('INSERT INTO account_ceremonies(hash,kind,challenge,account_id,name,recovery_hash,expires) VALUES(?,?,?,?,?,?,?)')
          .bind(await hashToken(token),kind,result.challenge,accountId,name,recoveryHash,Date.now()+300000),
      ]);
      return jsonWithCookie(result,cookie(CEREMONY,token,300));
    }
    const finish=/^\/passkey\/(register|login|add|recover)\/finish$/.exec(path);
    if(finish&&request.method==='POST') {
      const token=readCookie(request,CEREMONY);
      if(!HEX.test(token))return json({error:'Please start sign-in again.'},401);
      const pending=await db.prepare('DELETE FROM account_ceremonies WHERE hash=? AND kind=? AND expires>? RETURNING *')
        .bind(await hashToken(token),finish[1],Date.now()).first<Ceremony>();
      if(!pending)return json({error:'This sign-in expired. Please try again.'},401);
      try {
        if(pending.kind==='login') {
          const response=data.response as AuthenticationResponseJSON;
          if(!response||typeof response.id!=='string')throw new Error('Missing credential.');
          const key=await db.prepare('SELECT * FROM account_passkeys WHERE id=?').bind(response.id).first<Passkey>();
          if(!key || response.response.userHandle!==encode(new TextEncoder().encode(key.account_id)))throw new Error('Unknown account.');
          const result=await verifyAuthenticationResponse({response,expectedChallenge:pending.challenge,expectedOrigin:ORIGIN,expectedRPID:RP_ID,
            credential:{id:key.id,publicKey:decode(key.public_key),counter:key.counter},requireUserVerification:true});
          if(!result.verified)throw new Error('Not verified.');
          const updated=await db.prepare('UPDATE account_passkeys SET counter=? WHERE id=? AND counter=? RETURNING id')
            .bind(result.authenticationInfo.newCounter,key.id,key.counter).first();
          if(!updated)throw new Error('Credential changed.');
          return await signedIn(request,db,key.account_id,key.id);
        }
        if(pending.kind==='add'&&(!account||account.id!==pending.account_id))throw new Error('Account changed.');
        const result=await verifyRegistrationResponse({response:data.response as RegistrationResponseJSON,expectedChallenge:pending.challenge,
          expectedOrigin:ORIGIN,expectedRPID:RP_ID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
        if(!result.verified)throw new Error('Not verified.');
        const key=result.registrationInfo.credential;
        const changes=[];
        if(pending.kind==='register') {
          // A register ceremony carrying a family link's hash joins as a request, if the link is still on.
          const link=pending.recovery_hash?await db.prepare('SELECT created_by FROM family_links WHERE hash=? AND expires>?').bind(pending.recovery_hash,Date.now()).first<{created_by:string}>():null;
          if(pending.recovery_hash&&!link)throw new Error('Family link turned off.');
          changes.push(link
            ?db.prepare('INSERT INTO accounts(id,name,created,requested,invited_by,via_link) VALUES(?,?,?,1,?,1)').bind(pending.account_id,pending.name,Date.now(),link.created_by)
            :db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(pending.account_id,pending.name,Date.now()));
        }
        if(pending.kind==='recover') {
          // Consume only after the new passkey verifies. Only one concurrent recovery can win.
          const recovered=await db.prepare('DELETE FROM account_recoveries WHERE hash=? AND account_id=? AND expires>? RETURNING account_id')
            .bind(pending.recovery_hash,pending.account_id,Date.now()).first();
          if(!recovered)throw new Error('Recovery expired or already used.');
          changes.push(db.prepare('DELETE FROM account_passkeys WHERE account_id=?').bind(pending.account_id),
            db.prepare('DELETE FROM account_sessions WHERE account_id=?').bind(pending.account_id));
        }
        changes.push(pending.kind==='add'
          ? db.prepare('INSERT INTO account_passkeys(id,account_id,public_key,counter,created) SELECT ?,account_id,?,?,? FROM account_sessions WHERE hash=? AND account_id=? AND expires>?')
            .bind(key.id,encode(key.publicKey),key.counter,Date.now(),await hashToken(readCookie(request,SESSION)),pending.account_id,Date.now())
          : db.prepare('INSERT INTO account_passkeys(id,account_id,public_key,counter,created) VALUES(?,?,?,?,?)')
            .bind(key.id,pending.account_id,encode(key.publicKey),key.counter,Date.now()));
        await db.batch(changes);
        return await signedIn(request,db,pending.account_id!,key.id);
      } catch {return json({error:'The passkey could not be verified. Please try again, or ask Jason for help.'},401);}
    }
    if(path==='/members'&&request.method==='GET') {
      if(!admin&&!account?.owner)return json({error:'Only Jason can manage family access.'},403);
      return json({members:(await db.prepare(`SELECT a.id,a.name,a.owner,a.requested,CASE WHEN m.revoked=0 THEN 1 ELSE 0 END family,
          ${passkeyCount}>0 joined,i.name invited_by,a.created,a.via_link
        FROM accounts a LEFT JOIN idea_members m ON m.id=a.member_id LEFT JOIN accounts i ON i.id=a.invited_by
        ORDER BY a.created DESC LIMIT 200`).all()).results});
    }
    if(path==='/family-link'&&request.method==='GET') {
      if(!account?.owner)return json({error:'Only Jason can manage the family link.'},403);
      return json({expires:(await db.prepare('SELECT expires FROM family_links WHERE expires>? ORDER BY expires DESC LIMIT 1').bind(Date.now()).first<{expires:number}>())?.expires??null});
    }
    // Anyone with family access can see the invites they sent and whether each was used.
    if(path==='/invites'&&request.method==='GET') {
      if(!familyAccess(account))return json({invites:[]});
      return json({invites:(await db.prepare(`SELECT a.id,a.name,${passkeyCount}>0 joined FROM accounts a WHERE a.invited_by=? AND a.via_link=0 ORDER BY a.created DESC LIMIT 50`)
        .bind(account!.id).all()).results});
    }
    // Whose family link this is, so its page can say so before anyone signs up.
    if(path==='/family-link/peek'&&request.method==='POST') {
      const link=typeof data.token==='string'&&HEX.test(data.token)?await liveFamilyLink(db,data.token):null;
      if(!link)return json({error:'That family link has been turned off or expired. Ask Jason for the new one.'},404);
      return json({by:link.by_name,expires:link.expires});
    }
    // What an invite link is for, without using it: the welcome page greets the person by name.
    if(path==='/invite/peek'&&request.method==='POST') {
      if(typeof data.token!=='string'||!HEX.test(data.token))return json({error:'That invite link is incomplete.'},400);
      const invite=await db.prepare(`SELECT a.id,a.name,i.name invited_by,${passkeyCount}>0 joined FROM accounts a
          JOIN account_recoveries r ON r.account_id=a.id LEFT JOIN accounts i ON i.id=a.invited_by WHERE r.hash=? AND r.expires>?`)
        .bind(await hashToken(data.token),Date.now()).first<{id:string;name:string;invited_by:string|null;joined:number}>();
      if(!invite)return json({error:'That link has expired or was already used. Ask whoever sent it for a new one.'},404);
      return json({name:invite.name,invitedBy:invite.invited_by,joined:!!invite.joined,you:account?.id===invite.id});
    }
    if(request.method!=='POST')return json({error:'Not found.'},404);
    if(path==='/logout') {
      await db.prepare('DELETE FROM account_sessions WHERE hash=?').bind(await hashToken(readCookie(request,SESSION))).run();
      return jsonWithCookie({ok:true},cookie(SESSION,'',0));
    }
    if(!account&&!admin)return json({error:'Please sign in first.'},401);
    if(path==='/profile'&&account) {
      const chosen=cleanName(data.name);if(!chosen)return json({error:'Use a name of 1 to 40 characters.'},400);
      await db.batch([db.prepare('UPDATE accounts SET name=? WHERE id=?').bind(chosen,account.id),db.prepare('UPDATE idea_members SET name=? WHERE id=?').bind(chosen,account.member_id)]);
      return json({ok:true});
    }
    if(path==='/request'&&account) {await db.prepare('UPDATE accounts SET requested=1 WHERE id=?').bind(account.id).run();return json({ok:true});}
    // Already signed in when the invite arrives: the seat joins the account they have, and the
    // placeholder it was saved under goes away. Nobody signs out. Never a real account's link.
    if(path==='/invite/accept'&&account) {
      if(typeof data.token!=='string'||!HEX.test(data.token))return json({error:'That invite link is incomplete.'},400);
      const invite=await db.prepare(`SELECT a.id,a.invited_by,${passkeyCount} keys FROM accounts a JOIN account_recoveries r ON r.account_id=a.id WHERE r.hash=? AND r.expires>? AND a.owner=0`)
        .bind(await hashToken(data.token),Date.now()).first<{id:string;invited_by:string|null;keys:number}>();
      if(!invite)return json({error:'That link has expired or was already used. Ask whoever sent it for a new one.'},404);
      if(invite.keys||invite.id===account.id)return json({error:'That link is for someone else’s account.'},409);
      if(familyAccess(account))return json({error:'You already have a family seat. Send this link to whoever it’s for.'},409);
      await grantFamily(db,account.id,true);
      await db.batch([
        db.prepare('UPDATE accounts SET invited_by=COALESCE(invited_by,?) WHERE id=?').bind(invite.invited_by,account.id),
        db.prepare('DELETE FROM account_recoveries WHERE account_id=?').bind(invite.id),
        db.prepare('DELETE FROM account_ceremonies WHERE account_id=?').bind(invite.id),
        db.prepare('UPDATE idea_members SET revoked=1 WHERE id=(SELECT member_id FROM accounts WHERE id=?)').bind(invite.id),
        db.prepare('DELETE FROM accounts WHERE id=? AND NOT EXISTS (SELECT 1 FROM account_passkeys WHERE account_id=?)').bind(invite.id,invite.id),
      ]);
      return json({ok:true});
    }
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
    // Save a seat: a new account with family access and no passkey yet, and a week-long link to claim it.
    // Sending a new link for an unused invite replaces the old one. Invites never touch an account with a passkey.
    if(path==='/invite'&&(admin||familyAccess(account))) {
      if(data.id!==undefined) {
        if(typeof data.id!=='string'||!/^[a-f0-9]{32}$/.test(data.id))return json({error:'Choose an invite.'},400);
        const target=await db.prepare(`SELECT a.invited_by,${passkeyCount} keys FROM accounts a WHERE a.id=?`).bind(data.id).first<{invited_by:string|null;keys:number}>();
        if(!target||target.invited_by===null||(!admin&&!account?.owner&&target.invited_by!==account?.id))return json({error:'Invite not found.'},404);
        if(target.keys)return json({error:'They already joined. They can sign in with their passkey.'},409);
        return json({id:data.id,url:`${ORIGIN}/?account=1#join=${await linkSecret(db,data.id,INVITE_MS)}`});
      }
      const invitee=cleanName(data.name);if(!invitee)return json({error:'Use a name of 1 to 40 characters.'},400);
      const inviter=account?.id??null;
      if(inviter) {
        const waiting=await db.prepare(`SELECT COUNT(*) n FROM accounts a WHERE a.invited_by=? AND a.via_link=0 AND ${passkeyCount}=0`).bind(inviter).first<{n:number}>();
        if((waiting?.n??0)>=MAX_WAITING_INVITES)return json({error:`You have ${MAX_WAITING_INVITES} invites nobody has used yet. Send one of those again instead.`},409);
      }
      const id=random().slice(0,32);
      await db.prepare('INSERT INTO accounts(id,name,created,invited_by) VALUES(?,?,?,?)').bind(id,invitee,Date.now(),inviter).run();
      await grantFamily(db,id,true);
      return json({id,url:`${ORIGIN}/?account=1#join=${await linkSecret(db,id,INVITE_MS)}`});
    }
    // One shared link at a time. Making a new one turns the old one off; `off` turns it off.
    if(path==='/family-link'&&account?.owner) {
      await db.prepare('DELETE FROM family_links').run();
      if(data.off===true)return json({ok:true});
      const token=random(),expires=Date.now()+FAMILY_LINK_MS;
      await db.prepare('INSERT INTO family_links(hash,created_by,expires) VALUES(?,?,?)').bind(await hashToken(token),account.id,expires).run();
      return json({url:`${ORIGIN}/?account=1#family=${token}`,expires});
    }
    if(path==='/recovery'&&(admin||account?.owner)) {
      if(typeof data.id!=='string'||!/^[a-f0-9]{32}$/.test(data.id))return json({error:'Choose an account.'},400);
      const target=await db.prepare('SELECT owner FROM accounts WHERE id=?').bind(data.id).first<{owner:number}>();
      if(!target)return json({error:'Account not found.'},404);
      // Recovering the owner requires the private admin helper, not a browser session.
      if(target.owner&&!admin)return json({error:'Use the private account helper to recover an owner.'},403);
      return json({url:`${ORIGIN}/?account=1#recover=${await linkSecret(db,data.id,RECOVERY_MS)}`});
    }
    return json({error:'Not allowed.'},403);
  }catch(error){return error instanceof SyntaxError?json({error:'Invalid account request.'},400):json({error:'Accounts are temporarily unavailable. You can still play.'},503);}
}
