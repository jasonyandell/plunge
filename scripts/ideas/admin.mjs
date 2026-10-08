/** Local setup helper. Does not print the builder secret. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { configPath, loadConfig, service, run } from './builder.mjs';
const [command,...args]=process.argv.slice(2);
if(command==='init') {
  try {await readFile(configPath);throw new Error('Configuration exists; refusing to replace the builder key.');}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  await mkdir(dirname(configPath),{recursive:true,mode:0o700});
  await writeFile(configPath,JSON.stringify({origin:'https://plunge.texas42.workers.dev',token:randomBytes(32).toString('hex')},null,2),{mode:0o600});
  console.log(`Private configuration saved to ${configPath}.`);
} else if(command==='install-secret') {
  const config=await loadConfig();
  await run('gh',['secret','set','PLUNGE_IDEAS_ADMIN_TOKEN','--repo','jasonyandell/plunge'],{input:config.token});
  console.log('Builder key saved for the next main deployment.');
} else if(command==='invite') {
  const config=await loadConfig();
  const member=await service(config,'members',{name:args.join(' ')});
  const file=join(dirname(configPath),`invite-${member.id}.txt`);
  await writeFile(file,`${member.name}\n${config.origin}/?ideas=1#invite=${member.token}\n`,{mode:0o600});
  console.log(`Personal invite saved to ${file}. Share it only with ${member.name}.`);
} else if(command==='revoke') {
  await service(await loadConfig(),'revoke',{id:args[0]});console.log('Invite revoked.');
} else throw new Error('Use init, install-secret, invite NAME, or revoke MEMBER_ID.');
