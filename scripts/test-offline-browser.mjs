/** Offline from the first launch: open the built game once, cut the connection
 * entirely, reload, and play a whole hand against real Walt. Then ship a new
 * build and check the update lands complete, keeping Walt's saved copy.
 * npm run build && node scripts/test-offline-browser.mjs   (bounded to 180s)
 *
 * Serves dist/ itself under a made-up host name: the page skips its service
 * worker on localhost, so the check must look like the real site.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const player = process.env.PLUNGE_TEST_PLAYER ?? 'Walt';
if(!['Walt','Zeb'].includes(player)) throw new Error('PLUNGE_TEST_PLAYER must be Walt or Zeb.');
const HOST = 'plunge.localhost'; // secure like https, yet not the page's dev host
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.onnx': 'application/octet-stream' };
const out = await mkdtemp(join(tmpdir(), 'plunge-offline-qa-'));
const root = join(out, 'dist');
await cp('dist', root, { recursive: true });
const served = [];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  served.push(path);
  if (path.startsWith('/api/')) { res.writeHead(503).end(); return; }
  const file = join(root, path.endsWith('/') ? 'index.html' : path);
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body); }
  catch { // single-page fallback, like the real site
    if (extname(path)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(await readFile(join(root, 'index.html')));
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://${HOST}:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLUNGE_CHROMIUM ? { executablePath: process.env.PLUNGE_CHROMIUM } : {}),
  args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
const checks = [];
const check = m => { checks.push(m); console.log('OK', m); };
const faults = [];
let page, stage='install';
const deadline = setTimeout(() => { console.error('Offline browser check exceeded 180 seconds'); process.exit(1); }, 180000);
const cached = page => page.evaluate(async () => { const all = []; for (const k of await caches.keys()) all.push([k, (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname)]); return all; });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  // A reproducible hand, with real clocks for workers, pacing, and timeouts.
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => faults.push(String(e)));

  // First launch: nothing played yet, Walt never asked for a move.
  await page.goto(origin + '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => page.reload());
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  const first = await cached(page);
  if (first.length !== 1 || !first[0][1].some(p => p.endsWith('.wasm')) || !first[0][1].includes('/')) throw new Error('Install did not save the whole game: ' + JSON.stringify(first));
  if (served.some(p => p.endsWith('.wasm')) && !served.includes('/sw.js')) throw new Error('Unexpected fetch order.');
  check(`Install saved the whole game before any play (${first[0][1].length} files, Walt included).`);

  // No connection at all: the server is gone, not just throttled.
  stage='disconnect';
  const closed = new Promise(r => server.close(r)); server.closeAllConnections(); await closed;
  await ctx.setOffline(true);
  await page.reload();
  if(player==='Zeb') {
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.getByRole('radio',{name:'Zeb',exact:true}).click();
    await page.getByRole('button',{name:'← Back',exact:true}).click();
    await page.reload();
    await page.getByRole('button',{name:'More',exact:true}).click();
    if(await page.getByRole('radio',{name:'Zeb',exact:true}).getAttribute('aria-checked')!=='true')throw new Error('Zeb selection was not saved.');
    await page.screenshot({path:join(out,'zeb-settings.png')});
    await page.getByRole('button',{name:'← Back',exact:true}).click();
  }
  await page.getByRole('button', { name: 'Deal me in', exact: true }).click();
  stage='play offline';
  const end = Date.now() + 120000;
  let moves = 0, hintChecked = false;
  while (Date.now() < end) {
    if (await page.getByRole('dialog', { name: 'Hand over' }).count()) break;
    const bid = page.getByRole('dialog', { name: 'Your bid' });
    if (await bid.count()) {
      if(player==='Zeb' && !hintChecked) {
        await bid.getByRole('button',{name:'Help me bid',exact:true}).click();
        await page.getByRole('heading',{name:/Zeb suggests/}).waitFor({timeout:30000});
        await page.screenshot({path:join(out,'zeb-bid-hint.png')});
        await page.getByRole('button',{name:'Back to my bid',exact:true}).click();
        hintChecked=true;
      }
      const pass = bid.getByRole('button', { name: 'Pass', exact: true });
      await ((await pass.count()) ? pass : bid.getByRole('button', { name: /^Bid \d+$/ })).first().click().catch(() => {}); moves++; continue;
    }
    const declare = page.getByRole('dialog', { name: 'Declare trump' });
    if (await declare.count()) { await declare.getByRole('button', { name: 'Blanks', exact: true }).click().catch(() => {}); moves++; continue; }
    const playable = page.getByLabel('Your hand').getByRole('button');
    if (await playable.count()) { await playable.first().click().catch(() => {}); moves++; continue; }
    await page.waitForTimeout(150);
  }
  if (!await page.getByRole('dialog', { name: 'Hand over' }).count()) throw new Error(`The hand never finished offline (${moves} moves).`);
  await page.screenshot({ path: join(out, 'offline-hand-over.png') });
  check(`Played a whole hand against ${player} with no connection (${moves} of our moves).`);

  if(player==='Zeb') {
    const records=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const opened=indexedDB.open('plunge-walt',1);
      opened.onerror=()=>reject(opened.error);
      opened.onsuccess=()=>{const db=opened.result,r=db.transaction('receipts').objectStore('receipts').getAll();
        r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};
    }));
    if(!records.length || records.some(r=>r.identity.player.name!=='zeb-0.4.1' || !r.response.zeb_result))throw new Error('Computer moves did not retain Zeb receipts.');
    if(!hintChecked)throw new Error('The test did not exercise the Zeb bidding hint.');
    check('Zeb selection survived reload and its live bidding hint worked offline.');
  }

  // A new version ships: only changed files download; Walt's copy carries over.
  stage='update';
  const sw = join(root, 'sw.js');
  await writeFile(sw, (await readFile(sw, 'utf8')).replace(/const BUILD = "[^"]*";/, 'const BUILD = "next";'));
  served.length = 0;
  await new Promise(r => server.listen(Number(new URL(origin).port), '127.0.0.1', r));
  await ctx.setOffline(false);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForFunction(() => caches.has('plunge-next').then(async has => has && (await caches.keys()).length && (await navigator.serviceWorker.getRegistration()).active?.state === 'activated' && !(await navigator.serviceWorker.getRegistration()).installing), null, { timeout: 20000, polling: 250 });
  const after = await cached(page);
  if (served.some(p => p.startsWith('/assets/'))) throw new Error('The update downloaded unchanged files again: ' + JSON.stringify(served));
  if (!after.some(([k, files]) => k === 'plunge-next' && files.some(p => p.endsWith('.wasm')))) throw new Error('The update lost Walt: ' + JSON.stringify(after));
  if (after.length !== 2) throw new Error('Expected this version and the one before it: ' + JSON.stringify(after.map(([k]) => k)));
  check('An update saved itself complete without re-downloading Walt, and kept the version before it.');

  if (faults.length) throw new Error('Browser faults: ' + JSON.stringify(faults));
  console.log(`\n${checks.length} checks passed. Screenshot: ${out}`);
} catch (e) {
  console.error(`Offline check failed during ${stage}:`, e); console.error('Faults:', faults);
  if(page) {
    console.error('Visible state:', await page.locator('body').innerText({timeout:2000}).catch(()=>'(unavailable)'));
    await page.screenshot({path:join(out,'failure.png'),timeout:2000}).catch(()=>{});
  }
  process.exitCode = 1;
} finally {
  clearTimeout(deadline); await browser.close(); server.close();
}
