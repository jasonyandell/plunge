import {readFile} from 'node:fs/promises';
import {loadConfig,run} from './ideas/builder.mjs';
import {validateLoginConfig} from './accounts-config.mjs';
const [command,arg]=process.argv.slice(2);
if(command==='install-config') {
  if(!arg)throw new Error('Pass the path to a private JSON configuration file.');
  const value=validateLoginConfig(JSON.parse(await readFile(arg,'utf8')));
  await run('gh',['secret','set','PLUNGE_SOCIAL_LOGIN_CONFIG','--repo','jasonyandell/plunge'],{input:JSON.stringify(value)});
  console.log('Optional sign-in configuration saved for the next main deployment.');
} else {
  if(!['list','owner','grant','revoke'].includes(command))throw new Error('Use list, owner ACCOUNT_ID, grant ACCOUNT_ID, revoke ACCOUNT_ID, or install-config PRIVATE_FILE.');
  if(command!=='list'&&!/^[a-f0-9]{32}$/.test(arg??''))throw new Error('Use an exact account ID from list.');
  const config=await loadConfig();
  if(config.origin!=='https://plunge.texas42.workers.dev')throw new Error('Account administration uses the stable Plunge app.');
  const response=await fetch(`${config.origin}/api/account/${command==='list'?'members':command==='owner'?'owner':'grant'}`,{
    method:command==='list'?'GET':'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},
    ...(command==='list'?{}:{body:JSON.stringify({id:arg,enabled:command!=='revoke'})}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'Account change failed.');
  console.log(command==='list'?JSON.stringify(result.members,null,2):'Account access updated.');
}
