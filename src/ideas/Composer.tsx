import { useEffect, useRef, useState } from 'preact/hooks';
import { deviceContext, ideasApi, newId, readDraft } from './client';
import type { IdeaThread } from './model';
import { MAX_SCREENSHOTS } from './screenshots';
import { draftStore, preparePicture, screenshotUrl, type PictureDraft } from './screenshot-client';
import { MarkScreenshot } from './IdeaScreenshots';
export function Composer({token,selected,onBusy,onSent,onError}: {
  token:string;selected:string|null;onBusy:(busy:boolean)=>void;onSent:(thread:IdeaThread)=>void;onError:(error:string)=>void;
}) {
  const key=`plunge:idea-draft:${selected ?? 'new'}`;
  const [draft,setDraft]=useState<PictureDraft>(()=>({...readDraft(key),screenshots:[]})),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[mark,setMark]=useState<number|null>(null);
  const [notice,setNotice]=useState('');const writes=useRef(Promise.resolve()),picker=useRef<HTMLInputElement>(null);
  useEffect(()=>{let disposed=false;void draftStore(key).then(saved=>{if(!disposed)setDraft(saved);}).catch(()=>{if(!disposed)setNotice('Your browser cannot save this draft. Keep this page open until you send it.');}).finally(()=>{if(!disposed)setLoaded(true);});return()=>{disposed=true;};},[key]);
  const edit=(next:PictureDraft)=>{
    setDraft(next);try{localStorage.setItem(key,JSON.stringify({id:next.id,body:next.body}));}catch{/* IndexedDB also keeps the text. */}
    writes.current=writes.current.then(()=>draftStore(key,next)).then(()=>{}).catch(()=>setNotice('Your browser could not save this draft. Keep this page open until you send it.'));
  };
  const lock=(value:boolean)=>{setBusy(value);onBusy(value);};
  const add=async(file?:File)=>{
    if(!file||busy||!loaded||draft.screenshots.length>=MAX_SCREENSHOTS)return;lock(true);onError('');
    try{const image=await preparePicture(file);edit({...draft,screenshots:[...draft.screenshots,image]});}catch(e){onError(e instanceof Error?e.message:'Could not open that picture.');}finally{lock(false);}
  };
  const send=async(event:Event)=>{
    event.preventDefault();if(busy||!loaded||(!draft.body.trim()&&!draft.screenshots.length))return;lock(true);onError('');
    try {
      await writes.current;
      const result=await ideasApi<IdeaThread>(token,`/${selected ?? draft.id}${selected ? '/messages' : ''}`,{id:draft.id,body:draft.body,screenshots:draft.screenshots,context:deviceContext()});
      try{await draftStore(key,null);localStorage.removeItem(key);}catch{/* Already saved on server. */}
      setDraft({id:newId(),body:'',screenshots:[]});setNotice('');onSent(result);
    }catch(e){onError(e instanceof Error?e.message:'Could not save. Please retry.');}
    finally{lock(false);}
  };
  return <form onSubmit={send}><label>{selected?'Keep the conversation going':'Your idea'}
    <textarea disabled={busy||!loaded} value={draft.body} maxLength={3000} placeholder={selected?'That helps! Could the letters be bigger?':'I can’t see my bid.'} onInput={e=>edit({...draft,body:e.currentTarget.value})}/>
    </label>
    <div class="screenshot-drafts">{draft.screenshots.map((picture,index)=><div class="screenshot-draft" key={index}><img src={screenshotUrl(picture)} alt={`Screenshot ${index+1} to send`}/><div class="screenshot-actions">
      <button class="text-btn" type="button" disabled={busy} onClick={()=>{setMark(index);onBusy(true);}}>Mark where you mean</button><button class="text-btn" type="button" disabled={busy} onClick={()=>edit({...draft,screenshots:draft.screenshots.filter((_,i)=>i!==index)})}>Remove screenshot {index+1}</button></div></div>)}</div>
    <input ref={picker} type="file" disabled={busy||!loaded} accept="image/png,image/jpeg,image/webp" hidden aria-label="Choose screenshot" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void add(file);}}/>
    <button class="big-btn secondary" type="button" disabled={busy||!loaded||draft.screenshots.length>=MAX_SCREENSHOTS} onClick={()=>picker.current?.click()}>Add a screenshot</button>
    <p class="idea-help">Show us what you mean. Add up to two pictures, and mark a spot if you like. Your family can see them.</p>
    {notice && <p role="status">{notice}</p>}
    <button class="big-btn" disabled={busy||!loaded||(!draft.body.trim()&&!draft.screenshots.length)}>{busy?'Saving…':selected?'Send reply':'Make an idea card'}</button>
    {mark!==null && draft.screenshots[mark] && <MarkScreenshot picture={draft.screenshots[mark]!} onError={onError} onCancel={()=>{setMark(null);onBusy(false);}} onDone={picture=>{edit({...draft,screenshots:draft.screenshots.map((old,i)=>i===mark?picture:old)});setMark(null);onBusy(false);}}/>}
  </form>;
}
