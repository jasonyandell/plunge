// The invite walkthrough on a preview build: real account screens, sample backend.
// Build with `PLUNGE_ROOMS=experimental PLUNGE_QUESTIONS=local-only npm run build`,
// serve with `npm run preview -- --host 127.0.0.1 --port 4179`, then run this.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const origin=process.env.PLUNGE_DEMO_ORIGIN??'http://127.0.0.1:4179';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const api=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))api.push(`${r.method()} ${u.pathname}`);});
 await page.goto(origin);
 await page.getByRole('link',{name:'Try signing in: sample walkthrough'}).click();
 await page.getByText('Sample walkthrough: inviting family').waitFor();
 const before=api.length;
 await page.getByRole('heading',{name:'Hi, Mom.',exact:true}).waitFor();
 await page.getByLabel('Their name').fill('Benny');await page.getByRole('button',{name:'Send an invite'}).click();
 assert.match(await page.getByLabel('Invite for Benny').inputValue(),/\?account=1&demo=invite#join=[a-f0-9]{64}$/);
 await page.locator('.account-invites li').filter({hasText:'Benny'}).getByText('Not yet').waitFor();
 await page.screenshot({path:'/tmp/plunge-demo-mom.png',fullPage:true});
 await page.getByRole('button',{name:'Open it on Benny’s phone →'}).click();
 await page.getByRole('heading',{name:'Hi, Benny.',exact:true}).waitFor();
 await page.getByText('Mom saved you a seat at the family table.',{exact:true}).waitFor();
 await page.getByText(/Your 23 hands from this browser come with you\./).waitFor();
 for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.screenshot({path:'/tmp/plunge-demo-benny.png',fullPage:true});
 await page.getByRole('button',{name:'Save my seat'}).click();
 await page.getByRole('heading',{name:'You’re in, Benny.',exact:true}).waitFor();
 await page.getByText(/Your seat is saved, along with 23 hands from here\./).waitFor();
 await page.screenshot({path:'/tmp/plunge-demo-joined.png',fullPage:true});
 await page.getByRole('button',{name:'Mom’s phone'}).click();
 await page.locator('.account-invites li').filter({hasText:'Benny'}).getByText('Joined').waitFor();
 // The used link no longer works, like the real one.
 await page.getByRole('button',{name:'Benny’s phone'}).click();await page.getByRole('heading',{name:'Hi, Benny.',exact:true}).waitFor();
 await page.getByRole('link',{name:'See Benny’s home screen →'}).click();
 await page.getByRole('link',{name:'Signed in as Benny in the sample walkthrough'}).waitFor();
 await page.screenshot({path:'/tmp/plunge-demo-home.png'});
 assert.deepEqual(api.slice(before).filter(r=>!r.startsWith('GET /api/rooms')&&r!=='GET /api/account'),[]);
 // Start over clears it.
 await page.getByRole('link',{name:'Signed in as Benny in the sample walkthrough'}).click();
 await page.getByRole('button',{name:'Start over'}).click();await page.getByRole('heading',{name:'Hi, Mom.',exact:true}).waitFor();
 assert.equal(await page.locator('.account-invites').count(),0);
 console.log('PASS: invite walkthrough on a preview build — Mom invites, Benny saves his seat with his hands, Joined, home chip, start over, no account requests.');
}finally{await browser.close();}
