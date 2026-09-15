/** Anonymous question notebook. The live game pauses while this dialog is open. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { decodeReplay } from '../engine/replay-code';
import { type AppEvent, SEAT_NAMES, contractLabel, declLabel } from './store';
import { editNote, getPublicQuestion, listQuestions, questionLink, refreshQuestions } from '../questions/client';
import { publicQuestion, type LocalQuestion, type PublicQuestion } from '../questions/model';
import { NativeStats } from './NativeStats';
import { reviewPosition } from '../ai/native-analysis';
import { TrickHistory } from './TrickHistory';
import { Domino } from './Domino';
import './questions.css';

export function Questions({ initialId, onClose, dispatch }: {
  initialId: string | null; onClose: () => void; dispatch: (e: AppEvent) => void;
}) {
  const [items,setItems]=useState<LocalQuestion[]>([]);
  const [id,setId]=useState(initialId);
  const [shared,setShared]=useState<PublicQuestion|null>(null);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');
  const [note,setNote]=useState('');
  const [editing,setEditing]=useState(false);
  const [saving,setSaving]=useState(false);
  const [copied,setCopied]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{
    let live=true;
    const local=async()=>{try{const rows=await listQuestions();if(live)setItems(rows);}catch{if(live)setNotice('Device storage is unavailable.');}};
    const refresh=async()=>{
      await local();
      try{await refreshQuestions();if(live)setNotice('');}
      catch{if(live)setNotice('Showing saved copies. We’ll try again when connected.');}
      if(live)setLoading(false);
    };
    const changed=()=>void local();
    const online=()=>void refresh();
    void refresh();
    window.addEventListener('plunge-questions-changed',changed);
    window.addEventListener('online',online);
    return()=>{live=false;window.removeEventListener('plunge-questions-changed',changed);window.removeEventListener('online',online);};
  },[]);
  const owned=items.find(item=>item.question.id===id);
  useEffect(()=>{
    let live=true;setShared(null);setCopied(false);setEditing(false);
    if(id && !owned)void getPublicQuestion(id).then(q=>{if(live)setShared(q);})
      .catch(()=>{if(live)setNotice('A shared question needs a connection and a completed upload. Saved copies still work here.');});
    return()=>{live=false;};
  },[id,Boolean(owned)]);
  const current=owned ? publicQuestion(owned.question,owned.answer) : shared;
  const q=current?.question;
  const game=q ? decodeReplay(q.replay) : null;
  const sel=q ? {trick:Math.floor(q.ply/4),play:q.ply%4} : null;
  const position=game && sel && q ? reviewPosition(game,sel,q.seed) : null;
  const choose=(next:string|null)=>{setId(next);setNotice('');};
  const copy=async()=>{
    if(!id)return;
    const link=questionLink(id);
    try{await navigator.clipboard.writeText(link);setCopied(true);}catch{window.prompt('Copy this link',link);}
  };
  const save=async()=>{
    if(!id)return;setSaving(true);
    try{await editNote(id,note);setEditing(false);}catch(e){setNotice(String(e));}
    finally{setSaving(false);}
  };
  return <dialog class="questions-dialog" ref={dialog} onCancel={onClose} aria-label={id ? 'Saved question' : 'Your questions'}>
    <header class="questions-header">
      <div><p class="eyebrow">A little curiosity</p><h2>{id ? 'Saved question' : 'Your questions'}</h2></div>
      <button type="button" class="question-close" onClick={onClose} aria-label="Close questions">×</button>
    </header>
    <div class="questions-body">
      {!id ? <>
        <p class="question-intro">Something catch your eye? Tap a played domino, then <strong>Why this move?</strong> We’ll keep the moment here for later.</p>
        <p class="setting-hint">Saved on this device and sent anonymously for review. No account needed.</p>
        {loading && !items.length && <p role="status">Opening your notebook…</p>}
        {!loading && !items.length && <p class="questions-empty">No questions yet. There’s a whole table of possibilities.</p>}
        <div class="questions-list">{items.map(item=>{
          const p=publicQuestion(item.question,item.answer);
          return <button class="question-item" key={p.id} onClick={()=>choose(p.id)}>
            <Domino id={p.domino} orientation="h" />
            <span><strong>{SEAT_NAMES[p.seat]} played {p.domino.split('').join('–')}</strong>
              <span>{p.note || 'What was the thinking here?'}</span>
              <small>{item.answer ? 'Explanation ready' : item.revision>item.syncedRevision ? 'Saved here · waiting to send' : 'Sent for later'}
                {' · '}{new Date(p.created).toLocaleDateString()}</small></span>
            <span aria-hidden="true">›</span>
          </button>;
        })}</div>
      </> : current ? <>
        <div class="question-move"><Domino id={current.domino} orientation="h" />
          <div><h3>{SEAT_NAMES[current.seat]} played {current.domino.split('').join('–')}</h3>
            <p>Trick {Math.floor(current.ply/4)+1} · play {current.ply%4+1} of the trick</p></div></div>
        {owned && <p class="question-status" role="status">{owned.revision>owned.syncedRevision ? 'Saved on this device. Sending when connected.' : 'Saved here and sent anonymously for review.'}</p>}
        {editing ? <label class="native-label">What caught your eye?
          <textarea autoFocus maxLength={4000} value={note} onInput={e=>setNote(e.currentTarget.value)} />
          <button class="big-btn" disabled={saving} onClick={()=>void save()}>{saving ? 'Saving…' : 'Save note'}</button>
          <button class="text-btn" onClick={()=>setEditing(false)}>Cancel</button>
        </label> : <div class="question-note">
          <p>{current.note || 'No note yet. Sometimes the domino says it all.'}</p>
          {owned && <button class="text-btn" onClick={()=>{setNote(current.note);setEditing(true);}}>{current.note ? 'Edit note' : 'Add a note'}</button>}
        </div>}
        {current.answer ? <section class="question-answer"><h3>A closer look</h3><p>{current.answer.body}</p></section>
          : <p class="setting-hint">Saved for a later explanation. Interesting questions help us learn and improve Walt.</p>}
        {!current.complete && <p class="question-wait">Finish the hand to see the hands and move scores. Your question is already safe here.</p>}
        {game && q && sel && position && <div class="native-review">
          <p class="question-contract">{game.declarer!==null && SEAT_NAMES[game.declarer]} bid {game.contract && contractLabel(game.contract)}
            {game.declaration && ` in ${declLabel(game.declaration)}`} · Us {game.points[0]} · Them {game.points[1]}.</p>
          <NativeStats key={q.id} g={game} sel={sel} position={position} receipt={q.receipt} loading={false} />
          <details class="disclosure"><summary>The play around it</summary><TrickHistory g={game} selected={sel} /></details>
          <button class="text-btn" onClick={()=>{
            dispatch({type:'view-scenario',game,flag:{portable:true,id:q.id,ply:q.ply,share_code:q.replay,
              played:position.played,alternative:q.alternative,note:q.note,request:position.request,
              receipt_id:q.receipt_id,original_receipt:q.receipt}});onClose();
          }}>Explore the whole hand</button>
        </div>}
      </> : <p role="status">{loading ? 'Opening the question…' : 'This question is not available on this device yet.'}</p>}
      {notice && <p class="setting-hint" role="status">{notice}</p>}
    </div>
    <footer class="questions-footer">
      {id ? <>
        <button class="text-btn" onClick={()=>choose(null)}>All your questions</button>
        <button class="big-btn secondary" disabled={Boolean(owned && owned.syncedRevision===0) || !current} onClick={()=>void copy()}>
          {copied ? 'Link copied!' : 'Copy short link'}</button>
      </> : <button class="big-btn" onClick={onClose}>Back to the game</button>}
    </footer>
  </dialog>;
}
