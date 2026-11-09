// End-to-end page check: node lab/spades/e2e.cjs [port] [hands]
// Serves nothing itself: start `python3 -m http.server PORT` in public/ first.
// Plays as South (suggested bid, then a random legal card) until a game ends or
// `hands` hands are done; reports console errors and Walt ms/move from the page.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const port = process.argv[2] || '8765';
  const maxHands = +(process.argv[3] || 40);
  const mobile = process.argv[4] === 'mobile';
  const browser = await chromium.launch();
  const ctx = await browser.newContext(mobile ? { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${port}/lab/spades/?quick`);
  let hands = 0, plays = 0, gameOver = false;
  const t0 = Date.now();
  while (hands < maxHands && Date.now() - t0 < 540000) {
    const msg = await page.textContent('#msg');
    if (msg.startsWith('Error')) { errors.push('page: ' + msg); break; }
    if (await page.$('button.sugg')) { await page.click('button.sugg'); continue; }
    const legal = await page.$$('#hand button.legal');
    if (legal.length) { await legal[Math.floor(Math.random() * legal.length)].click(); plays++; continue; }
    const next = await page.$('#bar button.primary');
    if (next) {
      const label = await next.textContent();
      hands++;
      if (hands <= 2 || label === 'New game') console.log('hand', hands, '|', msg);
      if (label === 'New game') {
        gameOver = true;
        if (!mobile) await page.screenshot({ path: process.env.SHOT || 'shot.png' });
        break;
      }
      await next.click();
      continue;
    }
    await page.waitForTimeout(30);
  }
  if (mobile) await page.screenshot({ path: process.env.SHOT || 'shot-mobile.png' });
  const perf = await page.textContent('#perf');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth + 'x' + window.innerWidth);
  console.log(JSON.stringify({ hands, plays, gameOver, perf, scrollW_vs_innerW: sw, seconds: (Date.now() - t0) / 1000, errors }));
  await browser.close();
})();
