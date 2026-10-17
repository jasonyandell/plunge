import { useEffect, useRef, useState } from 'preact/hooks';
import { Composer } from './Composer';
import { MarkScreenshot } from './IdeaScreenshots';
import { captureScreen } from './capture-screen';
import { initialToken, ideasLink, inviteToken, readDraft, TOKEN_KEY } from './client';
import { draftStore, type PictureDraft } from './screenshot-client';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import './ideas.css';

const DRAFT = 'plunge:idea-draft:screen';
export const openScreenIdea = () => window.dispatchEvent(new Event('plunge-screen-idea'));

/** Kept beside the app, so opening feedback never unmounts an ongoing game. */
export function QuickIdea() {
  const [open, setOpen] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    let press: {id:number;x:number;y:number} | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releasedUntil = 0, held = false;
    const cancel = () => { clearTimeout(timer); press = null; };
    const launch = () => {
      cancel();
      if (active.current) return;
      active.current = true;
      window.dispatchEvent(new CustomEvent('plunge-idea-active', {detail:true}));
      setOpen(true);
    };
    const trigger = () => {
      if (!press) return;
      held = true;
      window.getSelection()?.removeAllRanges();
      launch();
    };
    const down = (event:PointerEvent) => {
      // A new deliberate press must not be swallowed by the previous hold.
      releasedUntil = 0;
      if (!event.isPrimary) { cancel(); return; }
      if (active.current || event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest('input,textarea,select,canvas,.screenshot-dialog,[contenteditable]:not([contenteditable="false"]),[data-idea-tools]')) return;
      press = {id:event.pointerId,x:event.clientX,y:event.clientY};
      timer = setTimeout(trigger, 600);
    };
    const move = (event:PointerEvent) => {
      if (press && (event.pointerId !== press.id || Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)) cancel();
    };
    const up = () => { cancel(); if (held) {held=false;releasedUntil=Date.now()+800;} };
    const click = (event:MouseEvent) => {
      if (event.detail && (held || Date.now()<releasedUntil)) {
        event.preventDefault();event.stopImmediatePropagation();releasedUntil=0;held=false;
      }
    };
    const menu = (event:MouseEvent) => {
      if (press || held || Date.now()<releasedUntil) { event.preventDefault(); trigger(); }
    };
    document.addEventListener('pointerdown',down,true);
    document.addEventListener('pointermove',move,true);
    document.addEventListener('pointerup',up,true);
    document.addEventListener('pointercancel',up,true);
    document.addEventListener('click',click,true);
    document.addEventListener('contextmenu',menu,true);
    document.addEventListener('scroll',cancel,true);
    window.addEventListener('blur',cancel);
    window.addEventListener('plunge-screen-idea',launch);
    return () => {
      cancel();
      document.removeEventListener('pointerdown',down,true);
      document.removeEventListener('pointermove',move,true);
      document.removeEventListener('pointerup',up,true);
      document.removeEventListener('pointercancel',up,true);
      document.removeEventListener('click',click,true);
      document.removeEventListener('contextmenu',menu,true);
      document.removeEventListener('scroll',cancel,true);
      window.removeEventListener('blur',cancel);
      window.removeEventListener('plunge-screen-idea',launch);
    };
  }, []);
  return <>
    <button type="button" data-idea-tools class="screen-idea-shortcut" onClick={openScreenIdea}>Share an idea about this screen</button>
    {open && <ScreenIdea onClose={()=>{
      setOpen(false);active.current=false;
      window.dispatchEvent(new CustomEvent('plunge-idea-active',{detail:false}));
    }}/>}
  </>;
}

function ScreenIdea({onClose}:{onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft,setDraft] = useState<PictureDraft|null>(null), [mark,setMark] = useState(false);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [saved,setSaved] = useState('');
  const [resumed,setResumed] = useState(false);
  const [token,setToken] = useState(initialToken), [invite,setInvite] = useState('');
  useEffect(()=>{
    const focus = document.activeElement;
    let disposed=false;
    // Clone the screen before displaying the feedback dialog.
    const picture = captureScreen().catch(()=>null);
    dialog.current?.showModal();
    void Promise.all([draftStore(DRAFT).catch(()=>({...readDraft(DRAFT),screenshots:[]})),picture]).then(([previous,image])=>{
      if(disposed)return;
      if(previous && (previous.body || previous.screenshots.length)) {
        setDraft(previous);setResumed(true);
        return;
      }
      if(!image)setError('This browser could not capture the screen. You can still describe it or add a screenshot.');
      setDraft({id:crypto.randomUUID().replaceAll('-',''),body:'',screenshots:image?[image]:[]});
      setMark(!!image);
    });
    return()=>{disposed=true;if(focus instanceof HTMLElement && focus.isConnected)focus.focus();};
  },[]);
  return <dialog ref={dialog} data-idea-tools class="screenshot-dialog idea-paper screen-idea-dialog" aria-labelledby="screen-idea-title"
    onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();if(!busy)onClose();}}>
    <h2 id="screen-idea-title">An idea about this screen</h2>
    {saved ? <><p role="status">{saved==='preview'?'Saved on this device for this preview. Nothing was sent to the family.':'Your idea was sent. You can follow the conversation on your card.'}</p>
      {saved!=='preview' && <a href={ideasLink(saved)} target="_blank" rel="noopener noreferrer">Open your idea card</a>}
      {saved==='preview' && <button type="button" class="text-btn" disabled={busy} onClick={async()=>{
        setBusy(true);
        try{await draftStore(DRAFT,null);localStorage.removeItem(DRAFT);onClose();}
        catch{setError('Could not clear this draft. Please try again.');}
        finally{setBusy(false);}
      }}>Clear preview draft</button>}
    </> : <>
      <p>Mark what you mean, then add a few words. You can also describe it without drawing.</p>
      {resumed && <p role="status">Your unfinished idea is here, with the picture you saved earlier.</p>}
      {!draft ? <p role="status">Taking a picture of the screen…</p> : !mark && <Composer token={token} selected={null} startingDraft={draft} storageKey={DRAFT}
        onBusy={setBusy} onError={setError} onSent={thread=>setSaved(thread.card.id)} onPreviewSaved={()=>setSaved('preview')}/>}
      {!QUESTIONS_LOCAL_ONLY && <details><summary>Need family access?</summary>
        <p><a href="/?account=1" target="_blank" rel="noopener noreferrer">Sign in in another tab</a>, then try sending again. Or paste your personal invite here.</p>
        <label>Invite link<input type="password" autoComplete="off" value={invite} onInput={event=>setInvite(event.currentTarget.value)} /></label>
        <button type="button" class="big-btn secondary" disabled={busy} onClick={()=>{
          const next=inviteToken(invite);
          if(!next){setError('Paste the invite link shared with you.');return;}
          try{localStorage.setItem(TOKEN_KEY,next);}catch{/* Visit-only access. */}
          setToken(next);setInvite('');setError('');
        }}>Use invite</button>
      </details>}
    </>}
    {error && <p role="alert" class="idea-error">{error}</p>}
    <button type="button" class="big-btn secondary" disabled={busy} autoFocus onClick={onClose}>{saved?'Back to Plunge':'Close · keep draft'}</button>
    {mark && draft?.screenshots[0] && <MarkScreenshot picture={draft.screenshots[0]} onError={setError} onCancel={()=>setMark(false)} onDone={picture=>{
      // Start the composer with the marked picture before any typing begins.
      setDraft({...draft,screenshots:[picture]});setMark(false);
    }}/>}
  </dialog>;
}
