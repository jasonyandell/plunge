import { useEffect, useState } from 'preact/hooks';
import { TOKEN_KEY } from '../ideas/client';
import { LIVE_PLUNGE } from '../ideas/model';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import '../ui/app.css';
import '../ui/home.css';
import '../ideas/ideas.css';
import './account.css';
interface Person {id:string;name:string;provider:string;email:string|null;owner:number;requested:number;family:number}
interface State {account:Person|null;providers:{apple:boolean;google:boolean};available:boolean}
async function api<T>(path='',body?:unknown):Promise<T> {
  const response=await fetch(`/api/account${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Please try again.');return data as T;
}
export function AccountPage() {
  const [state,setState]=useState<State|null>(null),[members,setMembers]=useState<Person[]>([]),[name,setName]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{const next=await api<State>();setState(next);setName(next.account?.name??'');
    if(next.account?.owner)setMembers((await api<{members:Person[]}>('/members')).members);else setMembers([]);};
  useEffect(()=>{void refresh().catch(e=>setError(String(e.message)));},[]);
  const act=async(path:string,body:unknown,message:string)=>{setBusy(true);setError('');try{await api(path,body);if(path==='/logout'){try{localStorage.removeItem(TOKEN_KEY);}catch{/* The server session is already gone. */}}await refresh();setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Please retry.');}finally{setBusy(false);}};
  const login=new URLSearchParams(location.search).get('login');
  return <main class="ideas-page account-page"><header class="ideas-top"><a href="/">← Back to Plunge</a><span>Always welcome at the table</span></header>
    <div class="ideas-heading"><h1>Your Plunge account</h1><p>Sign in if you’d like. Playing is always open to everyone.</p></div>
    {login && !state?.account && <p class="idea-notice" role="status">{login==='cancelled'?'Sign-in cancelled. You can keep playing.':login==='unavailable'?'That sign-in option isn’t ready yet.':'Sign-in didn’t finish. Please try again, or keep playing.'}</p>}
    {!state ? <p role="status">{error?'Account details could not load.':'Opening your account…'}</p> : !state.account ? <section class="idea-paper"><h2>Make yourself at home</h2>
      <p>Use Apple or Google to be recognized on your devices and ask Jason for family access.</p>
      {(['apple','google'] as const).map(provider=><form key={provider} method="post" action={`/api/account/start/${provider}`}>
        <button class={`provider-button provider-${provider}`} aria-label={`Sign in with ${provider==='apple'?'Apple':'Google'}`} disabled={QUESTIONS_LOCAL_ONLY||!state.available||!state.providers[provider]}>
          <img src={`/auth/${provider}-sign-in.${provider==='apple'?'png':'svg'}`} alt=""/>
        </button>
      </form>)}
      {QUESTIONS_LOCAL_ONLY || !state.available ? <p class="idea-help">Sign-in lives in the main Plunge app. <a href={`${LIVE_PLUNGE}/?account=1`}>Open your account there</a>.</p>
        : !state.providers.apple&&!state.providers.google&&<p class="idea-help">Optional sign-in is being set up. Everything you can play today is still here.</p>}
      <a class="account-play" href="/">Keep playing without signing in →</a>
    </section> : <>
      <section class="idea-paper"><h2>Hi, {state.account.name}.</h2><p>Signed in with {state.account.provider==='apple'?'Apple':'Google'}{state.account.email?` · ${state.account.email}`:''}</p>
        <form onSubmit={event=>{event.preventDefault();void act('/profile',{name},'Your name is saved.');}}><label>What should we call you?<input value={name} maxLength={40} onInput={e=>setName(e.currentTarget.value)}/></label><button class="big-btn secondary" disabled={busy||!name.trim()}>Save name</button></form>
        {state.account.family ? <a class="big-btn account-ideas" href="/?ideas=1">Open family ideas →</a> : <div class="account-access"><h3>Family ideas</h3>
          <p>{state.account.requested?'Your request is waiting for Jason. You can keep playing while he adds you.':'Jason decides who can read the family’s cards and ask for changes.'}</p>
          <button class="big-btn" disabled={busy||!!state.account.requested} onClick={()=>void act('/request',{},'Jason can now see your request.')}>{state.account.requested?'Access requested':'Ask for family access'}</button>
          {!!state.account.requested&&<button class="text-btn" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Check access</button>}
        </div>}
        <p class="idea-help">Your existing games and history stay on this device. Signing in does not upload them.</p>
        <button class="text-btn" disabled={busy} onClick={()=>void act('/logout',{},'Signed out. You can still play.')}>Sign out</button>
      </section>
      {!!state.account.owner&&<section class="idea-paper"><h2>Who’s at the family table?</h2><p>Grant access to someone you recognize. Their chosen name and sign-in email help you check.</p>
        {!members.length&&<p>No requests yet.</p>}
        {members.map(member=><article class="account-member" key={member.id}><strong>{member.name}</strong><span>{member.provider==='apple'?'Apple':'Google'}{member.email?` · ${member.email}`:' · no email shared'}</span>
          <span>{member.family?'Family access':member.requested?'Asked to join':'No family access'}</span>
          <button class="big-btn secondary" disabled={busy} onClick={()=>void act('/grant',{id:member.id,enabled:!member.family},member.family?'Family access removed.':'Family access granted.')}>{member.family?'Remove family access':'Grant family access'}</button>
        </article>)}
        <button class="text-btn" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Refresh requests</button>
      </section>}
    </>}
    {notice&&<p class="idea-notice" role="status">{notice}</p>}{error&&<p class="idea-error" role="alert">{error}</p>}
  </main>;
}
