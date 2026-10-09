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
for(const statement of (await readFile('migrations/0005_idea_screenshots.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
const [laneSql,laneTrigger]=(await readFile('migrations/0008_idea_hand_lane.sql','utf8')).split('CREATE TRIGGER');
for(const statement of laneSql.split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${laneTrigger}`).run();
for(const statement of (await readFile('migrations/0005_listed_tables.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
for(const file of ['0004_family_table.sql','0006_hands.sql','0007_account_invites.sql','0009_family_link.sql'])for(const statement of (await readFile(`migrations/${file}`,'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
const browser=await chromium.launch();
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
async function newPerson() {
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>route.abort());
 await context.route(`${origin}/**`,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/ideas') || url.pathname.startsWith('/api/stats') || url.pathname.startsWith('/api/rooms')) {
   const response=await mf.dispatchFetch(url.href,{method:req.method(),headers:await req.allHeaders(),...(req.method()==='GET'?{}:{body:req.postData()})});
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie().join('\n');
   if(!headers['set-cookie'])delete headers['set-cookie'];
   await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});return;
  }
  const path=resolve('dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
  if(!path.startsWith(resolve('dist')+'/'))return route.abort();
  try {await route.fulfill({contentType:mime[extname(path)]??'application/octet-stream',body:await readFile(path)});}catch{await route.fulfill({status:404,body:'Missing test asset'});}
 });
 // The share sheet is the phone's; here the invite falls back to a link on the page.
 await context.addInitScript(()=>{delete Navigator.prototype.share;});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);
 await cdp.send('WebAuthn.enable');
 const add=async()=> (await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
 let authenticatorId=await add();
 return {context,page,cdp,replace:async()=>{await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});authenticatorId=await add();}};
}
// One hand already in the device log before sign-in (a real replay from the engine).
const localHand={schema:'plunge-hand-v1',id:'browser-test:1',gameId:'browser-test',handNumber:1,code:'v1l262414032311110666355514342336561545044210064605352302220.30PPPD064626665636160415340555432435052',
 endedAt:'2026-10-01T12:00:00.000Z',marksBefore:[0,0],marksAfter:[1,0],gameOver:false,thrownIn:false,player:'native-partner'};
const seedHand=(record)=>new Promise((resolve,reject)=>{
 const open=indexedDB.open('plunge-stats',2);
 open.onupgradeneeded=()=>{for(const [name,options] of [['hands',{keyPath:'id'}],['analysis',{keyPath:'id'}],['meta',undefined],['sync',{keyPath:'key'}]])if(!open.result.objectStoreNames.contains(name))open.result.createObjectStore(name,options);};
 open.onerror=()=>reject(open.error);
 open.onsuccess=()=>{const tx=open.result.transaction('hands','readwrite');tx.objectStore('hands').put(record);tx.oncomplete=()=>{open.result.close();resolve();};tx.onerror=()=>reject(tx.error);};
});
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
 const dad=await newPerson();
 await dad.page.goto(`${origin}/?account=1`);await dad.page.getByText(/Signing in connects the hands/).waitFor();await dad.page.evaluate(seedHand,localHand);
 const dadId=await enroll(dad,'Dad');
 // Signing in connected the device's hand once; the account page says so and D1 holds it.
 await dad.page.getByText('1 hand on this device · 1 connected to your account.',{exact:true}).waitFor();
 await dad.page.getByText('Your account holds 1 hand, every device and family game included.',{exact:true}).waitFor();
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM hand_players WHERE account_id=?').bind(dadId).first()).n,1);
 await dad.page.getByRole('button',{name:'Connect now',exact:true}).click();await dad.page.getByText('Your account holds 1 hand, every device and family game included.',{exact:true}).waitFor();
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM hand_players WHERE account_id=?').bind(dadId).first()).n,1);
 await dad.page.getByRole('button',{name:'Ask for family access'}).click();await dad.page.getByRole('button',{name:'Access requested'}).waitFor();
 await owner.page.getByRole('button',{name:'Refresh requests'}).click();
 await owner.page.locator('.account-waiting').getByText('asked from their account').waitFor();
 await owner.page.getByRole('button',{name:'Let Dad in'}).click();await owner.page.getByText('Dad is in.').waitFor();
 const dadCard=owner.page.locator('.account-member').filter({hasText:dadId});
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
 await owner.page.getByLabel('Keep the conversation going').fill('Yes, I mean during bidding.');
 assert.equal((await builderCall(`runs/${runId}/progress`,{sequence:0,message:'I understand you want to keep your own bid visible while others finish bidding.'})).status,200);
 await owner.page.getByText('I understand you want to keep your own bid visible while others finish bidding.',{exact:true}).waitFor({timeout:12000});
 assert.equal(await owner.page.getByLabel('Keep the conversation going').inputValue(),'Yes, I mean during bidding.');
 await owner.page.getByLabel('Keep the conversation going').fill('');
 await owner.page.screenshot({path:'/tmp/plunge-idea-conversation.png',fullPage:true});

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

 // Screenshots through real browser decoding, IndexedDB, authenticated worker, and D1.
 await dad.page.goto(`${origin}/?ideas=1#idea=${ideaId}`);
 await dad.page.getByLabel('Keep the conversation going').fill('The bid should go by these names.');
 assert.equal(await dad.page.getByLabel('Choose screenshot').isVisible(),false);
 const png=await dad.page.evaluate(()=>{const c=document.createElement('canvas');c.width=1800;c.height=2400;const x=c.getContext('2d');x.fillStyle='#fff8e8';x.fillRect(0,0,c.width,c.height);x.fillStyle='#35291c';x.font='80px sans-serif';x.fillText('Mom       Dad',100,200);x.fillText('Bidding',100,500);return c.toDataURL('image/png').split(',')[1];});
 await dad.page.getByLabel('Choose screenshot').setInputFiles({name:'bidding.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await dad.page.getByRole('button',{name:'Mark where you mean'}).click();
 const canvas=dad.page.getByLabel('Draw a red mark on your screenshot');
 await dad.page.getByRole('button',{name:'Done marking'}).waitFor();
 const box=await canvas.boundingBox();
 await dad.page.mouse.move(box.x+box.width*0.1,box.y+box.height*0.15);await dad.page.mouse.down();
 await dad.page.mouse.move(box.x+box.width*0.8,box.y+box.height*0.15,{steps:8});await dad.page.mouse.up();
 assert.ok(await canvas.evaluate(c=>{const x=c.getContext('2d'),p=x.getImageData(c.width*0.4,c.height*0.15,1,1).data;return p[0]>180&&p[1]<100;}));
 await dad.page.getByRole('button',{name:'Undo mark'}).click();
 assert.ok(await canvas.evaluate(c=>c.getContext('2d').getImageData(c.width*0.4,c.height*0.15,1,1).data[1]>100));
 await dad.page.mouse.move(box.x+box.width*0.1,box.y+box.height*0.15);await dad.page.mouse.down();await dad.page.mouse.move(box.x+box.width*0.8,box.y+box.height*0.15,{steps:8});await dad.page.mouse.up();
 await dad.page.screenshot({path:'/tmp/plunge-screenshot-marking.png'});
 await dad.page.getByRole('button',{name:'Done marking'}).click();
 const marked=await dad.page.getByAltText('Screenshot 1 to send').getAttribute('src');
 assert.ok(marked.startsWith('data:image/jpeg;base64,'));
 await dad.page.reload();await dad.page.getByRole('button',{name:'Send reply'}).waitFor();
 assert.equal(await dad.page.getByLabel('Keep the conversation going').inputValue(),'The bid should go by these names.');
 assert.equal(await dad.page.getByAltText('Screenshot 1 to send').getAttribute('src'),marked);
 const fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test connection lost. Please retry.'})});
 await dad.page.route(`**/api/ideas/${ideaId}/messages`,fail);
 await dad.page.getByRole('button',{name:'Send reply'}).click();await dad.page.getByRole('alert').filter({hasText:'Test connection lost'}).waitFor();
 assert.equal(await dad.page.getByAltText('Screenshot 1 to send').getAttribute('src'),marked);
 await dad.page.unroute(`**/api/ideas/${ideaId}/messages`,fail);
 await dad.page.getByRole('button',{name:'Send reply'}).click();await dad.page.getByText('The bid should go by these names.',{exact:true}).waitFor();
 await dad.page.getByRole('button',{name:'Enlarge screenshot'}).waitFor();
 assert.equal(await dad.page.getByAltText('Screenshot 1 to send').count(),0);
 const pictureThread=await dad.page.evaluate(async id=>(await (await fetch(`/api/ideas/${id}`)).json()),ideaId);
 const image=pictureThread.messages.at(-1).screenshots[0];assert.equal(image.height,1600);assert.equal(image.width,1200);
 assert.equal((await mf.dispatchFetch(`${origin}/api/ideas/attachments/${image.id}`)).status,401);
 await owner.page.goto(`${origin}/?ideas=1#idea=${ideaId}`);await owner.page.getByRole('button',{name:'Enlarge screenshot'}).click();
 await owner.page.getByAltText('Attached screenshot, enlarged').waitFor();
 assert.ok(await owner.page.getByAltText('Attached screenshot, enlarged').evaluate(img=>img.complete&&img.naturalWidth===1200));
 await owner.page.getByRole('button',{name:'Close screenshot'}).click();
 for(const width of [320,390]){await dad.page.setViewportSize({width,height:844});assert.ok(await dad.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await dad.page.screenshot({path:'/tmp/plunge-screenshot-conversation.png',fullPage:true});
 // An image-only first message is useful too.
 await dad.page.getByRole('button',{name:'Another idea'}).click();
 await dad.page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
 await dad.page.getByLabel('Choose screenshot').setInputFiles({name:'bidding.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await dad.page.getByRole('button',{name:'Make an idea card'}).click();
 await dad.page.getByRole('heading',{name:'Screenshot for this idea.',exact:true}).waitFor();
 console.log('PASS: screenshot upload/resize, red pen/undo, reload recovery, failed-send recovery, protected family viewing, image-only idea, narrow phone layouts.');

 // Invites: Dad saves a seat for Benny, who already has hands on his phone and has never signed in.
 const guest=await newPerson();await guest.page.goto(origin);
 await guest.page.getByRole('link',{name:'Sign in, optional'}).waitFor();
 await guest.page.screenshot({path:'/tmp/plunge-home-signed-out.png'});
 await dad.page.goto(`${origin}/?account=1`);await dad.page.getByRole('heading',{name:'Invite family'}).waitFor();
 await dad.page.getByLabel('Their name').fill('Benny');await dad.page.getByRole('button',{name:'Send an invite'}).click();
 const invite=await dad.page.getByLabel('Invite for Benny').inputValue();
 assert.match(invite,/^https:\/\/plunge\.texas42\.workers\.dev\/\?account=1#join=[a-f0-9]{64}$/);
 await dad.page.locator('.account-invites li').filter({hasText:'Benny'}).getByText('Not yet').waitFor();
 await dad.page.screenshot({path:'/tmp/plunge-invite-sent.png',fullPage:true});
 const benny=await newPerson();
 await benny.page.goto(origin);await benny.page.evaluate(seedHand,{...localHand,id:'benny-phone:1',gameId:'benny-phone'});
 await benny.page.goto(invite);
 await benny.page.getByRole('heading',{name:'Hi, Benny.',exact:true}).waitFor();assert.equal(new URL(benny.page.url()).hash,'');
 await benny.page.getByText('Dad saved you a seat at the family table.',{exact:true}).waitFor();
 await benny.page.getByText(/Your 1 hand from this browser comes with you\./).waitFor();
 for(const width of [320,390]){await benny.page.setViewportSize({width,height:844});assert.ok(await benny.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await benny.page.screenshot({path:'/tmp/plunge-invite-welcome.png',fullPage:true});
 await benny.page.getByRole('button',{name:'Save my seat'}).click();
 await benny.page.getByRole('heading',{name:'You’re in, Benny.',exact:true}).waitFor();
 // Opened outside the installed app: tell Benny how his home-screen app catches up.
 await benny.page.getByText(/Already have Plunge on your home screen\?/).waitFor();
 await benny.page.screenshot({path:'/tmp/plunge-invite-joined.png',fullPage:true});
 const bennyAccount=await benny.page.evaluate(async()=> (await (await fetch('/api/account')).json()).account);
 assert.equal(bennyAccount.family,1);assert.equal(bennyAccount.name,'Benny');
 await benny.page.getByText(/Your seat is saved, along with 1 hand from here\./).waitFor();
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM hand_players WHERE account_id=?').bind(bennyAccount.id).first()).n,1);
 await benny.page.getByRole('button',{name:'Sit down at the family table'}).click();await benny.page.waitForURL(/\?rooms=1#room=[a-f0-9]{32}$/);
 await benny.page.goto(origin);await benny.page.getByRole('link',{name:'Signed in as Benny. Your account'}).waitFor();await benny.page.locator('.home-table').getByText('Rejoin').waitFor();
 await benny.page.screenshot({path:'/tmp/plunge-home-signed-in.png'});
 // Used once. Dad sees Benny joined; Jason sees who invited him.
 await benny.page.goto(invite);await benny.page.getByRole('alert').filter({hasText:'already used'}).waitFor();
 await dad.page.reload();await dad.page.locator('.account-invites li').filter({hasText:'Benny'}).getByText('Joined').waitFor();
 await owner.page.goto(`${origin}/?account=1`);
 await owner.page.locator('.account-member').filter({hasText:bennyAccount.id}).getByText(/invited by Dad/).waitFor();
 // An invite opened on someone else's signed-in phone doesn't swap who's signed in.
 await dad.page.getByLabel('Their name').fill('Cousin Ray');await dad.page.getByRole('button',{name:'Send an invite'}).click();
 const rayInvite=await dad.page.getByLabel('Invite for Cousin Ray').inputValue();
 await owner.page.goto(rayInvite);await owner.page.getByRole('heading',{name:'This invite is for Cousin Ray'}).waitFor();
 await owner.page.getByRole('button',{name:'Keep me signed in'}).click();await owner.page.getByRole('heading',{name:'Hi, Jason.',exact:true}).waitFor();
 // In the installed app, an invite can be pasted instead of opened.
 await guest.page.goto(`${origin}/?account=1`);await guest.page.getByText('Have an invite link?').click();
 await guest.page.getByLabel('Invite link',{exact:true}).fill(rayInvite);await guest.page.getByRole('button',{name:'Open my invite'}).click();
 await guest.page.getByRole('heading',{name:'Hi, Cousin Ray.',exact:true}).waitFor();
 await guest.page.getByRole('button',{name:'Save my seat'}).click();await guest.page.getByRole('heading',{name:'You’re in, Cousin Ray.',exact:true}).waitFor();
 // The family link: one link in the chat, people save their own seats, Jason lets each in.
 await owner.page.goto(`${origin}/?account=1`);await owner.page.getByRole('heading',{name:'Family link'}).waitFor();
 await owner.page.getByRole('button',{name:'Make the family link'}).click();
 const familyLink=await owner.page.getByLabel('Family link',{exact:true}).inputValue();
 assert.match(familyLink,/^https:\/\/plunge\.texas42\.workers\.dev\/\?account=1#family=[a-f0-9]{64}$/);
 await owner.page.getByText(/The family link is on until/).waitFor();
 const june=await newPerson();
 await june.page.goto(origin);await june.page.evaluate(seedHand,{...localHand,id:'june-phone:1',gameId:'june-phone'});
 await june.page.goto(familyLink);
 await june.page.getByRole('heading',{name:'Pull up a chair.',exact:true}).waitFor();assert.equal(new URL(june.page.url()).hash,'');
 await june.page.getByText('Jason’s family is playing Plunge, a Texas 42 game. Save your seat, and Jason will let you in.').waitFor();
 for(const width of [320,390]){await june.page.setViewportSize({width,height:844});assert.ok(await june.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await june.page.screenshot({path:'/tmp/plunge-family-link.png',fullPage:true});
 await june.page.getByLabel('What should we call you at the table?').fill('Aunt June');
 await june.page.getByRole('button',{name:'Save my seat'}).click();
 await june.page.getByRole('heading',{name:'You’re on the list, Aunt June.',exact:true}).waitFor();
 await june.page.screenshot({path:'/tmp/plunge-family-waiting.png',fullPage:true});
 const juneId=await june.page.evaluate(async()=> (await (await fetch('/api/account')).json()).account.id);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM hand_players WHERE account_id=?').bind(juneId).first()).n,1);
 // Jason's home screen says someone is waiting; one tap lets her in.
 await owner.page.goto(origin);await owner.page.getByRole('link',{name:/Signed in as Jason\. Your account, 1 waiting to come in/}).waitFor();
 await owner.page.screenshot({path:'/tmp/plunge-owner-waiting-chip.png'});
 await owner.page.getByRole('link',{name:/Signed in as Jason/}).click();
 await owner.page.locator('.account-waiting').getByText('came through the family link').waitFor();
 await owner.page.screenshot({path:'/tmp/plunge-owner-waiting.png',fullPage:true});
 await owner.page.getByRole('button',{name:'Let Aunt June in'}).click();await owner.page.getByText('Aunt June is in.').waitFor();
 // June's open page notices by itself.
 await june.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await june.page.getByRole('heading',{name:'You’re in, Aunt June.',exact:true}).waitFor();
 // Turning the link off stops it.
 await owner.page.getByRole('button',{name:'Turn it off'}).click();await owner.page.getByText('No family link is on right now.').waitFor();
 const late=await newPerson();await late.page.goto(familyLink);await late.page.getByRole('alert').filter({hasText:'turned off or expired'}).waitFor();
 console.log('PASS: family link — one shared link, own name, device hands along, owner waiting chip, one-tap let in, page notices, link off.');
 console.log('PASS: invites — share link, named welcome, device hands carried along, one-use, family table, home chip, inviter and owner status, signed-in guard, paste in the installed app.');
 await owner.page.goto(`${origin}/?account=1`);await owner.page.getByRole('heading',{name:'Who’s at the family table?'}).waitFor();
 await dad.page.goto(`${origin}/?account=1`);await dad.page.getByRole('heading',{name:'Hi, Dad.',exact:true}).waitFor();
 await dad.page.getByRole('button',{name:'Sign out',exact:true}).click();
 await dad.page.getByRole('button',{name:'Sign in',exact:true}).click();await dad.page.getByRole('heading',{name:'Hi, Dad.',exact:true}).waitFor();
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
 console.log('PASS: real browser passkey enrollment/sign-in/add/recovery against account worker and D1; guest play, stable identity, family grants, hands connected once, owner automatic idea access, revision-bound approval button, live/stale/offline activity, reduced motion, phone layout. No production requests.');
}finally{await browser.close();await mf.dispose();}
