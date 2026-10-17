import { useEffect, useState } from 'preact/hooks';
import { ideasLink } from '../ideas/client';
import { Table } from './Table';
import { VictoryPicture } from './VictoryPicture';
import { BramConcept } from './BramConcept';
import { useDealFlourish } from './Shuffle';
import { pendingAiSeat, reducer, type AppEvent } from './store';
import { SHOWCASE_ID, TOUR_STEPS, showcaseGame, showcaseLink, tourStep } from './scifigoofy-tour';
import { NOTES_KEY, NOTE_LIMIT, parseNotes, feedbackText } from './showcase-notes';
import './showcase.css';

/** A real, disposable table: no GameApp, save, history, account or room effects. */
export function ScifigoofyShowcase({onClose}:{onClose:()=>void}) {
  const [step,setStep]=useState(()=>tourStep(location.search));
  const [app,setApp]=useState(showcaseGame),[replay,setReplay]=useState(0);
  const [playing,setPlaying]=useState(false),[paused,setPaused]=useState(false),[blossoms,setBlossoms]=useState(true);
  const [won,setWon]=useState(true),[notice,setNotice]=useState(''),[shareUrl,setShareUrl]=useState('');
  const [notes,setNotes]=useState(()=>{try{return parseNotes(localStorage.getItem(NOTES_KEY));}catch{return {};}});
  const [noteStatus,setNoteStatus]=useState('Notes stay in this browser until you copy them.');
  const [copiedNotes,setCopiedNotes]=useState('');
  const feature=TOUR_STEPS[step]!;
  const noteKey=playing?'sample':feature.key;
  const hasNotes=Object.values(notes).some(text=>text.trim());
  const shuffling=useDealFlourish(app);
  const editNote=(body:string)=>{
    const next={...notes,[noteKey]:body.slice(0,NOTE_LIMIT)};setNotes(next);setCopiedNotes('');
    try{localStorage.setItem(NOTES_KEY,JSON.stringify(next));setNoteStatus('Saved on this device. Nothing has been sent.');}
    catch{setNoteStatus('Not saved: browser storage is unavailable. Keep this page open and copy your notes.');}
  };
  const copyNotes=async()=>{
    const text=feedbackText(notes,showcaseLink(location.origin));setCopiedNotes(text);
    try{await navigator.clipboard.writeText(text);setNoteStatus('All notes copied. Paste them into our idea conversation when you’re ready.');}
    catch{setNoteStatus('Select and copy the notes below. They have not been sent.');}
  };
  const reset=()=>{setApp(showcaseGame());setReplay(n=>n+1);setPaused(false);};
  const move=(next:number)=>{
    setStep(next);setPlaying(false);setBlossoms(true);setWon(true);setNotice('');reset();
    history.pushState(null,'',showcaseLink(location.origin,next));
  };
  useEffect(()=>{
    const back=()=>{setStep(tourStep(location.search));setPlaying(false);setBlossoms(true);reset();};
    window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);
  },[]);
  useEffect(()=>{
    if(!playing || paused)return;
    const event:AppEvent|null=app.showTrick ? {type:'trick-shown',epoch:app.epoch}
      : pendingAiSeat(app)!==null ? {type:'ai',epoch:app.epoch} : null;
    if(!event)return;
    const timer=setTimeout(()=>setApp(current=>reducer(current,event)),app.showTrick?1100:550);
    return()=>clearTimeout(timer);
  },[app,playing,paused]);
  const dispatch=(event:AppEvent)=>{
    if(event.type==='go'){setPlaying(false);reset();return;}
    if(playing && paused)return;
    if(playing || event.type==='human')setApp(current=>reducer(current,event));
  };
  const share=async(current=false)=>{
    const url=showcaseLink(location.origin,current?step:undefined);setShareUrl(url);
    if(navigator.share){try{await navigator.share({title:'Scifigoofy’s Plunge playground',url});setNotice('Share sheet opened.');return;}
      catch(error){if(error instanceof Error && error.name==='AbortError'){setNotice('Link ready below.');return;}}}
    try{await navigator.clipboard.writeText(url);setNotice(current?'Link to this step copied.':'Whole-tour link copied.');}
    catch{setNotice('Select and copy the link below.');}
  };
  const birds=playing || feature.key==='birdwatch';
  const played=(app.game?.currentTrick.length??0)>0;
  return <main class={`showcase${paused?' showcase-paused':''}${blossoms?'':' showcase-no-blossoms'}`}>
    <header class="showcase-top"><a href="/?play=1" onClick={event=>{event.preventDefault();onClose();}}>← Full game</a><span>Made together</span><button onClick={()=>void share()}>Share tour</button></header>
    <div class="showcase-layout">
      <section class="showcase-guide" aria-label="Feature tour">
        <p class="showcase-eyebrow">Scifigoofy’s playground · {playing?'Sample game':`${step+1} of ${TOUR_STEPS.length}`}</p>
        <h1>{playing?'Try them together':feature.title}</h1>
        <p class="showcase-description">{playing?'Play a sample hand with the blossoms and pause visitors. Your regular game and stats stay untouched. The Bram sketch is still a proposal.':feature.text}</p>
        <nav class="showcase-steps" aria-label="Choose a tour step">{TOUR_STEPS.map((item,index)=><button aria-label={`${index+1}. ${item.short}`} aria-current={!playing && index===step?'step':undefined} onClick={()=>move(index)}>{index+1}</button>)}</nav>
        <div class="showcase-actions">
          {!playing && feature.key==='blossoms' && <button onClick={()=>setBlossoms(value=>!value)}>{blossoms?'Hide blossoms':'Show blossoms'}</button>}
          {!playing && feature.key==='shuffle' && <><button onClick={reset}>Replay shuffle</button><button aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?'Resume animation':'Pause animation'}</button></>}
          {!playing && feature.key==='birdwatch' && <button onClick={reset}>Replay visit</button>}
          {!playing && feature.key==='victory' && <button onClick={()=>setWon(value=>!value)}>{won?'Let the other team win':'Let your team win'}</button>}
          {!playing && feature.key==='bram' && <button onClick={()=>{setPlaying(true);reset();}}>Play the sample hand</button>}
          {playing && <><button onClick={reset}>Restart sample hand</button><button aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?'Resume game':'Pause game'}</button></>}
        </div>
        {!playing && feature.key==='birdwatch' && <p class="showcase-status" role="status">{played?'Off they go! Replay the visit to bring them back.':'Tap a highlighted domino when you’re ready.'}</p>}
        <div class="showcase-paging"><button disabled={!playing && step===0} onClick={()=>move(playing?step:step-1)}>← {playing?'Back to tour':'Back'}</button>
          {!playing && step<TOUR_STEPS.length-1 && <button onClick={()=>move(step+1)}>Next →</button>}
        </div>

      </section>
      <section class="showcase-stage" aria-label="Live game preview">
        <div class="showcase-scene-label">{playing?'Practice hand':'Interactive preview · sample hand'}</div>
        <Table key={`${step}:${replay}:${playing}`} app={app} dispatch={dispatch} onQuestion={()=>{}} demo
          shuffling={playing?shuffling:feature.key==='shuffle'} birdwatchEnabled={birds} birdwatchDemo={!playing && birds}/>
        {!playing && feature.key==='victory' && <div class="showcase-scene-overlay"><div class="showcase-win">
          <p class="showcase-eyebrow">Sample game result</p><h2>{won?'Your team wins!':'The other team wins!'}</h2><VictoryPicture won={won}/><p>A celebration for either winning team.</p>
        </div></div>}
        {!playing && feature.key==='bram' && <div class="showcase-scene-overlay"><div class="showcase-bram"><span>Concept · awaiting your feedback</span><BramConcept/><p>A friendly face at the table.</p></div></div>}
      </section>
      <section class="showcase-feedback-panel" aria-label="Share and discuss">
        <label class="showcase-note-label">Your notes · {playing?'Sample game':feature.short}
          <textarea value={notes[noteKey]??''} maxLength={NOTE_LIMIT} placeholder="What do you like? What would you change?" onInput={event=>editNote(event.currentTarget.value)}/>
        </label>
        <p class="showcase-small" role="status">{noteStatus}</p>
        <button disabled={!hasNotes} onClick={()=>void copyNotes()}>Copy all feedback</button>
        {copiedNotes && <label class="showcase-note-label">Feedback to copy<textarea aria-label="Feedback to copy" value={copiedNotes} readOnly onFocus={event=>event.currentTarget.select()}/></label>}
        <a class="showcase-feedback" href={ideasLink(SHOWCASE_ID)}>Suggest a change to this collection →</a>
        <p class="showcase-small">One conversation for all five ideas. Paste your feedback there, or send the copied notes to Jason. Family sign-in is needed to post on the board.</p>
        <button class="showcase-text" onClick={()=>void share(true)}>Share this step</button>
        {notice && <p role="status" class="showcase-small">{notice}</p>}
        {shareUrl && <label class="showcase-share-label">Link to share<input aria-label="Link to share" type="url" value={shareUrl} readOnly onFocus={event=>event.currentTarget.select()}/></label>}
      </section>
    </div>
  </main>;
}
