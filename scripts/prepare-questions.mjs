/** Idempotent database setup using the deployment service's existing credentials. */
import { readFileSync,writeFileSync } from 'node:fs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account || !token)throw new Error('Deployment Cloudflare credentials are required.');
async function api(path,method='GET',body) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database${path}`,{
    method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const value=await response.json();
  if(!response.ok || !value.success)throw new Error(`Question database setup failed (${response.status}). Check that the deployment token has D1 edit permission.`);
  return value;
}
let database;
for(let page=1;page<=100;page++) {
  const result=await api(`?per_page=100&page=${page}`);
  database=result.result.find(d=>d.name==='plunge-questions');
  if(database || result.result.length<100)break;
}
if(!database)database=(await api('','POST',{name:'plunge-questions'})).result;
if(!/^[a-f0-9-]{36}$/.test(database.uuid))throw new Error('Unexpected database identity.');
const config=readFileSync('wrangler.toml','utf8');
const existing=/database_id = "([^"]+)"/.exec(config)?.[1];
if(existing!==database.uuid && existing!=='00000000-0000-0000-0000-000000000000')throw new Error('Configured database does not match this Cloudflare account.');
writeFileSync('wrangler.toml',config.replace(/database_id = "[^"]+"/,`database_id = "${database.uuid}"`));
console.log(`Question database ready: ${database.uuid}`);
