// Mid-hand screenshot: node lab/spades/shot.cjs port out.png [mobile]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [port, out, mode] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(mode === 'mobile' ? { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } : { viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/lab/spades/`);
  await page.waitForSelector('button.sugg', { timeout: 20000 });
  await page.click('button.sugg');
  for (let k = 0; k < 3; k++) {
    await page.waitForSelector('#hand button.legal', { timeout: 30000 });
    await page.click('#hand button.legal');
  }
  await page.waitForSelector('#hand button.legal', { timeout: 30000 });
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ errors }));
  await browser.close();
})();
