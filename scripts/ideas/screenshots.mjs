import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const ID=/^[a-f0-9]{32}$/;
// Only fixed, authenticated service paths. Never follow a family-provided URL.
export async function archiveScreenshots(config,job,logDir,fetchImage=fetch) {
  if(!ID.test(job.run.id))throw new Error('Invalid screenshot run identifier.');
  const manifest=[];
  for(const message of job.messages ?? [])for(const image of message.screenshots ?? []) {
    if(!ID.test(message.id) || !ID.test(image.id))throw new Error('Invalid screenshot identifier.');
    const response=await fetchImage(`${config.origin}/api/ideas/admin/runs/${job.run.id}/attachments/${image.id}`,{
      headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok || response.headers.get('content-type')!=='image/jpeg')throw new Error('Could not load a conversation screenshot.');
    const reader=response.body?.getReader();if(!reader)throw new Error('Missing screenshot.');
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>400000){await reader.cancel();throw new Error('Screenshot too large.');}chunks.push(value);}
    const bytes=Buffer.concat(chunks);
    if(bytes.length<12 || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217)throw new Error('Invalid screenshot.');
    const dir=join(logDir,'screenshots');await mkdir(dir,{recursive:true,mode:0o700});
    const path=join(dir,`${image.id}.jpg`);await writeFile(path,bytes,{mode:0o600});
    manifest.push({messageId:message.id,imageId:image.id,path});
  }
  await writeFile(join(logDir,'screenshots.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  return manifest;
}
