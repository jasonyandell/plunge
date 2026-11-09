// End-to-end page check with Playwright/Chromium: plays hands as a human
// (a simple random clicker) against the real worker until the given number of
// hands is done or the match ends. Reports console errors and Walt's ms/move.
// Usage: (from public/) python3 -m http.server 8765 &  then
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node page_check.mjs [hands] [width] [cpuSlowdown]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const hands = +(process.argv[2] || 6), width = +(process.argv[3] || 390), slow = +(process.argv[4] || 1);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
if (slow > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow }); }
await page.goto('http://localhost:8765/lab/holdem/' + (process.env.QS || ''), { waitUntil: 'load' });
const ms = [];
let played = 0, lastWhy = '';
const t0 = Date.now();
while (played < hands && Date.now() - t0 < 540000) {
  const st = await page.evaluate(() => ({
    next: !document.getElementById('bNext').disabled,
    btns: ['bFold', 'bCall', 'bRaise'].filter((id) => !document.getElementById(id).disabled),
    msg: document.getElementById('msg').textContent, why: document.getElementById('why').textContent,
  }));
  if (st.why !== lastWhy) { lastWhy = st.why; const m = st.why.match(/, (\d+) ms\)/); if (m) ms.push(+m[1]); }
  if (/Match over/.test(st.msg)) break;
  if (st.next) { if (played > 0 || /Press Deal/.test(st.msg) || true) { await page.click('#bNext'); played++; } }
  else if (st.btns.length) {
    const pick = st.btns.includes('bCall') && Math.random() < 0.6 ? 'bCall' : st.btns[Math.floor(Math.random() * st.btns.length)];
    await page.click('#' + pick);
  }
  await page.waitForTimeout(120);
}
// let the last hand finish
for (let i = 0; i < 300; i++) {
  const done = await page.evaluate(() => !document.getElementById('bNext').disabled || /Match over/.test(document.getElementById('msg').textContent));
  if (done) break;
  const btns = await page.evaluate(() => ['bCall'].filter((id) => !document.getElementById(id).disabled));
  if (btns.length) await page.click('#bCall');
  await page.waitForTimeout(150);
}
const log = await page.evaluate(() => document.getElementById('log').textContent);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
await page.screenshot({ path: process.env.SHOT || '/tmp/holdem.png', fullPage: true });
await browser.close();
ms.sort((a, b) => a - b);
console.log(log.split('\n').slice(-25).join('\n'));
console.log(JSON.stringify({ handsDealt: played, waltMoves: ms.length, msMedian: ms[ms.length >> 1], msMax: ms[ms.length - 1], horizontalOverflow: overflow, errors }));
