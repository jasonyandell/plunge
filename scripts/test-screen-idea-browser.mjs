// Screen capture and later submission against the real account/ideas worker.
// All HTTPS requests are intercepted locally; no deployed service is contacted.
// Requires Node 22.18+ and an ordinary `npm run build`; contacts no deployed service.
import {chromium,webkit} from 'playwright';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
// Home no longer has its own Share an idea link; Settings & more does.
const openIdea=async page=>{
 const more=page.getByRole('button',{name:'Settings & more',exact:true});
 if(await more.count())await more.click();
 await page.locator('button.more-row',{hasText:'Share an idea about this screen'}).click();
};
import {build} from 'esbuild';
const origin='https://plunge.texas42.workers.dev',admin='a'.repeat(64);
const bundled=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-14',d1Databases:['QUESTIONS'],outboundService:async request=>{assert.equal(request.url,'https://plunge-pr-74.texas42.workers.dev/version.json');return Response.json({build:'a'.repeat(40),preview_pr:74});},bindings:{IDEAS_ADMIN_TOKEN:admin},durableObjects:{ROOMS:{className:'PlungeRoom',useSQLite:true}},serviceBindings:{ASSETS:async()=>new Response('app')}});
const db=await mf.getD1Database('QUESTIONS');
const sql=await readFile('migrations/0002_family_ideas.sql','utf8'),[tables,trigger]=sql.split('CREATE TRIGGER');
for(const statement of tables.split(';').filter(s=>s.trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${trigger}`).run();
for(const statement of (await readFile('migrations/0003_accounts.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
for(const statement of (await readFile('migrations/0004_idea_authorizations.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
for(const statement of (await readFile('migrations/0005_idea_screenshots.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
const [laneSql,laneTrigger]=(await readFile('migrations/0008_idea_hand_lane.sql','utf8')).split('CREATE TRIGGER');
for(const statement of laneSql.split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();await db.prepare(`CREATE TRIGGER${laneTrigger}`).run();
for(const statement of (await readFile('migrations/0010_idea_preview_revision.sql','utf8')).split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();
for(const statement of (await readFile('migrations/0011_idea_releases.sql','utf8')).split(';').filter(s=>s.replace(/--.*$/gm,'').trim()))await db.prepare(statement).run();
for(const statement of (await readFile('migrations/0005_listed_tables.sql','utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
for(const file of ['0004_family_table.sql','0006_hands.sql','0007_account_invites.sql','0009_family_link.sql'])for(const statement of (await readFile(`migrations/${file}`,'utf8')).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
const browser=await (process.env.PLUNGE_TEST_BROWSER==='webkit'?webkit:chromium).launch();
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};

const {createHash}=await import('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex'),id=n=>n.toString(16).padStart(32,'0');
let failSend=false;
async function person(n,name,owner) {
 const token=String(n).repeat(64);
 await db.prepare('INSERT INTO idea_members(id,name,token_hash) VALUES(?,?,?)').bind(id(n),name,hash('invite-'+n)).run();
 await db.prepare('INSERT INTO accounts(id,name,owner,member_id,created) VALUES(?,?,?,?,0)').bind(id(n),name,owner,id(n)).run();
 await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(hash(token),id(n),Date.now()+86400000).run();
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.route('**/*',route=>route.abort());
 await context.route(`${origin}/**`,async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture-login')return route.fulfill({status:200,headers:{'Set-Cookie':`__Host-plunge-session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`},body:'Local test sign-in'});
  if(url.pathname.startsWith('/api/')) {
   if(failSend && req.method()==='PUT')return route.abort('internetdisconnected');
   const headers=await req.allHeaders();
   // WebKit's intercepted headers omit Cookie; forward the test browser's cookie jar to local D1.
   if(!headers.cookie)headers.cookie=(await context.cookies(url.href)).map(c=>`${c.name}=${c.value}`).join('; ');
   const response=await mf.dispatchFetch(url.href,{method:req.method(),headers,...(req.method()==='GET'?{}:{body:req.postData()})});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  const file=resolve('dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
  assert.ok(file.startsWith(resolve('dist')+'/'));
  try{await route.fulfill({contentType:mime[extname(file)]??'application/octet-stream',body:await readFile(file)});}catch{await route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();await page.goto(origin+'/fixture-login');return page;
}
try {
 {
  // A finger, not a mouse: holding on plain text must open feedback, not the
  // phone's text selection or callout (iPhone Safari claims the hold first).
  const touch=await person(2,'Rose',0);
  touch.setDefaultTimeout(10000);
  await touch.goto(origin);
  const tagline=touch.getByText('Texas 42. Pull up a chair.',{exact:true});
  await tagline.waitFor();
  const style=await tagline.evaluate(e=>{const s=getComputedStyle(e);return {select:s.userSelect||s.webkitUserSelect,callout:s.webkitTouchCallout};});
  assert.equal(style.select,'none');
  if(style.callout!==undefined)assert.equal(style.callout,'none');
  assert.equal(await touch.getByRole('textbox').count(),0);
  if(browser.browserType().name()==='chromium') {
   const box=await tagline.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
   const cdp=await touch.context().newCDPSession(touch);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
   await touch.waitForTimeout(900);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await touch.getByRole('heading',{name:'Mark where you mean',exact:true}).waitFor();
   assert.equal(await touch.evaluate(()=>String(getSelection())),'');
  }
  await touch.context().close();
 }
 const page=await person(1,'Jason',1);
 await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
 page.setDefaultTimeout(10000);
 const faults=[];page.on('pageerror',e=>faults.push(String(e)));
 await page.goto(origin);
 const deal=page.getByRole('button',{name:'Deal me in',exact:true});
 await deal.waitFor();
 const box=await deal.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 // Moving a finger to scroll must cancel the long press.
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(1,1);await page.waitForTimeout(700);await page.mouse.up();
 assert.equal(await page.getByRole('heading',{name:'An idea about this screen',exact:true}).count(),0);
 // Holding a button opens feedback, and releasing must not activate that button.
 const before=await page.evaluate(()=>localStorage.getItem('plunge:save:v1'));
 await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(700);
 await page.getByRole('heading',{name:'Mark where you mean',exact:true}).waitFor();
 await page.mouse.up();
 assert.equal(await page.evaluate(()=>localStorage.getItem('plunge:save:v1')),before);
 const canvas=page.getByLabel('Draw a red mark on your screenshot');
 await page.getByRole('button',{name:'Done marking',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.screenshot-actions .big-btn:not(.secondary)')?.disabled);
 assert.ok(await canvas.evaluate(c=>{
  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();
  for(let i=0;i<data.length;i+=64)colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);
  return colors.size>100;
 }), 'Capture must contain the rendered page, not a blank rectangle');
 await page.screenshot({path:'/tmp/plunge-screen-capture-'+browser.browserType().name()+'.png'});
 // The initial capture is durable even if the page closes before markup completes.
 await page.reload();
 await openIdea(page);
 await page.getByText('Your unfinished idea is here, with the picture you saved earlier.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Mark where you mean',exact:true}).click();
 await page.getByRole('button',{name:'Done marking',exact:true}).waitFor();
 const area=await canvas.boundingBox();
 await page.mouse.move(area.x+area.width*.3,area.y+area.height*.3);await page.mouse.down();
 await page.mouse.move(area.x+area.width*.6,area.y+area.height*.3,{steps:8});await page.mouse.up();
 await page.getByRole('button',{name:'Done marking',exact:true}).click();
 await page.getByRole('textbox',{name:'Your idea',exact:true}).fill('Keep my screen and mark until I can send it.');
 const picture=await page.getByAltText('Screenshot 1 to send').getAttribute('src');
 if(process.env.PLUNGE_TEST_PREVIEW==='1') {
  await page.getByRole('button',{name:'Save preview idea',exact:true}).click();
  await page.getByText('Saved on this device for this preview. Nothing was sent to the family.',{exact:true}).waitFor();
  await page.reload();
  await openIdea(page);
  assert.equal(await page.getByRole('textbox',{name:'Your idea',exact:true}).inputValue(),'Keep my screen and mark until I can send it.');
  assert.equal(await page.getByAltText('Screenshot 1 to send').getAttribute('src'),picture);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ideas').first()).n,0);
  console.log('PASS:',browser.browserType().name(),'preview capture stays local and survives reload');
 } else {
 await page.getByRole('button',{name:'Save on this device',exact:true}).click();
 await page.getByText(/^Saved on this device\. Open Share an idea/).waitFor();
 await page.reload();
 await openIdea(page);
 assert.equal(await page.getByRole('textbox',{name:'Your idea',exact:true}).inputValue(),'Keep my screen and mark until I can send it.');
 assert.equal(await page.getByAltText('Screenshot 1 to send').getAttribute('src'),picture);
 for(const width of [320,375,390,428]) {
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('dialog[open]')].every(d=>d.scrollWidth<=d.clientWidth)));
 }
 failSend=true;
 await page.getByRole('button',{name:'Make an idea card',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Your idea',exact:true}).inputValue(),'Keep my screen and mark until I can send it.');
 await page.reload();
 await openIdea(page);
 assert.equal(await page.getByAltText('Screenshot 1 to send').getAttribute('src'),picture);
 // Available account authentication wins over an old invite on this device.
 await page.evaluate(()=>localStorage.setItem('plunge:ideas-invite','b'.repeat(64)));
 failSend=false;
 await page.getByRole('button',{name:'Close · keep draft',exact:true}).click();
 await openIdea(page);
 await page.getByRole('button',{name:'Make an idea card',exact:true}).click();
 await page.getByRole('link',{name:'Open your idea card',exact:true}).waitFor();
 const row=await db.prepare('SELECT member_id,account_id,body,screenshots FROM idea_messages WHERE role=?').bind('family').first();
 assert.equal(row.member_id,id(1));assert.equal(row.account_id,id(1));
 assert.equal(row.body,'Keep my screen and mark until I can send it.');
 assert.equal(JSON.parse(row.screenshots).length,1);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ideas').first()).n,1);
 await page.getByRole('button',{name:'Back to Plunge',exact:true}).click();
 if(await page.getByRole('button',{name:'← Back',exact:true}).count())await page.getByRole('button',{name:'← Back',exact:true}).click();
 await page.getByRole('button',{name:'Deal me in',exact:true}).click();
 await page.getByLabel('Your hand',{exact:true}).waitFor();
 const auction=page.getByRole('dialog',{name:'Your bid',exact:true});
 await auction.waitFor({timeout:60000});
 const pass=auction.getByRole('button',{name:'Pass',exact:true});
 await ((await pass.count())?pass:auction.getByRole('button',{name:/^Bid \d+$/}).first()).click();
 if(await page.getByRole('dialog',{name:'Declare trump',exact:true}).count()) {
  await page.getByRole('dialog',{name:'Declare trump',exact:true}).getByRole('button',{name:'Blanks',exact:true}).click();
  await page.getByLabel('Your hand',{exact:true}).getByRole('button').first().click();
 }
 // Opening feedback over a running hand must hold the solo computer and preserve the game.
 await page.evaluate(()=>window.dispatchEvent(new Event('plunge-screen-idea')));
 await page.getByRole('heading',{name:'Mark where you mean',exact:true}).waitFor();
 const held=await page.evaluate(()=>localStorage.getItem('plunge:save:v1'));
 assert.notEqual(JSON.parse(held).game.turn,0,'Exercise an actual pending computer turn');
 await page.waitForTimeout(1500);
 assert.equal(await page.evaluate(()=>localStorage.getItem('plunge:save:v1')),held);
 await page.screenshot({path:'/tmp/plunge-screen-game-'+browser.browserType().name()+'.png'});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Close · keep draft',exact:true}).click();
 await page.waitForFunction(saved=>localStorage.getItem('plunge:save:v1')!==saved,held,{timeout:60000});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('plunge:save:v1')).settings.difficulty),JSON.parse(held).settings.difficulty);
 assert.deepEqual(faults,[]);
 console.log('PASS:',browser.browserType().name(),'capture, movement cancellation, release guard, saved markup/reload, failed send/retry, account attribution, solo pause and phone widths');
 }
} finally {await browser.close();await mf.dispose();}
