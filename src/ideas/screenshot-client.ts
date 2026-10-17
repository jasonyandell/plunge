import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_EDGE, type ScreenshotUpload } from './screenshots';
import { readDraft, type Draft } from './client';
export interface PictureDraft extends Draft { screenshots:ScreenshotUpload[] }
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{const request=indexedDB.open('plunge-idea-drafts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function draftStore(key:string,write?:PictureDraft|null):Promise<PictureDraft> {
  const db=await database();
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts',write===undefined?'readonly':'readwrite'),store=tx.objectStore('drafts');
    const request=write===undefined?store.get(key):write===null?store.delete(key):store.put(write,key);
    tx.oncomplete=()=>resolve(write ?? request.result ?? {...readDraft(key),screenshots:[]});
    tx.onabort=tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
export const screenshotUrl=(picture:ScreenshotUpload)=>`data:image/jpeg;base64,${picture.data}`;
export function loadPicture(url:string):Promise<HTMLImageElement> {
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not open that picture. Please choose a PNG, JPEG, or WebP screenshot.'));image.src=url;});
}
export function encodePicture(canvas:HTMLCanvasElement):ScreenshotUpload {
  for(const quality of [0.88,0.76,0.64,0.5,0.35]) {
    const data=canvas.toDataURL('image/jpeg',quality).split(',')[1]!;
    if(data.length*3/4<=MAX_SCREENSHOT_BYTES)return {data};
  }
  throw new Error('That picture is too detailed. Please crop it a little and try again.');
}
export async function preparePicture(file:File):Promise<ScreenshotUpload> {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG, or WebP screenshot.');
  if(file.size>20_000_000)throw new Error('That picture is too large. Please crop it and try again.');
  const url=URL.createObjectURL(file);
  try {
    const image=await loadPicture(url);
    if(image.naturalWidth*image.naturalHeight>60_000_000)throw new Error('That picture is too large. Please crop it and try again.');
    const scale=Math.min(1,MAX_SCREENSHOT_EDGE/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return encodePicture(canvas);
  }finally{URL.revokeObjectURL(url);}
}
