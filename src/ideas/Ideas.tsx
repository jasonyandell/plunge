import { useEffect, useRef, useState } from 'preact/hooks';
import { IdeaActivity } from './IdeaActivity';
import { IdeaPreview, useIdeaPreview } from './IdeaPreview';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { LIVE_PLUNGE, type IdeaCard, type IdeaThread } from './model';
import { cardFromHash, deviceContext, ideasApi, ideasLink, initialToken, InviteError, inviteToken, newId, readDraft, TOKEN_KEY } from './client';
import '../ui/app.css';
import '../ui/home.css';
import './ideas.css';
export function Ideas() {
  const [token,setToken] = useState(initialToken), [invite,setInvite] = useState('');
  const [name,setName] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [cards,setCards] = useState<IdeaCard[]>([]), [loaded,setLoaded] = useState(false), [next,setNext] = useState<number|null>(null);
  const [selected,setSelected] = useState(cardFromHash), [thread,setThread] = useState<IdeaThread|null>(null);
  const [now,setNow]=useState(Date.now),[connected,setConnected]=useState(navigator.onLine);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);const offline=()=>setConnected(false);
    window.addEventListener('offline',offline);return()=>{clearInterval(timer);window.removeEventListener('offline',offline);};},[]);
  const [saved,setSaved] = useState(''), [owner,setOwner] = useState(false);
  const trial=useIdeaPreview();
  const generation = useRef(0), olderLoaded=useRef(false);
  useEffect(() => {
    const changed = () => {const id=cardFromHash();if(id!==selected){setSelected(id);setThread(null);setError('');}};
    window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed); return () => {window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed);};
  }, [selected]);
  useEffect(() => {
    const epoch = ++generation.current; let running = false;
    if (QUESTIONS_LOCAL_ONLY) return;
    const refresh = async () => {
      if (running) return; running=true;
      try {
        const me = await ideasApi<{name:string;owner?:boolean}>(token,'/me');
        const board = await ideasApi<{cards:IdeaCard[];next:number|null}>(token);
        const current = selected ? await ideasApi<IdeaThread>(token,`/${selected}`) : null;
        if (epoch !== generation.current) return;
        setConnected(true);setNow(Date.now());setName(me.name);setOwner(me.owner===true); setCards(old=>[...board.cards,...old.filter(c=>!board.cards.some(n=>n.id===c.id))]); if(!olderLoaded.current)setNext(board.next); setLoaded(true);setThread(current);setError('');
      } catch(e) { if(epoch===generation.current) {setConnected(false);setError(e instanceof Error ? e.message : 'Please retry.'); if(e instanceof InviteError) {setName('');setOwner(false);}} }
      finally {running=false;}
    };
    void refresh(); const timer=setInterval(() => void refresh(),5000);
    window.addEventListener('online',refresh);window.addEventListener('focus',refresh);
    return () => {generation.current++;clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);};
  }, [token,selected]);
  const open = (id: string|null) => { history.pushState(null,'',location.pathname+location.search+(id ? `#idea=${id}` : '')); setSelected(id);setThread(null);setError(''); };
  const sent = (result: IdeaThread) => {
    setSaved(selected && result.card.status==='building' ? 'Your reply is saved for the builder’s next turn.' : 'Saved. The builder will reply here. You can add another thought below.');
    if(!selected) open(result.card.id);
    setThread(result);
  };
  const approve = async () => {
    if(!thread || busy)return;
    const id=thread.card.id,epoch=generation.current;
    setBusy(true);setError('');
    try {
      const result=await ideasApi<IdeaThread>(token,`/${id}/approve`,{revision:thread.card.revision},'POST');
      if(generation.current===epoch){setThread(result);setSaved('Approved. The builder can use all project files for this request.');}
    } catch(e) {if(generation.current===epoch)setError(e instanceof Error?e.message:'Could not approve. Please retry.');}
    finally{setBusy(false);}
  };
  const enter = (event: Event) => {event.preventDefault();const key=inviteToken(invite);
    if(!key) {setError('Paste the invite link Jason shared with you.');return;}
    try {localStorage.setItem(TOKEN_KEY,key);} catch { /* Visit-only login. */ }
    setToken(key);setError('');};
  const more = async () => {try {const page=await ideasApi<{cards:IdeaCard[];next:number|null}>(token,`?before=${next}`);
    olderLoaded.current=true;setCards(c => [...c,...page.cards.filter(x=>!c.some(y=>y.id===x.id))]);setNext(page.next);
  } catch(e) {setError(String(e));}};
  if(trial.id && thread?.card.id===trial.id && name && !QUESTIONS_LOCAL_ONLY)
    return <IdeaPreview pr={thread.card.status==='ready' && thread.card.preview ? thread.card.pr ?? 0 : 0} title={thread.card.title} onClose={trial.close}/>;
  return <main class="ideas-page">
    <header class="ideas-top"><a href="/">← Back to Plunge</a><span>Made together</span></header>
    <div class="ideas-heading"><p class="eyebrow">Your seat at the drawing table</p><h1>Ideas for Plunge</h1>
      <p>Little fixes. Big ideas. A game that feels more like ours.</p></div>
    {QUESTIONS_LOCAL_ONLY ? <section class="idea-paper"><h2>Keep the conversation going</h2><p>This is a test version of Plunge. Your ideas and replies live together on the main game.</p>
      <a class="big-btn" href="/?ideas=1&demo=bidding">Try the family ideas demo</a><p><a href={ideasLink(selected ?? undefined)}>Open your live ideas</a></p></section>
    : !name ? <section class="idea-paper"><h2>Come on in</h2><p>Sign in to use family access Jason has granted you.</p><a class="big-btn" href="/?account=1">Open your account</a><details><summary>Have a personal invite instead?</summary><p>You can still paste your invite here.</p>
      <form onSubmit={enter}><label>Your invite link<input autoComplete="off" type="password" value={invite} onInput={e=>setInvite(e.currentTarget.value)} /></label><button class="big-btn" type="submit">Open my ideas</button></form></details>
      {token && !error && <p role="status">Opening your ideas…</p>}</section>
    : <>
      <div class="ideas-welcome"><p>Hi, {name}.</p><button class="big-btn secondary" type="button" disabled={busy} onClick={()=>open(null)}>＋ Another idea</button></div>
      {selected ? <>
        <button class="text-btn" type="button" disabled={busy} onClick={()=>open(null)}>← All ideas</button>
        {thread ? <section class="idea-paper"><div class="idea-meta"><span>{thread.card.name}’s idea</span><span>Idea {thread.card.number}</span></div>
          <h2>{thread.card.title}</h2>
          <IdeaActivity card={thread.card} now={now} connected={connected} />
          {thread.card.status==='shipped' && <a class="big-btn" href={LIVE_PLUNGE}>Play the updated game</a>}
          {thread.card.status==='ready' && thread.card.preview && <button class="big-btn" type="button" disabled={busy} onClick={()=>trial.open(thread.card.id)}>Try your change →</button>}
          <p class="idea-help">You can ask a question or clarify your idea below. {thread.card.status==='building' ? 'Replies will be picked up when this pass finishes.' : 'You can say “let’s talk it through first” before asking for changes.'}</p>
          <ol class="idea-conversation" aria-label="Conversation">{thread.messages.map(message=><li key={message.id} class={message.role}><strong>{message.name}</strong><p>{message.body}</p></li>)}</ol>
          {owner && <section class="idea-approval" aria-label="Builder access"><h3>Builder access</h3>
            {thread.permissions?.scope==='repository' ? <p>Full project access is approved for this request.</p> : <>
              <p>Allow the builder to change any project file for the conversation above. New family replies need a fresh approval.</p>
              <button class="big-btn secondary" type="button" disabled={busy || !['queued','question','failed'].includes(thread.card.status)} onClick={()=>void approve()}>Approve full access</button>
              {thread.card.status==='building' && <p class="idea-help">You can approve when the current build finishes.</p>}
            </>}
          </section>}
          <Composer key={selected} token={token} selected={selected} onBusy={setBusy} onSent={sent} onError={setError} />
        </section> : <p role="status">Opening that idea…</p>}
      </> : <>
        <section class="idea-paper new-idea"><h2>What would make the game better?</h2><p>Say it just like you would at the table.</p>
          <Composer key="new" token={token} selected={null} onBusy={setBusy} onSent={sent} onError={setError} />
          <p class="idea-help">We’ll make a version for you to try. You can ask questions and suggest more changes right on your card.</p>
        </section>
        <h2 class="ideas-board-title">Around the table</h2>
        {!loaded ? <p role="status">Opening the board…</p> : !cards.length ? <p>No ideas yet. Yours can be the first.</p> :
          <div class="ideas-grid">{cards.map(card=><button type="button" key={card.id} class="idea-paper idea-card" disabled={busy} onClick={()=>open(card.id)}>
            <span class="idea-meta">{card.name} · Idea {card.number}</span><h3>{card.title}</h3><IdeaActivity card={card} now={now} connected={connected} compact /><span class="idea-open">Open conversation →</span>
          </button>)}</div>}
        {next && <button class="big-btn secondary" type="button" onClick={()=>void more()}>Earlier ideas</button>}
      </>}
      <p class="idea-help">Your family can read and reply to these cards. Changes are reviewed before they join everyone’s game.</p>
    </>}
    {saved && <p role="status" class="idea-notice">{saved}</p>}
    {error && <p role="alert" class="idea-error">{error} Your unsent words stay in the box.</p>}
  </main>;
}

