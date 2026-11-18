export const MAX_SCREENSHOTS = 2;
export const MAX_SCREENSHOT_BYTES = 400_000;
export const MAX_SCREENSHOT_EDGE = 1600;
export interface ScreenshotUpload { data:string }
export interface ScreenshotInfo { id:string; width:number; height:number }
export interface StoredScreenshot extends ScreenshotInfo { data:string }
// Only our normalized JPEG format is served. Check bounded dimensions before decoding anywhere.
export function jpegSize(bytes:Uint8Array):{width:number;height:number} {
  const invalid=()=>new Error('Invalid screenshot message. Please choose the picture again.');
  if(bytes.length<12 || bytes.length>MAX_SCREENSHOT_BYTES || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217)throw invalid();
  let pos=2;
  while(pos+4<bytes.length) {
    if(bytes[pos++]!==255)throw invalid();
    while(bytes[pos]===255)pos++;
    const marker=bytes[pos++];
    if(marker===218 || marker===217)break;
    const length=(bytes[pos]!<<8)|bytes[pos+1]!;
    if(length<2 || pos+length>bytes.length)throw invalid();
    if(marker===192 || marker===194) {
      if(length<8)throw invalid();
      const height=(bytes[pos+3]!<<8)|bytes[pos+4]!,width=(bytes[pos+5]!<<8)|bytes[pos+6]!;
      if(!width || !height || width>MAX_SCREENSHOT_EDGE || height>MAX_SCREENSHOT_EDGE)throw invalid();
      return {width,height};
    }
    pos+=length;
  }
  throw invalid();
}
export function screenshotBytes(data:string):Uint8Array<ArrayBuffer> {
  if(data.length>Math.ceil(MAX_SCREENSHOT_BYTES/3)*4 || (data.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)))throw new Error('Invalid screenshot message.');
  const binary=atob(data),bytes=new Uint8Array(binary.length);
  for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export function validateScreenshots(value:unknown):Array<ScreenshotUpload & {width:number;height:number}> {
  if(value===undefined)return [];
  if(!Array.isArray(value) || value.length>MAX_SCREENSHOTS)throw new Error('Please attach at most two screenshots to each message.');
  return value.map(item=>{
    if(!item || typeof item!=='object' || typeof item.data!=='string')throw new Error('Invalid screenshot message.');
    return {data:item.data,...jpegSize(screenshotBytes(item.data))};
  });
}
