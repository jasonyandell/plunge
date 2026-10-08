import { useEffect, useState } from 'preact/hooks';
import { startRegistration, startAuthentication, browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { TOKEN_KEY } from '../ideas/client';
import { LIVE_PLUNGE } from '../ideas/model';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { statsStatus, syncStats, type StatsStatus } from '../history/stats-sync';
import '../ui/app.css';
import '../ui/home.css';
import '../ideas/ideas.css';
import './account.css';
interface Person {id:string;name:string;owner:number;requested:number;family:number}
interface State {account:Person|null;available:boolean}
async function api<T>(path='',body?:unknown):Promise<T> {
  const response=await fetch(`/api/account${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Please try again.');return data as T;
}
function recoveryFromLink():string {
  const hash=new URLSearchParams(location.hash.slice(1)),value=hash.get('recover')??'';
  if(value){hash.delete('recover');history.replaceState(null,'',location.pathname+location.search+(hash.size?`#${hash}`:''));}
  return /^[a-f0-9]{64}$/.test(value)?value:'';
}
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
/** What this device has, what the account holds, and anything that could not connect. Never claims an upload that did not happen. */
function statsLines(s:StatsStatus):string[] {
  if(s.state==='device-only')return ['This preview keeps finished-hand stats on the device only.'];
  const here=[`${plural(s.device,'finished hand')} on this device`];
  if(s.account){here.push(`${s.connected} connected to your account`);if(s.waiting)here.push(`${s.waiting} waiting to connect`);if(s.rejected)here.push(`${s.rejected} could not be connected and stay here`);}
  const lines=[`${here.join(' · ')}.`];
  if(s.state==='connected')lines.push(`Your account holds ${plural(s.hands,'hand')} from ${plural(s.devices,'device')}.`);
  if(s.error)lines.push(`${s.error} Your device keeps its hands and retries on its own.`);
  return lines;
}
export function AccountPage() {
  const [state,setState]=useState<State|null>(null),[members,setMembers]=useState<Person[]>([]),[name,setName]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [recover,setRecover]=useState(recoveryFromLink),[recoveryLink,setRecoveryLink]=useState<{name:string;url:string}|null>(null);
  const [stats,setStats]=useState<StatsStatus|null>(null),[connecting,setConnecting]=useState(false);
  const connectStats=async()=>{setConnecting(true);try{setStats(await syncStats());}catch{/* The device log is unaffected; the next visit retries. */}finally{setConnecting(false);}};
  // Signing in connects this device's finished hands; signed out, the page only counts them.
  useEffect(()=>{if(!state)return;if(state.account)void connectStats();else void statsStatus().then(setStats).catch(()=>{});},[state?.account?.id]);
  const supported=browserSupportsWebAuthn();
  const refresh=async()=>{const next=await api<State>();setState(next);setName(next.account?.name??'');
    if(next.account?.owner)setMembers((await api<{members:Person[]}>('/members')).members);else {setMembers([]);setRecoveryLink(null);}};
  useEffect(()=>{void refresh().catch(e=>setError(String(e.message)));
    const recoveryChanged=()=>{const token=recoveryFromLink();if(token)setRecover(token);};
    window.addEventListener('hashchange',recoveryChanged);return()=>window.removeEventListener('hashchange',recoveryChanged);
  },[]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work();}catch(e){
    const cancelled=e instanceof Error&&(e.name==='NotAllowedError'||e.name==='AbortError');
    setError(cancelled?'No problem—sign-in wasn’t completed. You can try again or keep playing.':e instanceof Error?e.message:'Please retry.');
  }finally{setBusy(false);}};
  const act=(path:string,body:unknown,message:string)=>run(async()=>{await api(path,body);if(path==='/logout'){try{localStorage.removeItem(TOKEN_KEY);}catch{/* Server session is gone. */}}await refresh();setNotice(message);});
  const passkey=(kind:'register'|'login'|'add'|'recover')=>run(async()=>{
    const path=`/passkey/${kind}`;
    const options=await api<PublicKeyCredentialCreationOptionsJSON & PublicKeyCredentialRequestOptionsJSON>(`${path}/options`,{name,token:recover});
    const response=kind==='login'?await startAuthentication({optionsJSON:options}):await startRegistration({optionsJSON:options});
    await api(`${path}/finish`,{response});setRecover('');await refresh();setNotice(kind==='add'?'Another passkey is ready.':'You’re signed in.');
  });
  const available=!!state?.available&&!QUESTIONS_LOCAL_ONLY;
  return <main class="ideas-page account-page"><header class="ideas-top"><a href="/">← Back to Plunge</a><span>Always welcome at the table</span></header>
    <div class="ideas-heading"><h1>Your Plunge account</h1><p>Sign in if you’d like. Playing is always open to everyone.</p></div>
    {!state ? <p role="status">{error?'Account details could not load.':'Opening your account…'}</p> : recover ? <section class="idea-paper"><h2>Welcome back</h2>
      <p>Create a replacement passkey for the account Jason helped you recover. Your old passkeys and sign-ins will stop working; your ideas and family access stay with you.</p>
      <button class="big-btn" disabled={busy||!available||!supported} onClick={()=>void passkey('recover')}>Create replacement passkey</button>
      <button class="text-btn" disabled={busy} onClick={()=>setRecover('')}>Cancel recovery</button>
    </section> : !state.account ? <section class="idea-paper"><h2>Make yourself at home</h2>
      <p>A passkey lets you sign in using your device’s face, fingerprint, or screen-lock check. No password to remember.</p>
      <button class="big-btn" disabled={busy||!available||!supported} onClick={()=>void passkey('login')}>Sign in with a passkey</button>
      <form class="account-new" onSubmit={event=>{event.preventDefault();void passkey('register');}}><h3>First time signing in?</h3>
        <label>What should we call you?<input value={name} maxLength={40} autoComplete="nickname" onInput={e=>setName(e.currentTarget.value)}/></label>
        <button class="big-btn secondary" disabled={busy||!available||!supported||!name.trim()}>Create an account</button>
      </form>
      {!available&&<p class="idea-help">Sign-in lives in the main Plunge app. <a href={`${LIVE_PLUNGE}/?account=1`}>Open your account there</a>.</p>}
      {!supported&&<p class="idea-help">This browser can’t use passkeys. Try a current browser on your phone, or keep playing without an account.</p>}
      <p class="idea-help">Signing in connects the finished hands on this device to your account, and merges them with your other devices.{stats&&stats.device>0&&` ${plural(stats.device,'finished hand')} ${stats.device===1?'is':'are'} waiting here.`}</p>
      <details class="account-help"><summary>Lost access?</summary><p>Try your saved passkey on another device first. If that doesn’t work, ask Jason for a recovery link. Please don’t create a second account to replace a lost one.</p></details>
      <a class="account-play" href="/">Keep playing without signing in →</a>
    </section> : <>
      <section class="idea-paper"><h2>Hi, {state.account.name}.</h2><p>You’re signed in with your passkey.</p>
        <form onSubmit={event=>{event.preventDefault();void act('/profile',{name},'Your name is saved.');}}><label>What should we call you?<input value={name} maxLength={40} onInput={e=>setName(e.currentTarget.value)}/></label><button class="big-btn secondary" disabled={busy||!name.trim()}>Save name</button></form>
        {state.account.family ? <a class="big-btn account-ideas" href="/?ideas=1">Open family ideas →</a> : <div class="account-access"><h3>Family ideas</h3>
          <p>{state.account.requested?'Your request is waiting for Jason. You can keep playing while he adds you.':'Jason decides who can read the family’s cards and ask for changes.'}</p>
          <button class="big-btn" disabled={busy||!!state.account.requested} onClick={()=>void act('/request',{},'Jason can now see your request.')}>{state.account.requested?'Access requested':'Ask for family access'}</button>
          {!!state.account.requested&&<button class="text-btn" disabled={busy} onClick={()=>void run(refresh)}>Check access</button>}
        </div>}
        <details class="account-help"><summary>Account and sign-in help</summary>
          <p>Your account number is <code>{state.account.id}</code>. Share it with Jason so he can confirm the right account before granting access or helping you recover it.</p>
          <button class="big-btn secondary" disabled={busy||!supported} onClick={()=>void passkey('add')}>Add another passkey</button>
        </details>
        <div class="account-stats"><h3>Your finished hands</h3>
          {stats?statsLines(stats).map(line=><p key={line}>{line}</p>):<p role="status">Counting the hands on this device…</p>}
          <button class="big-btn secondary" disabled={busy||connecting} onClick={()=>void connectStats()}>{connecting?'Connecting…':'Connect now'}</button>
        </div>
        <p class="idea-help">Finished-hand results from this device connect to your account while you’re signed in, and merge across your devices. Full game history and Walt results stay on this device; export a backup from More.</p>
        <button class="text-btn" disabled={busy} onClick={()=>void act('/logout',{},'Signed out. You can still play.')}>Sign out</button>
      </section>
      {!!state.account.owner&&<section class="idea-paper"><h2>Who’s at the family table?</h2><p>Confirm the account number with the person before granting access. Anyone can choose a familiar name.</p>
        {!members.length&&<p>No requests yet.</p>}
        {members.map(member=><article class="account-member" key={member.id}><strong>{member.name}</strong><code>{member.id}</code>
          <span>{member.family?'Family access':member.requested?'Asked to join':'No family access'}</span>
          <button class="big-btn secondary" disabled={busy} onClick={()=>void act('/grant',{id:member.id,enabled:!member.family},member.family?'Family access removed.':'Family access granted.')}>{member.family?'Remove family access':'Grant family access'}</button>
          {!member.owner&&<details><summary>Help recover this account</summary><p>Confirm who you’re helping first. The link allows its recipient to replace all passkeys on this account. It expires in 15 minutes and works once.</p>
            <button class="text-btn" disabled={busy} onClick={()=>void run(async()=>{const result=await api<{url:string}>('/recovery',{id:member.id});setRecoveryLink({name:member.name,url:result.url});})}>Make recovery link</button>
          </details>}
        </article>)}
        {recoveryLink&&<div class="idea-notice"><p>Recovery link for {recoveryLink.name}. Share it privately with them.</p><label>Recovery link<input readOnly value={recoveryLink.url} onFocus={e=>e.currentTarget.select()}/></label><button class="text-btn" onClick={()=>setRecoveryLink(null)}>Hide link</button></div>}
        <button class="text-btn" disabled={busy} onClick={()=>void run(refresh)}>Refresh requests</button>
      </section>}
    </>}
    {busy&&<p role="status">Follow your device’s prompt, or wait a moment…</p>}
    {notice&&<p class="idea-notice" role="status">{notice}</p>}{error&&<p class="idea-error" role="alert">{error}</p>}
  </main>;
}
