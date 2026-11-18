// All HTTPS requests are intercepted locally. This uses the real account worker,
// a temporary D1 database, and Chromium's virtual passkey authenticator.
// Requires Node 22.18+ and an ordinary `npm run build`; contacts no deployed service.
import {chromium,webkit} from 'playwright';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
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

const {releaseAccepted}=await import('./ideas/releases.mjs');
const {createHash}=await import('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex'),id=n=>n.toString(16).padStart(32,'0');
const idea=id(100),sha='a'.repeat(40),merge='b'.repeat(40);
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
 const owner=await person(1,'Jason',1),dad=await person(2,'Mike',0);
 await db.prepare("INSERT INTO ideas(id,member_id,title,context,created,updated) VALUES(?,?,'Two rows of dominoes','Phone','now','now')").bind(idea,id(2)).run();
 await db.prepare("INSERT INTO idea_messages(id,idea_id,member_id,role,body,created) VALUES(?,?,?,'family','Show four horizontal dominoes above three.','now')").bind(idea,idea,id(2)).run();
 await db.prepare("UPDATE ideas SET status='ready',pr=74,sha=?,preview='https://plunge-pr-74.texas42.workers.dev',preview_revision=revision WHERE id=?").bind(sha,idea).run();
 await dad.goto(`${origin}/?ideas=1#idea=${idea}`);
 await dad.getByText('Jason can accept this preview into everyone’s game from his account.',{exact:true}).waitFor();
 assert.equal(await dad.getByRole('button',{name:'Accept into the game',exact:true}).count(),0);
 assert.equal(await dad.evaluate(async({idea,sha})=>(await fetch(`/api/ideas/${idea}/accept`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:1,pr:74,sha})})).status,{idea,sha}),403);
 await owner.goto(`${origin}/?ideas=1#idea=${idea}`);
 const accept=owner.getByRole('button',{name:'Accept into the game',exact:true});await accept.waitFor();
 for(const width of [320,375,390,428]) {await owner.setViewportSize({width,height:844});assert.equal(await owner.evaluate(()=>document.documentElement.scrollWidth),width);}
 await owner.screenshot({path:'/tmp/plunge-accept-before-'+browser.browserType().name()+'.png',fullPage:true});
 await accept.click();await owner.getByText('Accepted. Waiting for the release check.',{exact:true}).waitFor();
 await owner.reload();await owner.getByText('Accepted. Waiting for the release check.',{exact:true}).waitFor();
 const service=async(path,data)=>{
  const response=await mf.dispatchFetch(`${origin}/api/ideas/admin/${path}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${admin}`},...(data?{body:JSON.stringify(data)}:{})});
  assert.equal(response.status,200);return response.json();
 };
 let merged=false,mergeCalls=0;
 const gh=async args=>{
  if(args[0]==='pr'&&args[1]==='view')return JSON.stringify({state:merged?'MERGED':'OPEN',headRefOid:sha,baseRefName:'main',isCrossRepository:false,isDraft:false,mergeable:'MERGEABLE',statusCheckRollup:['test','deploy'].map(name=>({name,status:'COMPLETED',conclusion:'SUCCESS'})),mergeCommit:merged?{oid:merge}:null});
  if(args[1]==='merge'){assert.equal(args.at(-1),sha);mergeCalls++;merged=true;return '';}
  throw Error('Unexpected command '+args.join(' '));
 };
 const version=async url=>url.includes('-pr-')?{build:sha,preview_pr:74}:{build:merge};
 await releaseAccepted({service,gh,version});
 await owner.reload();await owner.getByText('Accepted. The update is being released to everyone’s game.',{exact:true}).waitFor();
 await releaseAccepted({service,gh,version});
 await owner.reload();await owner.getByRole('link',{name:'Play the updated game',exact:true}).waitFor();
 assert.equal(mergeCalls,1);assert.equal(await owner.getByRole('button',{name:'Accept into the game',exact:true}).count(),0);
 console.log('PASS:',browser.browserType().name(),'owner acceptance, family denial, reload, exact-preview release, live status and phone widths');
} finally {await browser.close();await mf.dispose();}
