import { useState } from 'preact/hooks';
import { newId, readDraft } from './client';
import type { IdeaThread } from './model';
import '../ui/app.css';
import '../ui/home.css';
import './ideas.css';

const STORAGE = 'plunge:ideas-demo:v1';
const BID_ID = '00000000000000000000000000000022';
const BID_PREVIEW = 'https://plunge-pr-22.texas42.workers.dev/';
const seed: IdeaThread = {
  card: {id:BID_ID,number:1,name:'Mom',title:'I can’t see what I bid.',context:'Demo example',created:'',updated:'',revision:1,status:'ready',pr:22,sha:'4a69d54ac8d9cb1fff8d86e05838f1c57c269181',preview:BID_PREVIEW},
  messages:[
    {id:'example-1',role:'family',name:'Mom · example',body:'When I’m the bidder, I can’t see what I bid. Could it stay beside my dominoes?',created:''},
    {id:'example-2',role:'builder',name:'Builder · example',body:'Your bid now sits next to “You,” beside your hand. If you win the bidding, it stays there while you play. It works with hints turned off, too. Try the game and tell us how it feels.',created:''},
  ],
};
function initialCards(): IdeaThread[] {
  try { const saved=JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if(Array.isArray(saved) && saved.length && saved.every(t=>t?.card?.id && typeof t.card.title==='string' && Array.isArray(t.messages))) return saved;
  } catch { /* The example works without storage. */ }
  return [seed];
}

