import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {loadConfig,configPath} from './ideas/builder.mjs';
const [command,arg]=process.argv.slice(2);
if(!['list','owner','grant','revoke','recover'].includes(command))throw new Error('Use list, owner ACCOUNT_ID, grant ACCOUNT_ID, revoke ACCOUNT_ID, or recover ACCOUNT_ID.');
if(command!=='list'&&!/^[a-f0-9]{32}$/.test(arg??''))throw new Error('Use an exact account ID from list.');
const config=await loadConfig();
if(config.origin!=='https://plunge.texas42.workers.dev')throw new Error('Account administration uses the stable Plunge app.');
const route=command==='list'?'members':command==='owner'?'owner':command==='recover'?'recovery':'grant';
const response=await fetch(`${config.origin}/api/account/${route}`,{
  method:command==='list'?'GET':'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},
  ...(command==='list'?{}:{body:JSON.stringify({id:arg,enabled:command!=='revoke'})}),signal:AbortSignal.timeout(20000)});
const result=await response.json();if(!response.ok)throw new Error(result.error??'Account change failed.');
if(command==='recover') {
  const file=join(dirname(configPath),`recovery-${arg}.txt`);
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  await writeFile(file,`${result.url}\n`,{mode:0o600});
  console.log(`One-use recovery link saved to ${file}. It expires in 15 minutes. Share privately after verifying the person.`);
} else console.log(command==='list'?JSON.stringify(result.members,null,2):'Account access updated.');
