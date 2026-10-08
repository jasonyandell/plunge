import { useEffect, useRef, useState } from 'preact/hooks';
import { IDEA_ID, previewFor } from './model';

function trialFromHash(): string|null {
  const params=new URLSearchParams(location.hash.slice(1));
  const id=params.get('idea');
  return params.get('try')==='1' && id && IDEA_ID.test(id) ? id : null;
}
/** Keep Back/Forward inside the stable app, including a reloaded preview link. */
export function useIdeaPreview() {
  const [id,setId]=useState(trialFromHash);
  useEffect(()=>{
    const changed=()=>setId(trialFromHash());
    window.addEventListener('popstate',changed);window.addEventListener('hashchange',changed);
    return ()=>{window.removeEventListener('popstate',changed);window.removeEventListener('hashchange',changed);};
  },[]);
  return {id,open:(idea:string)=>{
    history.pushState(null,'',`${location.pathname}${location.search}#idea=${idea}&try=1`);setId(idea);
  },close:()=>{
    // A child game can add history entries (for example, opening family rooms).
    // Explicit return must close it immediately rather than stepping through those.
    const params=new URLSearchParams(location.hash.slice(1));params.delete('try');
    history.replaceState(null,'',`${location.pathname}${location.search}#${params}`);setId(null);
  }};
}

export function IdeaPreview({pr,title,onClose}:{pr:number;title:string;onClose:()=>void}) {
  const [attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true),[slow,setSlow]=useState(false);
  const back=useRef<HTMLButtonElement>(null);
  useEffect(()=>{back.current?.focus();},[]);
  useEffect(()=>{
    if(!loading)return;
    const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);
  },[loading,attempt]);
  const valid=Number.isSafeInteger(pr)&&pr>0;
  return <section class="idea-trial" aria-label={`Try your change: ${title}`}>
    <header class="idea-trial-bar"><button ref={back} class="idea-trial-back" onClick={onClose}>← Back to your idea</button><span>Trying a change</span></header>
    {!valid ? <p class="idea-trial-notice" role="alert">This preview isn’t available. Go back to your idea to check for an update.</p> : <>
      {loading && <p class="idea-trial-notice" role="status">{slow?'The game is taking a while to open. You can try again or go back to your idea.':'Opening your game…'}</p>}
      {slow && <button class="idea-trial-back" onClick={()=>{setSlow(false);setLoading(true);setAttempt(n=>n+1);}}>Try again</button>}
      <iframe key={attempt} title={`Try your change: ${title}`} src={previewFor(pr)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        onLoad={()=>{setLoading(false);setSlow(false);}} />
    </>}
  </section>;
}
