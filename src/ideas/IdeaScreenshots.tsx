import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScreenshotInfo, ScreenshotUpload } from './screenshots';
import { encodePicture, loadPicture, screenshotUrl } from './screenshot-client';

export function Screenshot({image,token}:{image:ScreenshotInfo;token:string}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[open,setOpen]=useState(false);
  useEffect(()=>{let objectUrl='',disposed=false;const controller=new AbortController();setError(false);setUrl('');
    void fetch(`/api/ideas/attachments/${image.id}`,{credentials:'same-origin',headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('Unavailable');return response.blob();})
      .then(blob=>{if(!disposed){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(!disposed)setError(true);});
    return()=>{disposed=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[image.id,token,attempt]);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  return <>{url?<button class="idea-picture" type="button" onClick={()=>setOpen(true)} aria-label="Enlarge screenshot"><img src={url} width={image.width} height={image.height} alt="Attached screenshot" loading="lazy"/><span>Tap to enlarge</span></button>
    :error?<button type="button" class="text-btn" onClick={()=>setAttempt(attempt+1)}>Reload screenshot</button>:<p role="status">Loading screenshot…</p>}
    {open && <dialog ref={dialog} class="screenshot-dialog" onClose={()=>setOpen(false)}><button class="big-btn secondary" type="button" autoFocus onClick={()=>dialog.current?.close()}>Close screenshot</button><img src={url} alt="Attached screenshot, enlarged"/></dialog>}
  </>;
}

type Point={x:number;y:number};
export function MarkScreenshot({picture,onDone,onCancel,onError}:{picture:ScreenshotUpload;onDone:(image:ScreenshotUpload)=>void;onCancel:()=>void;onError:(error:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),base=useRef<HTMLImageElement|null>(null);
  const strokes=useRef<Point[][]>([]),active=useRef<number|null>(null);
  const [ready,setReady]=useState(false),[count,setCount]=useState(0);
  const paint=()=>{const c=canvas.current,img=base.current;if(!c||!img)return;const ctx=c.getContext('2d')!;
    ctx.drawImage(img,0,0);ctx.strokeStyle='#ed3434';ctx.fillStyle='#ed3434';ctx.lineWidth=Math.max(5,c.width/140);ctx.lineCap='round';ctx.lineJoin='round';
    for(const stroke of strokes.current){if(!stroke.length)continue;ctx.beginPath();ctx.moveTo(stroke[0]!.x,stroke[0]!.y);for(const p of stroke.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();
      if(stroke.length===1){ctx.beginPath();ctx.arc(stroke[0]!.x,stroke[0]!.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}}
  };
  useEffect(()=>{dialog.current?.showModal();let disposed=false;
    void loadPicture(screenshotUrl(picture)).then(img=>{if(disposed)return;base.current=img;const c=canvas.current!;c.width=img.naturalWidth;c.height=img.naturalHeight;paint();setReady(true);}).catch(e=>onError(String(e)));
    return()=>{disposed=true;};
  },[]);
  const point=(event:PointerEvent):Point=>{const c=canvas.current!,r=c.getBoundingClientRect();return{x:(event.clientX-r.left)*c.width/r.width,y:(event.clientY-r.top)*c.height/r.height};};
  return <dialog ref={dialog} class="screenshot-dialog" onCancel={onCancel} aria-labelledby="mark-title"><h2 id="mark-title">Mark where you mean</h2><p>Draw with your finger or mouse. You can also send it without a mark.</p>
    <canvas ref={canvas} aria-label="Draw a red mark on your screenshot" onPointerDown={event=>{if(!ready||active.current!==null)return;event.preventDefault();active.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);strokes.current.push([point(event)]);setCount(strokes.current.length);paint();}}
      onPointerMove={event=>{if(active.current!==event.pointerId)return;strokes.current.at(-1)!.push(point(event));paint();}}
      onPointerUp={()=>{active.current=null;}} onPointerCancel={()=>{active.current=null;}} />
    <div class="screenshot-actions"><button type="button" class="big-btn secondary" disabled={!count} onClick={()=>{strokes.current.pop();setCount(strokes.current.length);paint();}}>Undo mark</button>
      <button type="button" class="big-btn" disabled={!ready} onClick={()=>{try{onDone(encodePicture(canvas.current!));}catch(e){onError(String(e));}}}>Done marking</button>
      <button type="button" class="text-btn" onClick={onCancel}>Cancel</button></div>
  </dialog>;
}
