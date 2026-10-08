// Build with the default (remote) question mode, then serve with Vite preview.
// Ideas API fixtures are intercepted in the browser; the embedded bidding game is real.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
const origin=process.env.PLUNGE_IDEAS_NAV_URL ?? 'http://127.0.0.1:4178';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw new Error('Use a local app for API fixtures.');
const id='1234567890abcdef1234567890abcdef';
for(const engine of [chromium,webkit]) {
  const browser=await engine.launch();
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    page.on('pageerror',e=>console.error(e));
    const thread={card:{id,number:1,name:'Mom',title:'I can’t see what I bid.',status:'ready',pr:22,preview:'https://plunge-pr-22.texas42.workers.dev'},messages:[]};
    await page.route('**/api/ideas**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(route.request().method()==='PUT')thread.messages.push({...route.request().postDataJSON(),role:'family',name:'Mom'});
      const data=path.endsWith('/me')?{name:'Mom'}:path==='/api/ideas'?{cards:[thread.card],next:null}:thread;
      await route.fulfill({json:data});
    });
    await page.goto(`${origin}/?ideas=1#invite=${'a'.repeat(64)}&idea=${id}`);
    await page.getByRole('heading',{name:thread.card.title,exact:true}).waitFor();
    await page.getByLabel('Keep the conversation going').fill('Make my bid bigger, please.');
    await page.getByRole('button',{name:'Try your change'}).click();
    const frame=page.frameLocator('iframe');
    await frame.getByRole('button',{name:'Deal me in',exact:true}).click();
    await frame.getByRole('dialog',{name:'Your bid',exact:true}).waitFor({timeout:60000});
    await frame.getByRole('button',{name:/^Bid \d/}).first().click();
    assert.equal(new URL(page.url()).origin,origin);assert.equal(context.pages().length,1);
    for(const width of [320,390]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const bar=await page.locator('.idea-trial-bar').boundingBox();assert.ok(bar.height<=65,'Keep game space on phones');
    }
    await frame.locator('body').evaluate(()=>history.pushState(null,'','#inside-game'));
    await page.getByRole('button',{name:'Back to your idea'}).click();
    assert.equal(await page.getByLabel('Keep the conversation going').inputValue(),'Make my bid bigger, please.');
    await page.getByRole('button',{name:'Try your change'}).click();
    await page.goBack();await page.getByRole('heading',{name:thread.card.title,exact:true}).waitFor();
    await page.goForward();await page.locator('iframe').waitFor();
    await page.reload();await page.locator('iframe').waitFor();
    await page.getByRole('button',{name:'Back to your idea'}).click();
    await page.getByRole('button',{name:'Send reply'}).click();
    await page.getByText('Make my bid bigger, please.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Try your change'}).click();await page.goBack();
    await page.getByRole('heading',{name:thread.card.title,exact:true}).waitFor();
    // A directly opened preview link has no local Back entry, so the button replaces its hash.
    const direct=await context.newPage();
    await direct.route('**/api/ideas**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/me')?{name:'Mom'}:new URL(route.request().url()).pathname==='/api/ideas'?{cards:[thread.card],next:null}:thread}));
    await direct.goto(`${origin}/?ideas=1#idea=${id}&try=1`);await direct.locator('iframe').waitFor();
    await direct.getByRole('button',{name:'Back to your idea'}).click();await direct.getByRole('heading',{name:thread.card.title,exact:true}).waitFor();
    // A stale link cannot enter a preview that is no longer verified ready.
    thread.card.status='checking';await direct.goto(`${origin}/?ideas=1#idea=${id}&try=1`);
    await direct.getByRole('alert').waitFor();assert.equal(await direct.locator('iframe').count(),0);
    await direct.getByRole('button',{name:'Back to your idea'}).click();await direct.getByRole('heading',{name:thread.card.title,exact:true}).waitFor();
    console.log(`${engine.name()}: PASS same-app play, compact phone controls, drafts, reply, Back/Forward/reload/direct links, stale preview guard`);
  }finally{await browser.close();}
}
