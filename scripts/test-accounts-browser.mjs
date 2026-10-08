// All HTTPS requests are intercepted locally. This uses the real account worker,
// a temporary D1 database, and Chromium's virtual passkey authenticator.
// Requires Node 22.18+ and an ordinary `npm run build`; contacts no deployed service.
import {chromium} from 'playwright';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const origin='https://plunge.texas42.workers.dev',admin='a'.repeat(64);
const bundled=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-14',d1Databases:['QUESTIONS'],bindings:{IDEAS_ADMIN_TOKEN:admin},durableObjects:{ROOMS:{className:'PlungeRoom',useSQLite:true}},serviceBindings:{ASSETS:async()=>new Response('app')}});
const db=await mf.getD1Database('QUESTIONS');
const sql=await readFile('migrations/0002_family_ideas.sql','utf8'),[tables,trigger]=sql.split('CREATE TRIGGER');
for(const statement of tables.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
for(const statement of (await readFile('migrations/0003_accounts.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
for(const statement of (await readFile('migrations/0004_idea_authorizations.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
const browser=await chromium.launch();
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
async function newPerson() {
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>route.abort());
 await context.route(`${origin}/**`,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/ideas')) {
   const response=await mf.dispatchFetch(url.href,{method:req.method(),headers:await req.allHeaders(),...(req.method()==='GET'?{}:{body:req.postData()})});
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie().join('\n');
   if(!headers['set-cookie'])delete headers['set-cookie'];
   await route.fulfill({status:response.status,headers,body:await response.text()});return;
  }
  const path=resolve('dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
  if(!path.startsWith(resolve('dist')+'/'))return route.abort();
  try {await route.fulfill({contentType:mime[extname(path)]??'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:'Missing test asset'});}
 });
 const page=await context.newPage(),cdp=await context.newCDPSession(page);
 await cdp.send('WebAuthn.enable');
 const add=async()=> (await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
 let authenticatorId=await add();
 return {context,page,cdp,replace:async()=>{await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});authenticatorId=await add();}};
}
async function enroll(person,name) {
 await person.page.goto(`${origin}/?account=1`);
 await person.page.getByLabel('What should we call you?').fill(name);
 await person.page.getByRole('button',{name:'Create an account',exact:true}).click();
 await person.page.getByRole('heading',{name:`Hi, ${name}.`,exact:true}).waitFor();
 return (await person.page.evaluate(async()=> (await (await fetch('/api/account')).json()).account)).id;
}
try {
 const owner=await newPerson();
 await owner.page.goto(origin);await owner.page.getByRole('button',{name:'Deal me in',exact:true}).waitFor();
 await owner.page.getByRole('button',{name:'More',exact:true}).click();await owner.page.getByRole('link',{name:'Your account · optional'}).click();
 await owner.page.getByRole('link',{name:'Keep playing without signing in'}).click();await owner.page.getByRole('button',{name:'Deal me in',exact:true}).waitFor();
 const ownerId=await enroll(owner,'Jason');
 const promote=await mf.dispatchFetch(`${origin}/api/account/owner`,{method:'POST',headers:{Authorization:`Bearer ${admin}`},body:JSON.stringify({id:ownerId})});assert.equal(promote.status,200);
 await owner.page.reload();await owner.page.getByRole('heading',{name:'Who’s at the family table?'}).waitFor();
 const dad=await newPerson(),dadId=await enroll(dad,'Dad');
 await dad.page.getByRole('button',{name:'Ask for family access'}).click();await dad.page.getByRole('button',{name:'Access requested'}).waitFor();
 await owner.page.getByRole('button',{name:'Refresh requests'}).click();
 const dadCard=owner.page.locator('.account-member').filter({hasText:dadId});await dadCard.getByRole('button',{name:'Grant family access'}).click();
 await dad.page.getByRole('button',{name:'Check access'}).click();await dad.page.getByRole('link',{name:'Open family ideas'}).waitFor();
 // Owner approval uses the real account cookie and D1 revision, not UI fixtures.
 await dad.page.getByRole('link',{name:'Open family ideas'}).click();
 await dad.page.getByLabel('Your idea',{exact:true}).fill('Show account-linked stats.');
 await dad.page.getByRole('button',{name:'Make an idea card'}).click();
 await dad.page.getByRole('heading',{name:'Show account-linked stats.',exact:true}).waitFor();
 const ideaId=new URL(dad.page.url()).hash.slice('#idea='.length);
 assert.equal(await dad.page.getByRole('button',{name:'Approve full access'}).count(),0);
 await owner.page.goto(`${origin}/?ideas=1#idea=${ideaId}`);
 await owner.page.getByRole('button',{name:'Approve full access'}).waitFor();
 const runId='e'.repeat(32);
 const builderCall=(path,data)=>mf.dispatchFetch(`${origin}/api/ideas/admin/${path}`,{method:'POST',headers:{Authorization:`Bearer ${admin}`},body:JSON.stringify(data)});
 assert.equal((await builderCall('claim',{ideaId,runId})).status,200);
 await owner.page.reload();await owner.page.getByText('Working now',{exact:true}).waitFor();
 await owner.page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await owner.page.locator('.idea-activity-dot').evaluate(el=>getComputedStyle(el).animationName),'none');
 await owner.page.getByRole('button',{name:'All ideas'}).click();
 await owner.page.locator('.idea-card').getByText('Working now',{exact:true}).waitFor();
 await owner.page.getByRole('button').filter({has:owner.page.getByRole('heading',{name:'Show account-linked stats.',exact:true})}).click();
 await owner.page.getByText('Working now',{exact:true}).waitFor();
 for(const width of [320,390]){await owner.page.setViewportSize({width,height:844});assert.ok(await owner.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await owner.page.screenshot({path:'/tmp/plunge-idea-working.png',fullPage:true});
 // Disconnecting must immediately stop presenting the last snapshot as active.
 await owner.context.setOffline(true);
 await owner.page.getByText('Updates unavailable',{exact:true}).waitFor();
 await owner.context.setOffline(false);await owner.page.reload();await owner.page.getByText('Working now',{exact:true}).waitFor();
 await db.prepare('UPDATE ideas SET lease_until=? WHERE id=?').bind(Date.now()+90000,ideaId).run();
 await owner.page.reload();await owner.page.getByText('No recent update',{exact:true}).waitFor();
 await owner.page.screenshot({path:'/tmp/plunge-idea-quiet.png',fullPage:true});
 assert.equal((await builderCall(`runs/${runId}/heartbeat`,{})).status,200);
 await owner.page.reload();await owner.page.getByText('Working now',{exact:true}).waitFor();
 assert.equal((await builderCall(`runs/${runId}/finish`,{status:'question',message:'Should these stats include family rooms?'})).status,200);
 await owner.page.reload();await owner.page.getByText('Waiting for your reply',{exact:true}).waitFor();
 for(const width of [320,390]){await owner.page.setViewportSize({width,height:844});assert.ok(await owner.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await owner.page.screenshot({path:'/tmp/plunge-owner-idea-approval.png',fullPage:true});
 await owner.page.getByRole('button',{name:'Approve full access'}).click();
 await owner.page.getByText('Full project access is approved for this request.',{exact:true}).waitFor();
 assert.equal((await db.prepare('SELECT account_id FROM idea_approvals WHERE idea_id=? AND revision=1').bind(ideaId).first()).account_id,ownerId);
 await dad.page.getByLabel('Keep the conversation going').fill('Also make the stats bigger.');
 await dad.page.getByRole('button',{name:'Send reply'}).click();await dad.page.getByText('Also make the stats bigger.',{exact:true}).waitFor();
 await owner.page.reload();await owner.page.getByRole('button',{name:'Approve full access'}).waitFor();
 await owner.page.getByRole('button',{name:'Another idea'}).click();
 await owner.page.getByLabel('Your idea',{exact:true}).fill('An owner-authenticated server change.');
 await owner.page.getByRole('button',{name:'Make an idea card'}).click();
 await owner.page.getByText('Full project access is approved for this request.',{exact:true}).waitFor();
 assert.equal(await owner.page.getByRole('button',{name:'Approve full access'}).count(),0);
 await owner.page.goto(`${origin}/?account=1`);await owner.page.getByRole('heading',{name:'Who’s at the family table?'}).waitFor();
 await dad.page.goto(`${origin}/?account=1`);await dad.page.getByRole('heading',{name:'Hi, Dad.',exact:true}).waitFor();
 await dad.page.getByRole('button',{name:'Sign out',exact:true}).click();
 await dad.page.getByRole('button',{name:'Sign in with a passkey',exact:true}).click();await dad.page.getByRole('heading',{name:'Hi, Dad.',exact:true}).waitFor();
 assert.equal(await dad.page.evaluate(async()=> (await (await fetch('/api/account')).json()).account.id),dadId);
 await dad.page.getByText('Account and sign-in help',{exact:true}).click();await dad.replace();
 await dad.page.getByRole('button',{name:'Add another passkey'}).click();await dad.page.getByText('Another passkey is ready.',{exact:true}).waitFor();
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM account_passkeys WHERE account_id=?').bind(dadId).first()).n,2);
 await dadCard.getByText('Help recover this account',{exact:true}).click();await dadCard.getByRole('button',{name:'Make recovery link'}).click();
 const link=await owner.page.getByLabel('Recovery link',{exact:true}).inputValue();
 await dad.page.getByRole('button',{name:'Sign out',exact:true}).click();await dad.replace();await dad.page.goto(link);
 await dad.page.getByRole('button',{name:'Create replacement passkey'}).waitFor();assert.equal(new URL(dad.page.url()).hash,'');await dad.page.getByRole('button',{name:'Create replacement passkey'}).click();
 await dad.page.getByRole('heading',{name:'Hi, Dad.',exact:true}).waitFor();await dad.page.getByRole('link',{name:'Open family ideas'}).waitFor();
 assert.equal(await dad.page.evaluate(async()=> (await (await fetch('/api/account')).json()).account.id),dadId);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM account_passkeys WHERE account_id=?').bind(dadId).first()).n,1);
 for(const person of [owner,dad])for(const width of [320,390]){await person.page.setViewportSize({width,height:844});assert.ok(await person.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await dad.page.screenshot({path:'/tmp/plunge-passkey-account.png',fullPage:true});
 await dad.page.getByRole('button',{name:'Sign out',exact:true}).click();await dad.page.screenshot({path:'/tmp/plunge-passkey-signin.png',fullPage:true});
 console.log('PASS: real browser passkey enrollment/sign-in/add/recovery against account worker and D1; guest play, stable identity, family grants, owner automatic idea access, revision-bound approval button, live/stale/offline activity, reduced motion, phone layout. No production requests.');
}finally{await browser.close();await mf.dispose();}