/** A browser-only walkthrough. Never calls the ideas service or starts a build. */
export function IdeasDemo() {
  const [cards,setCards]=useState(initialCards),[person,setPerson]=useState('Mom');
  const [selected,setSelected]=useState<string|null>(BID_ID),[playing,setPlaying]=useState(false),[notice,setNotice]=useState('');
  const current=cards.find(t=>t.card.id===selected);
  const save=(next:IdeaThread[])=>{
    setCards(next);
    try {localStorage.setItem(STORAGE,JSON.stringify(next));setNotice('Saved in this browser’s demo.');}
    catch {setNotice('Saved for this visit. This browser could not keep a copy for later.');}
  };
  const send=(body:string)=>{
    const message={id:newId(),role:'family' as const,name:person,body,created:new Date().toISOString()};
    if(current) save(cards.map(t=>t.card.id===current.card.id?{...t,messages:[...t.messages,message]}:t));
    else {
      const id=newId();
      save([...cards,{card:{...seed.card,id,number:cards.length+1,name:person,title:body,pr:null,sha:null,preview:null,status:'queued',created:message.created},messages:[message]}]);
      setSelected(id);
    }
  };
  if(playing) return <div class="demo-play">
    <header class="idea-preview-bar"><button class="text-btn" onClick={()=>setPlaying(false)}>← Back to your idea</button><span>Bidding fix · playable preview</span>
      <a href={BID_PREVIEW} target="_blank" rel="noopener noreferrer">Open full screen ↗</a></header>
    <p class="demo-play-help">Start a game and place a bid. Look beside “You” above your dominoes. Come back here to reply.</p>
    <iframe title="Try the bidding visibility fix" src={BID_PREVIEW} />
  </div>;
  return <main class="ideas-page">
    <header class="ideas-top"><a href="/">← Back to Plunge</a><span>Made together</span></header>
    <aside class="demo-banner"><strong>Try the family ideas demo</strong><p>Sample conversation, real playable fix. Messages stay in this browser; demo replies don’t start builds.</p></aside>
    <div class="ideas-heading"><p class="eyebrow">Your seat at the drawing table</p><h1>Ideas for Plunge</h1><p>Little fixes. Big ideas. A game that feels more like ours.</p></div>
    <div class="ideas-welcome"><div><p>Hi, {person}.</p><div class="demo-people" role="group" aria-label="Try the demo as">
      {['Mom','Dad'].map(name=><button type="button" aria-pressed={person===name} onClick={()=>setPerson(name)} key={name}>{name}</button>)}
    </div></div><button class="big-btn secondary" onClick={()=>{setSelected(null);setNotice('');}}>＋ Another idea</button></div>
    {current ? <>
      <button class="text-btn" onClick={()=>{setSelected(null);setNotice('');}}>← All ideas</button>
      <section class="idea-paper"><div class="idea-meta"><span>{current.card.name}’s idea</span><span class={`idea-status ${current.card.id===BID_ID?'ready':'queued'}`}>{current.card.id===BID_ID?'Ready to try':'Demo idea saved'}</span></div>
        <h2>{current.card.title}</h2>
        {current.card.id===BID_ID ? <>
          <ol class="demo-steps" aria-label="Example progress"><li>Idea shared</li><li>Change built</li><li>Ready to try</li></ol>
          <div class="demo-bid-example" aria-label="Illustration of the bidding fix"><div><small>Before</small><span>You</span></div><span aria-hidden="true">→</span><div><small>With your idea</small><span>You <b>Bid 30</b></span></div></div>
          <p class="idea-help">Your winning bid stays beside your hand. The example above illustrates the change; the button opens the actual game.</p>
          <button class="big-btn" onClick={()=>setPlaying(true)}>Try your change →</button>
          <a class="demo-details" href="https://github.com/jasonyandell/plunge/pull/22" target="_blank" rel="noopener noreferrer">See the change on GitHub ↗</a>
        </> : <p class="idea-help">In the live version, this would automatically join the builder’s queue. Here you can try the conversation.</p>}
        <ol class="idea-conversation">{current.messages.map(m=><li key={m.id} class={m.role}><strong>{m.name}</strong><p>{m.body}</p></li>)}</ol>
        <DemoComposer key={`${person}:${current.card.id}`} person={person} id={current.card.id} onSend={send}/>
      </section>
    </> : <>
      <section class="idea-paper"><h2>What would make the game better?</h2><p>Say it just like you would at the table.</p><DemoComposer key={`${person}:new`} person={person} id="new" onSend={send}/></section>
      <h2 class="ideas-board-title">Around the table</h2><div class="ideas-grid">{cards.map(t=><button class="idea-paper idea-card" key={t.card.id} onClick={()=>{setSelected(t.card.id);setNotice('');}}>
        <span class="idea-meta">{t.card.name} · Idea {t.card.number}</span><h3>{t.card.title}</h3><span class={`idea-status ${t.card.id===BID_ID?'ready':'queued'}`}>{t.card.id===BID_ID?'Ready to try':'Demo idea saved'}</span><span class="idea-open">Open conversation →</span>
      </button>)}</div>
    </>}
    {notice && <p class="idea-notice" role="status">{notice}</p>}
    <p class="idea-help">Try replying as Mom, then switch to Dad and add another idea. In the live version, each person uses their own invite and the family shares the cards.</p>
  </main>;
}
function DemoComposer({person,id,onSend}:{person:string;id:string;onSend:(body:string)=>void}) {
  const key=`plunge:ideas-demo-draft:${person}:${id}`;
  const [body,setBody]=useState(()=>readDraft(key).body);
  const edit=(value:string)=>{setBody(value);try{localStorage.setItem(key,JSON.stringify({id:'00000000000000000000000000000000',body:value}));}catch{/* Keep this visit's draft. */}};
  return <form onSubmit={event=>{event.preventDefault();if(!body.trim())return;onSend(body.trim());edit('');}}>
    <label>{id==='new'?'Your idea':'Keep the conversation going'}<textarea value={body} maxLength={3000} onInput={e=>edit(e.currentTarget.value)} placeholder={id==='new'?'Could the score be easier to read?':'That helps! Could the bid be bigger?'} /></label>
    <button class="big-btn" disabled={!body.trim()}>{id==='new'?'Make an idea card':'Send reply'}</button>
  </form>;
}
