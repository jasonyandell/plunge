// End-to-end browser check: load the page, pass, play a full game to 100
// (human = first legal card), collect console errors and Walt ms/move.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node e2e.mjs [url]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://127.0.0.1:8765/lab/hearts/?fast';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForSelector('#hand .card');
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/pass.png' : '/dev/null' });
const t0 = Date.now();
let hands = 0, shot = false;
while (Date.now() - t0 < 540000) {
  const st = await page.evaluate(() => ({ phase: window.__hearts.phase, over: window.__hearts.gameOver, human: !!window.__hearts.humanResolve }));
  if (st.over) break;
  if (st.phase === 'pass') {
    for (const i of [12, 11, 10]) await page.click(`#hand .card >> nth=${i}`);
    await page.click('#actions button');
  } else if (st.phase === 'idle') {
    hands++;
    await page.click('#actions button');
  } else if (st.human) {
    if (!shot && process.env.SHOT_DIR) { await page.screenshot({ path: process.env.SHOT_DIR + '/play.png' }); shot = true; }
    await page.click('#hand .card.legal');
  }
  await page.waitForTimeout(20);
}
const res = await page.evaluate(() => ({ scores: window.__hearts.scores, history: window.__hearts.history, ms: window.__hearts.allMs, status: document.getElementById('status').textContent, over: window.__hearts.gameOver }));
if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/end.png', fullPage: true });
const ms = res.ms.slice().sort((a, b) => a - b);
console.log(JSON.stringify({
  over: res.over, hands: res.history.length, scores: res.scores, status: res.status,
  waltMoves: ms.length, msMean: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
  msMedian: ms[ms.length >> 1], msP95: ms[Math.floor(ms.length * 0.95)], msMax: ms[ms.length - 1],
  consoleErrors: errors, wallSec: (Date.now() - t0) / 1000,
}));
await browser.close();