function Composer({token,selected,onBusy,onSent,onError}: {
  token:string;selected:string|null;onBusy:(busy:boolean)=>void;onSent:(thread:IdeaThread)=>void;onError:(error:string)=>void;
}) {
  const key=`plunge:idea-draft:${selected ?? 'new'}`;
  const [draft,setDraft]=useState(()=>readDraft(key)),[busy,setBusy]=useState(false);
  const edit=(body:string)=>{const next={...draft,body};setDraft(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Still in the text box. */}};
  const send=async(event:Event)=>{
    event.preventDefault();if(busy||!draft.body.trim())return;setBusy(true);onBusy(true);onError('');
    try {
      const result=await ideasApi<IdeaThread>(token,`/${selected ?? draft.id}${selected ? '/messages' : ''}`,{id:draft.id,body:draft.body,context:deviceContext()});
      try{localStorage.removeItem(key);}catch{/* Already saved on server. */}
      setDraft({id:newId(),body:''});onSent(result);
    }catch(e){onError(e instanceof Error?e.message:'Could not save. Please retry.');}
    finally{setBusy(false);onBusy(false);}
  };
  return <form onSubmit={send}><label>{selected?'Keep the conversation going':'Your idea'}
    <textarea disabled={busy} value={draft.body} maxLength={3000} placeholder={selected?'That helps! Could the letters be bigger?':'I can’t see my bid.'} onInput={e=>edit(e.currentTarget.value)} />
    </label><button class="big-btn" disabled={busy||!draft.body.trim()}>{busy?'Saving…':selected?'Send reply':'Make an idea card'}</button></form>;
}
