// Trusted main deployment only. Provider secrets never enter build or preview jobs.
import {run} from './ideas/builder.mjs';
import {validateLoginConfig} from './accounts-config.mjs';
const {PLUNGE_SOCIAL_LOGIN_CONFIG:raw,...env}=process.env;
if(raw) {
  const values=validateLoginConfig(JSON.parse(raw));
  await run('npx',['wrangler','secret','bulk'],{input:JSON.stringify(values),env});
  console.log('Optional sign-in configuration installed.');
} else console.log('No new social sign-in configuration supplied.');
