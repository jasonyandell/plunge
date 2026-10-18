/** Local setup helper. Does not print the builder secret. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { configPath, loadConfig, service, run, approvedFiles } from './builder.mjs';
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
} else if(command==='scope') {
  const [idea,...files]=args;
  if(!/^[a-f0-9]{32}$/.test(idea??'') || !files.length)throw new Error('Use scope IDEA_ID worker/rooms.ts [worker/room-undo.ts].');
  const config=await loadConfig();
  config.ideaScopes={...config.ideaScopes,[idea]:files};
  config.ideaScopes[idea]=approvedFiles(config,idea);
  const temporary=`${configPath}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary,JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});
  await rename(temporary,configPath);
  console.log('Private scope saved for this idea. Use retry after the coordinator is updated.');
} else if(command==='inspect') {
  const idea=args[0];
  if(idea!==undefined && !/^[a-f0-9]{32}$/.test(idea))throw new Error('Use inspect [IDEA_ID].');
  const result=await service(await loadConfig(),idea ? `cards/${idea}` : 'cards');
  console.log(JSON.stringify(result,null,2));
} else if(command==='triage') {
  const [idea,...flags]=args,options={};
  for(let i=0;i<flags.length;i+=2){
    if(!['--revision','--action','--message-file','--title'].includes(flags[i]) || flags[i+1]===undefined)
      throw new Error('Use triage IDEA_ID --revision N --action note|close --message-file FILE [--title TITLE].');
    options[flags[i].slice(2)]=flags[i+1];
  }
  if(!/^[a-f0-9]{32}$/.test(idea??'') || !options['message-file'])throw new Error('An idea ID and message file are required.');
  const result=await service(await loadConfig(),'triage',{id:idea,revision:Number(options.revision),action:options.action,
    message:await readFile(options['message-file'],'utf8'),...(options.title?{title:options.title}:{})});
  console.log(`Idea ${result.card.number}: ${result.card.status}. Conversation preserved.`);
} else if(command==='retry') {
  await service(await loadConfig(),'retry',{id:args[0]});console.log('Idea queued again; its conversation is unchanged.');
} else if(command==='adopt') {
  // The hand-built lane: link a PR made by hand to a family idea card, new or existing.
  // `adopt PR [IDEA_ID] [--title TEXT] [--body TEXT] [--note TEXT]`
  const options={},rest=[];
  for(let i=0;i<args.length;i++){const flag=/^--(title|body|note)$/.exec(args[i]);if(flag)options[flag[1]]=args[++i];else rest.push(args[i]);}
  const [pr,idea]=rest;
  if(!/^[1-9][0-9]*$/.test(pr??'') || (idea!==undefined && !/^[a-f0-9]{32}$/.test(idea)))throw new Error('Use adopt PR [IDEA_ID] [--title TEXT] [--body TEXT] [--note TEXT].');
  const config=await loadConfig();
  const found=JSON.parse(await run('gh',['pr','view',pr,'--repo','jasonyandell/plunge','--json','state,headRefOid,title']));
  if(found.state!=='OPEN')throw new Error(`PR #${pr} is ${found.state.toLowerCase()}; only an open PR has a preview.`);
  const result=await service(config,'adopt',{pr:Number(pr),sha:found.headRefOid,...(options.note?{message:options.note}:{}),
    ...(idea?{id:idea}:{newId:randomBytes(16).toString('hex'),title:options.title??found.title,body:options.body??options.title??found.title})});
  console.log(`Linked PR #${pr} to ${config.origin}/?ideas=1#idea=${result.id}`);
  console.log(`Once its preview passes, Try your change opens it at ${config.origin}/?ideas=1#idea=${result.id}&try=1`);
} else if(command==='revoke') {
  await service(await loadConfig(),'revoke',{id:args[0]});console.log('Invite revoked.');
} else throw new Error('Use init, install-secret, inspect [IDEA_ID], triage IDEA_ID --revision N --action note|close --message-file FILE, invite NAME, revoke MEMBER_ID, scope IDEA_ID FILE..., retry IDEA_ID, or adopt PR [IDEA_ID].');
