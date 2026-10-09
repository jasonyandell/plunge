import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { startRegistration, startAuthentication, browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { TOKEN_KEY } from '../ideas/client';
import { LIVE_PLUNGE } from '../ideas/model';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { syncStats, type StatsStatus } from '../history/stats-sync';
import { familyTable, ROOMS_ENABLED, roomUrl, saveSeat } from '../room/client';
import { rememberMe, tableName } from './me';
import '../ui/app.css';
import '../ui/home.css';
import '../ideas/ideas.css';
import './account.css';
interface Person {id:string;name:string;owner:number;requested:number;family:number;joined?:number;invited_by?:string|null;created?:number;via_link?:number}
interface State {account:Person|null;available:boolean;waiting?:number}
/** Whose family link this is, read before anyone signs up. */
interface FamilyLink {by:string;expires:number}
const day=(ms:number)=>new Date(ms).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
interface Invite {id:string;name:string;joined:number}
/** What an invite link is for, read before anyone uses it. */
interface Seat {name:string;invitedBy:string|null;joined:boolean;you:boolean}
async function liveApi<T>(path='',body?:unknown):Promise<T> {
  const response=await fetch(`/api/account${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Please try again.');return data as T;
}
/** A recovery, invite or family-link secret from the address, removed from view at once and kept only for this visit. */
function secretFromLink(key:'recover'|'join'|'family'):string {
  const hash=new URLSearchParams(location.hash.slice(1)),value=hash.get(key)??'';
  if(value){hash.delete(key);history.replaceState(null,'',location.pathname+location.search+(hash.size?`#${hash}`:''));}
  return /^[a-f0-9]{64}$/.test(value)?value:'';
}
/** An invite pasted inside the installed app: the whole link, or just its secret. */
function inviteFromInput(value:string):string {
  const raw=value.trim();if(/^[a-f0-9]{64}$/.test(raw))return raw;
  try{const token=new URLSearchParams(new URL(raw).hash.slice(1)).get('join')??'';return /^[a-f0-9]{64}$/.test(token)?token:'';}catch{return '';}
}
/** On iPhone a link opens in Safari, which keeps its own storage apart from the home-screen app. */
const standalone=()=>matchMedia?.('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
type Shared='shared'|'copied'|'shown';
async function shareLink(text:string,url:string):Promise<Shared> {
  if(navigator.share){try{await navigator.share({title:'Plunge',text,url});return 'shared';}catch(e){if(e instanceof Error&&e.name==='AbortError')return 'shown';}}
  try{await navigator.clipboard.writeText(`${text} ${url}`);return 'copied';}catch{return 'shown';}
}
/** Everything the account page asks of the outside world. The live backend is the account
 * service and this device; the sample walkthrough swaps in an in-memory one. */
export interface AccountBackend {
  api<T>(path?:string,body?:unknown):Promise<T>;
  register(options:PublicKeyCredentialCreationOptionsJSON):Promise<unknown>;
  authenticate(options:PublicKeyCredentialRequestOptionsJSON):Promise<unknown>;
  supported:boolean; localOnly:boolean;
  stats(account?:string):Promise<StatsStatus>;
  share(text:string,url:string):Promise<Shared>;
  sitDown():Promise<void>;
}
export const liveBackend:AccountBackend={
  api:liveApi,
  register:options=>startRegistration({optionsJSON:options}),
  authenticate:options=>startAuthentication({optionsJSON:options}),
  get supported(){return browserSupportsWebAuthn();},
  localOnly:QUESTIONS_LOCAL_ONLY,
  stats:syncStats,
  share:shareLink,
  sitDown:async()=>{const seat=await familyTable();try{saveSeat(seat,localStorage);}catch{/* The room page opens the seat it was given. */}location.assign(roomUrl(seat.roomId));},
};
/** One link for the family chat: anyone with it can save a seat and ask to come in; the owner lets each person in. */
function FamilyLinkPanel({backend}:{backend:AccountBackend}) {
  const api=backend.api;
  const [expires,setExpires]=useState<number|null|undefined>(undefined),[made,setMade]=useState<{url:string;how:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void api<{expires:number|null}>('/family-link').then(r=>setExpires(r.expires)).catch(()=>setExpires(null));},[]);
  const change=(off:boolean)=>{setBusy(true);setError('');void (async()=>{try{
    if(off){await api('/family-link',{off:true});setExpires(null);setMade(null);return;}
    const result=await api<{url:string;expires:number}>('/family-link',{});setExpires(result.expires);
    const how=await backend.share('Pull up a chair at our family’s Plunge table. Tap, type your name, and save your seat:',result.url);
    setMade({url:result.url,how:how==='shared'?'Sent. Post it again any time with Make a new link.':how==='copied'?'Copied. Paste it in the family chat.':'Paste this in the family chat.'});
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}})();};
  return <div class="account-invite"><h3>Family link</h3>
    <p>One link for the family chat. Each person taps it, types their name, and saves a seat; they show up below for you to let in. Anyone holding the link can ask, so only let in people you know.</p>
    {expires===undefined?null:expires?<p class="idea-help">The family link is on until {day(expires)}.</p>:<p class="idea-help">No family link is on right now.</p>}
    <button class="big-btn secondary" disabled={busy||expires===undefined} onClick={()=>change(false)}>{expires?'Make a new link':'Make the family link'}</button>
    {!!expires&&<button class="text-btn" disabled={busy} onClick={()=>change(true)}>Turn it off</button>}
    {made&&<div class="idea-notice" role="status"><p>{made.how} Making a new link turns the old one off.</p><label>Family link<input readOnly value={made.url} onFocus={e=>e.currentTarget.select()}/></label></div>}
    {error&&<p class="idea-error" role="alert">{error}</p>}
  </div>;
}
/** Save a seat for someone: they get a link that works once, for a week. */
function InviteFamily({me,backend}:{me:string;backend:AccountBackend}) {
  const api=backend.api;
  const [invites,setInvites]=useState<Invite[]>([]),[name,setName]=useState(''),[sent,setSent]=useState<{name:string;url:string;how:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=()=>api<{invites:Invite[]}>('/invites').then(r=>setInvites(r.invites)).catch(()=>{/* The list is a convenience. */});
  useEffect(()=>{void load();},[]);
  const send=(body:{name:string}|{id:string},to:string)=>{setBusy(true);setError('');void (async()=>{try{
    const {url}=await api<{url:string}>('/invite',body);
    const how=await backend.share(`${to}, ${me} saved you a seat at our Plunge table. Tap to join:`,url);
    setSent({name:to,url,how:how==='shared'?`Sent. The link works once, for a week.`:how==='copied'?`Copied. Paste it in a message to ${to}. It works once, for a week.`:`Send this link to ${to}. It works once, for a week.`});
    setName('');await load();
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}})();};
  return <div class="account-invite"><h3>Invite family</h3>
    <p>Save a seat for someone. They tap the link, their phone checks it’s them, and they’re at the family table. No password.</p>
    <form onSubmit={e=>{e.preventDefault();if(name.trim())send({name:name.trim()},name.trim());}}>
      <label>Their name<input value={name} maxLength={40} autoComplete="off" placeholder="Uncle Benny" onInput={e=>setName(e.currentTarget.value)}/></label>
      <button class="big-btn secondary" disabled={busy||!name.trim()}>Send an invite</button>
    </form>
    {sent&&<div class="idea-notice" role="status"><p>{sent.how}</p><label>Invite for {sent.name}<input readOnly value={sent.url} onFocus={e=>e.currentTarget.select()}/></label></div>}
    {error&&<p class="idea-error" role="alert">{error}</p>}
    {invites.length>0&&<ul class="account-invites">{invites.map(invite=><li key={invite.id}><strong>{invite.name}</strong>
      {invite.joined?<span>Joined</span>:<><span>Not yet</span><button class="text-btn" disabled={busy} onClick={()=>send({id:invite.id},invite.name)}>Send again</button></>}</li>)}</ul>}
  </div>;
}
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
/** What this device has, what the account holds, and anything that could not connect. Never claims an upload that did not happen. */
function statsLines(s:StatsStatus,localOnly:boolean):string[] {
  if(localOnly)return ['This preview keeps stats on the device only.'];
  const here=[`${plural(s.device,'hand')} on this device`];
  if(s.account){here.push(`${s.connected} connected to your account`);if(s.waiting)here.push(`${s.waiting} waiting to connect`);if(s.rejected)here.push(`${s.rejected} could not be connected and stay here`);}
  const lines=[`${here.join(' · ')}.`];
  if(s.total!==null)lines.push(`Your account holds ${plural(s.total,'hand')}, every device and family game included.`);
  if(s.error)lines.push(`${s.error} Your device keeps its hands and retries on its own.`);
  return lines;
}
export function AccountPage({backend=liveBackend,heading}:{backend?:AccountBackend;heading?:ComponentChildren}={}) {
  const api=backend.api;
  const [state,setState]=useState<State|null>(null),[members,setMembers]=useState<Person[]>([]),[name,setName]=useState(tableName);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [recover,setRecover]=useState(()=>secretFromLink('recover')),[recoveryLink,setRecoveryLink]=useState<{name:string;url:string;kind:'Recovery'|'Invite'}|null>(null);
  const [family,setFamily]=useState(()=>secretFromLink('family')),[familyLink,setFamilyLink]=useState<FamilyLink|null>(null);
  const [join,setJoin]=useState(()=>secretFromLink('join')),[seat,setSeat]=useState<Seat|null>(null),[pasted,setPasted]=useState('');
  /** Just claimed an invite: the welcome stays up until they move on. */
  const [welcomed,setWelcomed]=useState(false),[opening,setOpening]=useState(false);
  const [stats,setStats]=useState<StatsStatus|null>(null),[connecting,setConnecting]=useState(false);
  // Signing in connects this device's hands; signed out, the page only counts them (the one request comes back 401).
  const connectStats=async(id?:string)=>{setConnecting(true);try{setStats(await backend.stats(id));}catch{/* The device log is unaffected; the next visit retries. */}finally{setConnecting(false);}};
  useEffect(()=>{if(state)void connectStats(state.account?.id);},[!state,state?.account?.id]);
  const supported=backend.supported;
  const refresh=async()=>{const next=await api<State>();setState(next);if(next.account)setName(next.account.name);
    if(next.available)rememberMe(next.account&&{name:next.account.name});
    if(next.account?.owner)setMembers((await api<{members:Person[]}>('/members')).members);else {setMembers([]);setRecoveryLink(null);}};
  useEffect(()=>{void refresh().catch(e=>setError(String(e.message)));
    const recoveryChanged=()=>{const token=secretFromLink('recover');if(token)setRecover(token);const invite=secretFromLink('join');if(invite)setJoin(invite);const shared=secretFromLink('family');if(shared)setFamily(shared);};
    window.addEventListener('hashchange',recoveryChanged);return()=>window.removeEventListener('hashchange',recoveryChanged);
  },[]);
  // Greet the invited person by name before they use the link.
  useEffect(()=>{if(!join)return;setSeat(null);void api<Seat>('/invite/peek',{token:join}).then(setSeat).catch(e=>{setJoin('');setError(String(e.message));});},[join]);
  useEffect(()=>{if(!family)return;void api<FamilyLink>('/family-link/peek',{token:family}).then(setFamilyLink).catch(e=>{setFamily('');setError(String(e.message));});},[family]);
  // Waiting to be let in: notice it without anyone tapping anything, while the page is open.
  const pending=!!state?.account&&!state.account.family&&!state.account.owner&&!!state.account.requested;
  useEffect(()=>{if(!pending)return;const check=()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{/* Checked again shortly. */});};
    const timer=setInterval(check,20000);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',check);};},[pending]);
  // The owner's list stays current as people trickle in.
  const owner=!!state?.account?.owner;
  useEffect(()=>{if(!owner)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{});},30000);return()=>clearInterval(timer);},[owner]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work();}catch(e){
    const cancelled=e instanceof Error&&(e.name==='NotAllowedError'||e.name==='AbortError');
    setError(cancelled?'No problem—sign-in wasn’t completed. You can try again or keep playing.':e instanceof Error?e.message:'Please retry.');
  }finally{setBusy(false);}};
  const act=(path:string,body:unknown,message:string)=>run(async()=>{await api(path,body);if(path==='/logout'){try{localStorage.removeItem(TOKEN_KEY);}catch{/* Server session is gone. */}}await refresh();setNotice(message);});
  const passkey=(kind:'register'|'login'|'add'|'recover')=>run(async()=>{
    const path=`/passkey/${kind}`;
    // An invite is claimed exactly like a recovery of an account that never had a passkey.
    const options=await api<PublicKeyCredentialCreationOptionsJSON & PublicKeyCredentialRequestOptionsJSON>(`${path}/options`,{name,token:join||recover,...(kind==='register'&&family?{family}:{})});
    const response=kind==='login'?await backend.authenticate(options):await backend.register(options);
    await api(`${path}/finish`,{response});
    const welcome=!!join||(kind==='register'&&!!family);
    if(join){setJoin('');setSeat(null);}if(family)setFamily('');if(welcome)setWelcomed(true);
    setRecover('');await refresh();if(!welcome)setNotice(kind==='add'?'Another passkey is ready.':'You’re signed in.');
  });
  const available=!!state?.available&&!backend.localOnly;
  const sitDown=async()=>{setOpening(true);setError('');try{await backend.sitDown();}
    catch(e){setError(e instanceof Error?e.message:'The family table could not be found.');}finally{setOpening(false);}};
  /** The hands already on this device, which come along when someone signs in. */
  const waiting=stats&&stats.device>0?` Your ${plural(stats.device,'hand')} from this ${standalone()?'phone':'browser'} ${stats.device===1?'comes':'come'} with you.`:'';
  return <main class="ideas-page account-page">{heading}<header class="ideas-top"><a href="/">← Back to Plunge</a><span>Always welcome at the table</span></header>
    <div class="ideas-heading">{join||family||welcomed?<><h1>Welcome to Plunge</h1><p>Texas 42 with the family, free for everyone.</p></>
      :<><h1>Your Plunge account</h1><p>Sign in if you’d like. Playing is always open to everyone.</p></>}</div>
    {!state ? <p role="status">{error?'Account details could not load.':'Opening your account…'}</p> : join ? <section class="idea-paper">
      {!seat ? <p role="status">Opening your invite…</p> : state.account && !seat.you && !state.account.family && !state.account.owner ? <><h2>Hi, {state.account.name}.</h2>
        <p class="account-lede">{seat.invitedBy??'Jason'} saved you a seat at the family table.</p>
        <p>You’re already signed in, so the seat joins the account you have. Nothing else to set up.</p>
        <button class="big-btn" disabled={busy} onClick={()=>void run(async()=>{await api('/invite/accept',{token:join});setJoin('');setSeat(null);setWelcomed(true);await refresh();})}>Join the family as {state.account.name}</button>
        <button class="text-btn" disabled={busy} onClick={()=>void act('/logout',{},'Signed out. You can save the seat now.')}>Not {state.account.name}? Sign out</button>
      </> : state.account && !seat.you ? <><h2>This invite is for {seat.name}</h2>
        <p>You’re already at the family table as {state.account.name}. Send the link to {seat.name}, or sign out if this is {seat.name}’s phone.</p>
        <button class="big-btn secondary" disabled={busy} onClick={()=>void act('/logout',{},'Signed out. You can save the seat now.')}>Sign out</button>
        <button class="text-btn" disabled={busy} onClick={()=>setJoin('')}>Keep me signed in</button>
      </> : <><h2>Hi, {seat.name}.</h2>
        <p class="account-lede">{seat.invitedBy??'Jason'} saved you a seat at the family table.</p>
        <p>Plunge is free with or without a seat. Saving it lets you sit down with the family from any device, keeps your hands together, and opens the family’s ideas.</p>
        <button class="big-btn" disabled={busy||!available||!supported} onClick={()=>void passkey('recover')}>Save my seat</button>
        <p class="idea-help">Your phone asks for your face, fingerprint, or passcode. There’s no password.{waiting}</p>
        {!supported&&<p class="idea-help">This browser can’t save seats. Open the link in Safari or Chrome on your phone.</p>}
        <a class="account-play" href="/">Not now, just play →</a>
      </>}
    </section> : family ? <section class="idea-paper">
      {!familyLink ? <p role="status">Opening the family link…</p> : state.account ? <><h2>You’re already signed in, {state.account.name}.</h2>
        <p>{state.account.family||state.account.owner?'You’re already at the family table.':state.account.requested?`Your request is waiting for ${familyLink.by}.`:`Ask ${familyLink.by} to let you in to the family table.`}</p>
        {!state.account.family&&!state.account.owner&&!state.account.requested&&<button class="big-btn" disabled={busy} onClick={()=>void act('/request',{},`${familyLink.by} can now see your request.`)}>Ask to come in</button>}
        <button class="text-btn" onClick={()=>setFamily('')}>Go to my account</button>
      </> : <><h2>Pull up a chair.</h2>
        <p class="account-lede">{familyLink.by}’s family is playing Plunge, a Texas 42 game. Save your seat, and {familyLink.by} will let you in.</p>
        <form onSubmit={event=>{event.preventDefault();if(name.trim())void passkey('register');}}>
          <label>What should we call you at the table?<input value={name} maxLength={40} autoComplete="nickname" placeholder="Aunt June" onInput={e=>setName(e.currentTarget.value)}/></label>
          <button class="big-btn" disabled={busy||!available||!supported||!name.trim()}>Save my seat</button>
        </form>
        <p class="idea-help">Your phone asks for your face, fingerprint, or passcode, the same as unlocking it. There’s nothing to download and nothing you can break; playing works the same either way.{waiting}</p>
        {!supported&&<p class="idea-help">This browser can’t save seats. Open the link in Safari or Chrome on your phone.</p>}
        <button class="text-btn" disabled={busy||!available||!supported} onClick={()=>void passkey('login')}>I already saved my seat: sign in</button>
        <a class="account-play" href="/">Not now, just play →</a>
      </>}
    </section> : welcomed && pending && state.account ? <section class="idea-paper"><h2>You’re on the list, {state.account.name}.</h2>
      <p class="account-lede">{familyLink?.by??'Jason'} will let you in to the family table soon. You don’t need to do anything else: this page notices when you’re in.</p>
      <p>Your seat is saved{stats?.account&&stats.connected?`, along with ${plural(stats.connected,'hand')} from here`:''}.</p>
      {!standalone()&&<p class="idea-help">Already have Plunge on your home screen? Open it and tap <strong>Sign in</strong> at the top. Your face or fingerprint does the rest, and the hands you’ve played there join you.</p>}
      <a class="big-btn secondary account-ideas" href="/">Play while you wait</a>
    </section> : welcomed && state.account ? <section class="idea-paper"><h2>You’re in, {state.account.name}.</h2>
      <p>Your seat is saved{stats?.account&&stats.connected?`, along with ${plural(stats.connected,'hand')} from here`:''}.</p>
      {!standalone()&&<p class="account-lede">Already have Plunge on your home screen? Open it and tap <strong>Sign in</strong> at the top. Your face or fingerprint does the rest, and the hands you’ve played there join you.</p>}
      {ROOMS_ENABLED&&<button class="big-btn" disabled={opening} onClick={()=>void sitDown()}>{opening?'Finding the family table…':'Sit down at the family table'}</button>}
      <a class="account-play" href="/">Play on my own →</a>
    </section> : recover ? <section class="idea-paper"><h2>Welcome back</h2>
      <p>Create a replacement passkey for the account Jason helped you recover. Your old passkeys and sign-ins will stop working; your ideas and family access stay with you.</p>
      <button class="big-btn" disabled={busy||!available||!supported} onClick={()=>void passkey('recover')}>Create replacement passkey</button>
      <button class="text-btn" disabled={busy} onClick={()=>setRecover('')}>Cancel recovery</button>
    </section> : !state.account ? <section class="idea-paper"><h2>Make yourself at home</h2>
      <p>Plunge is free to play, no account needed. Signing in keeps your name and hands with you on every device, and family can invite you to more.</p>
      <button class="big-btn" disabled={busy||!available||!supported} onClick={()=>void passkey('login')}>Sign in</button>
      <p class="idea-help">Your device checks your face, fingerprint, or passcode. No password to remember.</p>
      <details class="account-help"><summary>Have an invite link?</summary><p>If someone sent you an invite, paste it here to save your seat in this app.</p>
        <form onSubmit={e=>{e.preventDefault();const token=inviteFromInput(pasted);if(token){setJoin(token);setPasted('');}else setError('That doesn’t look like a Plunge invite link.');}}>
          <label>Invite link<input value={pasted} autoComplete="off" autoCapitalize="none" spellcheck={false} onInput={e=>setPasted(e.currentTarget.value)}/></label>
          <button class="big-btn secondary" disabled={!pasted.trim()}>Open my invite</button></form></details>
      <form class="account-new" onSubmit={event=>{event.preventDefault();void passkey('register');}}><h3>First time signing in?</h3>
        <label>What should we call you?<input value={name} maxLength={40} autoComplete="nickname" onInput={e=>setName(e.currentTarget.value)}/></label>
        <button class="big-btn secondary" disabled={busy||!available||!supported||!name.trim()}>Create an account</button>
      </form>
      {!available&&<p class="idea-help">Sign-in lives in the main Plunge app. <a href={`${LIVE_PLUNGE}/?account=1`}>Open your account there</a>, or <a href="?account=1&demo=invite">try the sample walkthrough</a>.</p>}
      {!supported&&<p class="idea-help">This browser can’t use passkeys. Try a current browser on your phone, or keep playing without an account.</p>}
      <p class="idea-help">Signing in connects the hands played here to your account, together with your other devices and family games.{waiting}</p>
      <details class="account-help"><summary>Lost access?</summary><p>Try signing in on another device first. If that doesn’t work, ask Jason for a recovery link. Please don’t create a second account to replace a lost one.</p></details>
      <a class="account-play" href="/">Keep playing without signing in →</a>
    </section> : <>
      <section class="idea-paper"><h2>Hi, {state.account.name}.</h2><p>You’re signed in with your passkey.</p>
        <form onSubmit={event=>{event.preventDefault();void act('/profile',{name},'Your name is saved.');}}><label>What should we call you?<input value={name} maxLength={40} onInput={e=>setName(e.currentTarget.value)}/></label><button class="big-btn secondary" disabled={busy||!name.trim()}>Save name</button></form>
        {state.account.family ? <a class="big-btn account-ideas" href="/?ideas=1">Open family ideas →</a> : <div class="account-access"><h3>Join the family</h3>
          <p>{state.account.requested?'Your request is waiting for Jason. Keep playing; it opens up as soon as he lets you in.':'Family see each other’s tables right on the home screen, sit at the family table, and share ideas for the app. Jason lets people in.'}</p>
          <button class="big-btn" disabled={busy||!!state.account.requested} onClick={()=>void act('/request',{},'Jason can now see your request.')}>{state.account.requested?'Asked · waiting for Jason':'Ask to join the family'}</button>
          {!!state.account.requested&&<button class="text-btn" disabled={busy} onClick={()=>void run(refresh)}>Check access</button>}
        </div>}
        {(!!state.account.family||!!state.account.owner)&&<InviteFamily me={state.account.name} backend={backend}/>}
        <details class="account-help"><summary>Account and sign-in help</summary>
          <p>Your account number is <code>{state.account.id}</code>. Share it with Jason so he can confirm the right account before granting access or helping you recover it.</p>
          <button class="big-btn secondary" disabled={busy||!supported} onClick={()=>void passkey('add')}>Add another passkey</button>
        </details>
        <div class="account-stats"><h3>Your hands</h3>
          {stats?statsLines(stats,backend.localOnly).map(line=><p key={line}>{line}</p>):<p role="status">Counting the hands on this device…</p>}
          <button class="big-btn secondary" disabled={busy||connecting} onClick={()=>void connectStats(state.account?.id)}>{connecting?'Connecting…':'Connect now'}</button>
        </div>
        <p class="idea-help">Hands played on this device connect to your account while you’re signed in, and merge with your other devices and family games. Full game history and Walt results stay on this device; export a backup from More.</p>
        <button class="text-btn" disabled={busy} onClick={()=>void act('/logout',{},'Signed out. You can still play.')}>Sign out</button>
      </section>
      {!!state.account.owner&&<section class="idea-paper"><h2>Who’s at the family table?</h2>
        {members.some(m=>m.requested&&!m.family)?<div class="account-waiting"><h3>Waiting to come in</h3>
          {members.filter(m=>m.requested&&!m.family).map(member=><article class="account-member" key={member.id}><strong>{member.name}</strong>
            <span>{[member.via_link?'came through the family link':'asked from their account',member.created&&`saved a seat ${new Date(member.created).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}`].filter(Boolean).join(' · ')}</span>
            <button class="big-btn" disabled={busy} onClick={()=>void act('/grant',{id:member.id,enabled:true},`${member.name} is in.`)}>Let {member.name} in</button>
            <button class="text-btn" disabled={busy} onClick={()=>void act('/grant',{id:member.id,enabled:false},`${member.name} stays out of the family table.`)}>Not now</button>
          </article>)}</div>:<p class="idea-help">Nobody is waiting to come in.</p>}
        <FamilyLinkPanel backend={backend}/>
        <h3>Everyone</h3><p class="idea-help">Anyone can choose a familiar name. If you’re unsure, check with the person before letting them in.</p>
        {members.filter(m=>!(m.requested&&!m.family)).map(member=><article class="account-member" key={member.id}><strong>{member.name}</strong><code>{member.id}</code>
          <span>{[member.family?'Family access':member.requested?'Asked to join':'No family access',member.invited_by&&(member.via_link?`through ${member.invited_by}’s family link`:`invited by ${member.invited_by}`),member.joined===0&&'hasn’t used the invite yet'].filter(Boolean).join(' · ')}</span>
          <button class="big-btn secondary" disabled={busy} onClick={()=>void act('/grant',{id:member.id,enabled:!member.family},member.family?'Family access removed.':'Family access granted.')}>{member.family?'Remove family access':'Grant family access'}</button>
          {!member.owner&&member.joined!==0&&<details><summary>Help recover this account</summary><p>Confirm who you’re helping first. The link allows its recipient to replace all passkeys on this account. It expires in 15 minutes and works once.</p>
            <button class="text-btn" disabled={busy} onClick={()=>void run(async()=>{const result=await api<{url:string}>('/recovery',{id:member.id});setRecoveryLink({name:member.name,url:result.url,kind:'Recovery'});})}>Make recovery link</button>
          </details>}
          {member.joined===0&&<button class="text-btn" disabled={busy} onClick={()=>void run(async()=>{const result=await api<{url:string}>('/invite',{id:member.id});setRecoveryLink({name:member.name,url:result.url,kind:'Invite'});})}>New invite link</button>}
        </article>)}
        {recoveryLink&&<div class="idea-notice"><p>{recoveryLink.kind} link for {recoveryLink.name}. Share it privately with them.</p><label>{recoveryLink.kind} link<input readOnly value={recoveryLink.url} onFocus={e=>e.currentTarget.select()}/></label><button class="text-btn" onClick={()=>setRecoveryLink(null)}>Hide link</button></div>}
        <button class="text-btn" disabled={busy} onClick={()=>void run(refresh)}>Refresh requests</button>
      </section>}
    </>}
    {busy&&<p role="status">Follow your device’s prompt, or wait a moment…</p>}
    {notice&&<p class="idea-notice" role="status">{notice}</p>}{error&&<p class="idea-error" role="alert">{error}</p>}
  </main>;
}
