// Build the default app, serve at 4178. Provider/API responses are fixtures;
// this verifies UI behavior, not real Apple/Google consent.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
const origin=process.env.PLUNGE_ACCOUNT_TEST_URL??'http://127.0.0.1:4178';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw new Error('Use a local app for account fixtures.');
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch();
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const dad={id:'d'.repeat(32),name:'Dad',provider:'apple',email:'dad@privaterelay.appleid.com',family:0,owner:0,requested:0};
  const owner={id:'a'.repeat(32),name:'Jason',provider:'google',email:'jason@example.test',family:1,owner:1,requested:0};
  let account=null;
  await page.route('**/api/account**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(route.request().method()==='POST') {
    const data=route.request().postDataJSON();
    if(path.endsWith('/request'))dad.requested=1;
    if(path.endsWith('/profile'))account.name=data.name;
    if(path.endsWith('/grant')){dad.family=data.enabled?1:0;dad.requested=0;}
    if(path.endsWith('/logout'))account=null;
    await route.fulfill({json:{ok:true}});return;
   }
   await route.fulfill({json:path.endsWith('/members')?{members:[dad]}:{account,providers:{apple:true,google:true},available:true}});
  });
  await page.goto(origin);await page.getByRole('button',{name:'Deal me in',exact:true}).waitFor();
  await page.getByRole('link',{name:'Your account · optional'}).click();
  await page.getByRole('button',{name:'Sign in with Apple'}).waitFor();await page.getByRole('button',{name:'Sign in with Google'}).waitFor();
  await page.getByRole('link',{name:'Keep playing without signing in'}).click();await page.getByRole('button',{name:'Deal me in',exact:true}).waitFor();
  account=dad;await page.goto(`${origin}/?account=1`);
  await page.getByLabel('What should we call you?').fill('Dad');await page.getByRole('button',{name:'Save name'}).click();
  await page.getByText('Your name is saved.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Ask for family access'}).click();await page.getByRole('button',{name:'Access requested'}).waitFor();
  account=owner;await page.reload();await page.getByRole('heading',{name:'Who’s at the family table?'}).waitFor();
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.getByRole('button',{name:'Grant family access'}).click();await page.getByRole('button',{name:'Remove family access'}).waitFor();
  account=dad;await page.reload();await page.getByRole('link',{name:'Open family ideas'}).waitFor();
  await page.evaluate(()=>localStorage.setItem('plunge:ideas-invite','x'));
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in with Apple'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('plunge:ideas-invite')),null);
  await page.screenshot({path:`/tmp/plunge-optional-account-${engine.name()}.png`,fullPage:true});
  console.log(`${engine.name()}: PASS optional guest route, provider choices, profile, request, owner grant, family access, logout, phone layout`);
 }finally{await browser.close();}
}
