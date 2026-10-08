/** Run only in the trusted main deployment job, after tests and build. */
import { run } from './builder.mjs';
const { PLUNGE_IDEAS_ADMIN_TOKEN: token, ...env } = process.env;
if (!token) {
  console.log('Family ideas are not activated; no builder key was supplied.');
} else {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid family builder key.');
  await run('npx',['wrangler','secret','bulk'],{input:JSON.stringify({IDEAS_ADMIN_TOKEN:token}),env});
  console.log('Family builder key installed.');
}
