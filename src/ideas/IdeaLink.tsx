import { useState } from 'preact/hooks';
import { ideasLink } from './client';

/** Share only the idea address, never the current page's invite or account data. */
export function IdeaLink({id,preview=false,busy,onOpen}: {
  id:string;preview?:boolean;busy:boolean;onOpen?:()=>void;
}) {
  const [notice,setNotice]=useState(''),[showLink,setShowLink]=useState(false);
  const label=preview?'demo':'idea';
  const fragment=`#idea=${id}${preview?'&try=1':''}`;
  const url=ideasLink(id)+(preview?'&try=1':'');
  const copy=async()=>{
    try {
      await navigator.clipboard.writeText(url);
      setShowLink(false);setNotice(`${preview?'Demo':'Idea'} link copied.`);
    } catch {
      setShowLink(true);setNotice('Select and copy the link below.');
    }
  };
  return <div class="idea-share">
    <div class="idea-share-actions">
      <a class={preview?'big-btn':'idea-share-link'} href={`/?ideas=1${fragment}`} aria-disabled={busy || undefined} onClick={event=>{
        if(busy){event.preventDefault();return;}
        if(onOpen && event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey){event.preventDefault();onOpen();}
      }}>{preview?'Try your change →':'Link to this idea'}</a>
      <button class="text-btn" type="button" disabled={busy} onClick={()=>void copy()}>Copy {label} link</button>
    </div>
    {notice && <p class="idea-help" role="status">{notice}</p>}
    {showLink && <label>{preview?'Demo':'Idea'} link<input type="url" readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label>}
  </div>;
}
