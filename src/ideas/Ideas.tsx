import { Composer } from './Composer';
import { Screenshot } from './IdeaScreenshots';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IdeaActivity } from './IdeaActivity';
import { IdeaResult } from './IdeaResult';
import { FamilyTableArt, IdeaDomino, IdeaJourney, SparkTile } from './art';
import { IdeasBoard, type IdeasBoardView } from './IdeasBoard';
import { hasIdeaDemo, ideaPresentation } from './presentation';
import { IdeaLink } from './IdeaLink';
import { IdeaPreview, useIdeaPreview } from './IdeaPreview';
import { PreviewSignIn } from './PreviewSignIn';
import { clearPreviewSession } from './preview-access';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { LIVE_PLUNGE, type IdeaCard, type IdeaThread } from './model';
import { cardFromHash, ideasApi, ideasLink, initialToken, InviteError, inviteToken, TOKEN_KEY } from './client';
import '../ui/app.css';
import '../ui/home.css';
import './ideas.css';
export function Ideas() {
  const [boardView,setBoardView]=useState<IdeasBoardView>({filter:'current',query:''});
  const [token,setToken] = useState(initialToken), [invite,setInvite] = useState('');
  const [name,setName] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [cards,setCards] = useState<IdeaCard[]>([]), [loaded,setLoaded] = useState(false), [next,setNext] = useState<number|null>(null);
  const [selected,setSelected] = useState(cardFromHash), [thread,setThread] = useState<IdeaThread|null>(null);
  const [now,setNow]=useState(Date.now),[connected,setConnected]=useState(navigator.onLine);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);const offline=()=>setConnected(false);
    window.addEventListener('offline',offline);return()=>{clearInterval(timer);window.removeEventListener('offline',offline);};},[]);
  const [saved,setSaved] = useState(''), [owner,setOwner] = useState(false);
  const [adding,setAdding] = useState(false);
  const newIdea = useRef<HTMLElement>(null);
  useEffect(() => {
    if(adding && !selected && newIdea.current) {
      newIdea.current.focus();newIdea.current.scrollIntoView({block:'start'});setAdding(false);
    }
  }, [adding,selected]);
  const trial=useIdeaPreview();
  const generation = useRef(0), olderLoaded=useRef(false);
  useEffect(() => {
    const changed = () => {const id=cardFromHash();if(id!==selected){setSelected(id);setThread(null);setError('');}};
    window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed); return () => {window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed);};
  }, [selected]);
  useEffect(() => {
    const epoch = ++generation.current; let running = false;
    if (QUESTIONS_LOCAL_ONLY && !token) return;
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
    setSaved(selected && result.card.lane==='hand' ? 'Saved. Jason will see it here. You can add another thought below.'
      : selected && result.card.status==='building' ? 'Your reply is saved for the builder’s next turn.' : 'Saved. The builder will reply here. You can add another thought below.');
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
  const accepting=!!thread?.release && ['queued','releasing','deploying'].includes(thread.release.status);
  const accept = async () => {
    if(!thread || busy || accepting)return;
    const {id,revision,pr,sha}=thread.card,epoch=generation.current;
    setBusy(true);setError('');
    try {
      const result=await ideasApi<IdeaThread>(token,`/${id}/accept`,{revision,pr,sha},'POST');
      if(generation.current===epoch){setThread(result);setSaved('Accepted. You can follow the release on this card.');}
    } catch(e) {if(generation.current===epoch)setError(e instanceof Error?e.message:'Could not accept yet. Please retry.');}
    finally{setBusy(false);}
  };
  const wake = async () => {
    if(!thread || busy)return;
    const id=thread.card.id,epoch=generation.current;
    setBusy(true);setError('');
    try {
      const result=await ideasApi<IdeaThread>(token,`/${id}/wake`,{},'POST');
      if(generation.current===epoch){setThread(result);setSaved('Waking it up. The preview will be back in a few minutes.');}
    } catch(e) {if(generation.current===epoch)setError(e instanceof Error?e.message:'Could not wake it yet. Please retry.');}
    finally{setBusy(false);}
  };
  const enter = (event: Event) => {event.preventDefault();const key=inviteToken(invite);
    if(!key) {setError('Paste the invite link Jason shared with you.');return;}
    try {localStorage.setItem(TOKEN_KEY,key);} catch { /* Visit-only login. */ }
    setToken(key);setError('');};
  const more = async () => {try {const page=await ideasApi<{cards:IdeaCard[];next:number|null}>(token,`?before=${next}`);
    olderLoaded.current=true;setCards(c => [...c,...page.cards.filter(x=>!c.some(y=>y.id===x.id))]);setNext(page.next);
  } catch(e) {setError(String(e));}};
  if(trial.id && thread?.card.id===trial.id && name)
    return <IdeaPreview pr={hasIdeaDemo(thread.card) ? thread.card.pr! : 0} idea={thread.card.id} title={ideaPresentation(thread.card).title} onClose={trial.close}/>;
  return <main class="ideas-page">
    <header class="ideas-top"><a href="/">← Back to Plunge</a></header>
    <div class="ideas-heading"><div><h1>Ideas for Plunge</h1><p>A family game, built by the family.</p></div><FamilyTableArt/></div>
    {QUESTIONS_LOCAL_ONLY && !name ? <section class="idea-paper"><h2>Your real family ideas</h2><p>Use your Plunge account to explore this dashboard with your family’s ideas.</p>
      <PreviewSignIn />
      {token && !error && <p role="status">Opening your family ideas…</p>}
      <p><a href={ideasLink(selected ?? undefined)} target="_blank" rel="noopener noreferrer">Open ideas in the main game ↗</a></p></section>
    : !name ? <section class="idea-paper"><h2>Come on in</h2><p>Sign in to use family access Jason has granted you.</p><a class="big-btn" href={`/?account=1${selected?`&ideaReturn=${selected}`:'&ideasReturn=1'}`}>Open your account</a><details><summary>Have a personal invite instead?</summary><p>You can still paste your invite here.</p>
      <form onSubmit={enter}><label>Your invite link<input autoComplete="off" type="password" value={invite} onInput={e=>setInvite(e.currentTarget.value)} /></label><button class="big-btn" type="submit">Open my ideas</button></form></details>
      {token && !error && <p role="status">Opening your ideas…</p>}</section>
    : <>
      {QUESTIONS_LOCAL_ONLY && <aside class="demo-banner"><strong>Dashboard demo · real family ideas</strong><p>You’re signed in as {name}. Ideas and replies here go to the family. Game progress stays in this preview.</p>
        <button class="text-btn" type="button" disabled={busy} onClick={()=>{clearPreviewSession();setToken('');setName('');setOwner(false);setCards([]);setThread(null);setSaved('');setError('');}}>Disconnect demo</button></aside>}
      <div class="ideas-welcome"><p>Hi, {name}.</p><button class="big-btn share-idea" type="button" disabled={busy} onClick={()=>{open(null);setAdding(true);}}>＋ Share an idea</button></div>
      {selected ? <>
        <button class="text-btn" type="button" disabled={busy} onClick={()=>open(null)}>← All ideas</button>
        {thread ? <section class="idea-paper"><div class="idea-meta"><span class="idea-meta-who"><IdeaDomino number={thread.card.number} status={thread.card.status}/>{thread.card.name}’s idea</span><span>Idea {thread.card.number}</span></div>
          <h2>{ideaPresentation(thread.card).title}</h2>
          <IdeaJourney status={thread.card.status}/>
          <ul class="idea-tags" aria-label="Topics">{ideaPresentation(thread.card).tags.map(tag=><li key={tag}>{tag}</li>)}</ul>
          <IdeaLink key={thread.card.id} id={thread.card.id} busy={busy}/>
          {accepting ? <p role="status" class="idea-notice">{thread.release!.note}</p> : <IdeaActivity card={thread.card} now={now} connected={connected} />}
          {thread.release?.status==='blocked' && thread.release.revision===thread.card.revision && thread.release.sha===thread.card.sha && thread.card.status!=='shipped' && <p role="status" class="idea-notice">{thread.release.note}</p>}
          {thread.card.status==='ready' && !accepting && <section class="idea-approval" aria-label="Accept this preview">
            {owner ? QUESTIONS_LOCAL_ONLY ? <a class="big-btn" href={ideasLink(thread.card.id)} target="_blank" rel="noopener noreferrer">Open the main game to accept</a> : <>
              <button class="big-btn" type="button" disabled={busy} onClick={()=>void accept()}>Accept into the game</button>
              <p class="idea-help">Use the preview you tried in everyone’s game. The card will show when it is live.</p>
            </> : <p class="idea-help">Jason can accept this preview into everyone’s game from his account.</p>}
          </section>}
          {thread.card.status==='shipped' && <a class="big-btn" href={LIVE_PLUNGE}>Play the updated game</a>}
          {thread.card.status==='iced' && <button class="big-btn" type="button" disabled={busy} onClick={()=>void wake()}>Wake it up</button>}
          {hasIdeaDemo(thread.card) && <IdeaLink key={`${thread.card.id}:demo`} id={thread.card.id} preview busy={busy} onOpen={()=>trial.open(thread.card.id)}/>}
          <p class="idea-help">You can ask a question or clarify your idea below. {thread.card.lane==='hand' ? 'Jason is making this change by hand. Your replies go straight to him.' : thread.card.status==='building' ? 'Replies will be picked up when this pass finishes.' : 'You can say “let’s talk it through first” before asking for changes.'}</p>
          <ol class="idea-conversation" aria-label="Conversation">{thread.messages.map(message=><li key={message.id} class={message.role}><strong>{message.name}</strong><p>{message.body}</p><div class="screenshot-drafts">{message.screenshots?.map(image=><Screenshot key={image.id} image={image} token={token}/>)}</div><IdeaResult thread={thread} message={message} busy={busy} onTry={()=>trial.open(thread.card.id)} /></li>)}</ol>
          {owner && thread.card.lane!=='hand' && <section class="idea-approval" aria-label="Builder access"><h3>Builder access</h3>
            {thread.permissions?.scope==='repository' ? <p>Full project access is approved for this request.</p> : <>
              <p>Allow the builder to change any project file for the conversation above. New family replies need a fresh approval.</p>
              <button class="big-btn secondary" type="button" disabled={busy || !['queued','question','failed'].includes(thread.card.status)} onClick={()=>void approve()}>Approve full access</button>
              {thread.card.status==='building' && <p class="idea-help">You can approve when the current build finishes.</p>}
            </>}
          </section>}
          {accepting ? <p class="idea-help">You can add another reply after the release finishes. Any draft stays saved on this device.</p> : <Composer key={selected} token={token} selected={selected} onBusy={setBusy} onSent={sent} onError={setError} />}
        </section> : <p role="status">Opening that idea…</p>}
      </> : <>
        <IdeasBoard view={boardView} onView={setBoardView} cards={cards} loaded={loaded} busy={busy} now={now} connected={connected} onOpen={open} onTry={id=>{open(id);trial.open(id);}} />
        {next && <button class="big-btn secondary ideas-more" type="button" disabled={busy} onClick={()=>void more()}>Earlier ideas</button>}
        <section ref={newIdea} tabIndex={-1} class="idea-paper new-idea" aria-labelledby="new-idea-title"><div class="new-idea-head"><SparkTile/><div><h2 id="new-idea-title">What would make the game better?</h2><p>Say it like you would at the table.</p></div></div>
          <Composer key="new" token={token} selected={null} onBusy={setBusy} onSent={sent} onError={setError} />
          <p class="idea-help">We’ll make a version for you to try, then keep talking on your card.</p>
        </section>
      </>}
      <p class="idea-help ideas-foot">Everyone in the family can add their voice. Changes are reviewed before they join everyone’s game.</p>
    </>}
    {saved && <p role="status" class="idea-notice">{saved}</p>}
    {error && <p role="alert" class="idea-error">{error} Your unsent reply stays here.</p>}
  </main>;
}
