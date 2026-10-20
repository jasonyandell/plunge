/** Real local room, four isolated phones, through a complete hand. Run after a build with PLUNGE_ROOMS=experimental.
 * Moves use legal engine actions; result readiness is exercised through the UI. */
import { chromium, webkit } from 'playwright';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const html = await readFile('dist/index.html', 'utf8');
assert.match(html, /name="plunge-rooms" content="experimental"/);
assert.match(html, /name="plunge-questions" content="remote"/);
const out = await mkdtemp(join(tmpdir(), 'plunge-hand-pause-'));
const bundled = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' };
const mf = new Miniflare({ host: '127.0.0.1', port: 0, modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-05-14',
  durableObjects: { ROOMS: { className: 'PlungeRoom', useSQLite: true } },
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname, file = resolve('dist', path === '/' ? 'index.html' : path.slice(1));
    if (!file.startsWith(resolve('dist') + '/')) return new Response('', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' } }); }
    catch { return new Response('', { status: 404 }); }
  } } });
const origin = (await mf.ready).origin;
const browser = await (process.env.PLUNGE_TEST_BROWSER === 'webkit' ? webkit : chromium).launch();
const deadline = setTimeout(() => { console.error('Hand pause check exceeded 120 seconds'); process.exit(1); }, 120000);
const engine = await build({ stdin: { contents: "export { legalActions } from './src/engine';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { legalActions } = await import('data:text/javascript;base64,' + Buffer.from(engine.outputFiles[0].text).toString('base64'));
try {
  const post = async (path, name) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200); return response.json();
  };
  const first = await post('/api/rooms', 'Host'), credentials = [first];
  for (const name of ['Mom', 'Uncle', 'Dad']) credentials.push(await post(`/api/rooms/${first.roomId}/join`, name));
  const pages = [];
  for (const key of credentials) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.addInitScript(key => {
      localStorage.setItem('plunge:room:' + key.roomId, JSON.stringify(key));
      const Real = WebSocket;
      window.WebSocket = class extends Real { constructor(...args) {
        super(...args); window.__socket = this;
        this.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.type === 'state') window.__room = message; });
      } };
    }, key);
    await page.goto(`${origin}/?rooms=1#room=${first.roomId}`);
    await page.getByRole('heading', { name: 'Pull up a chair', exact: true }).waitFor();
    pages[key.seat] = page;
  }
  const host = pages[0], state = () => host.evaluate(() => window.__room);
  await host.getByRole('button', { name: 'Start with 4 people + Walt', exact: true }).click();
  for (const seat of [1, 2, 3]) await pages[seat].getByRole('button', { name: 'Fine', exact: true }).click();
  await host.waitForFunction(() => window.__room?.game?.phase === 'bidding');
  let moves = 0;
  while ((await state()).game.phase !== 'hand-over') {
    const current = await state(); assert.ok(moves < 40, 'A legal hand must finish');
    const wait = current.holdUntil - Date.now(); if (wait > 0) await host.waitForTimeout(wait + 20);
    const action = legalActions(current.game)[0];
    await pages[current.game.turn].evaluate(command => window.__socket.send(JSON.stringify(command)), {
      type: 'action', id: 'test-move-' + moves++, revision: current.revision, action,
    });
    await host.waitForFunction(revision => window.__room.revision > revision, current.revision);
  }
  const finished = await state();
  assert.equal(await host.getByRole('dialog', { name: 'Hand over', exact: true }).count(), 0, 'Final trick remains visible before the result');
  assert.equal(await host.locator('.played-domino').count(), finished.game.tricks.at(-1).plays.length);
  for (const page of pages) await page.getByRole('dialog', { name: 'Hand over', exact: true }).waitFor();
  const ready = page => page.getByRole('button', { name: 'Ready for the next hand', exact: true });
  await ready(host).click(); await ready(pages[2]).click();
  await host.getByRole('button', { name: 'Waiting for others…', exact: true }).waitFor();
  await host.waitForTimeout(5500);
  for (const page of pages) { assert.equal(await page.getByRole('dialog', { name: 'Hand over', exact: true }).count(), 1); }
  assert.equal((await state()).game.handNumber, finished.game.handNumber);
  assert.equal(await host.getByRole('button', { name: 'Waiting for others…', exact: true }).isDisabled(), true);
  // Reading the completed hand, or reloading, does not signal readiness.
  await pages[3].getByRole('button', { name: 'See how it went', exact: true }).click();
  await pages[3].reload();
  await ready(pages[3]).waitFor();
  assert.equal((await state()).game.handNumber, finished.game.handNumber);
  for (const width of [320,375,390,428]) {
    await host.setViewportSize({ width, height:844 });
    assert.equal(await host.evaluate(() => document.documentElement.scrollWidth), width);
  }
  await host.screenshot({ path: join(out, 'waiting-for-everyone.png'), fullPage:true });
  await ready(pages[1]).click();
  assert.equal((await state()).game.handNumber, finished.game.handNumber);
  await ready(pages[3]).click();
  await host.waitForFunction(hand => window.__room.game.handNumber === hand + 1, finished.game.handNumber);
  const next = await state();
  assert.equal(next.sessionId, finished.sessionId); assert.deepEqual(next.game.marks, finished.game.marks);
  assert.equal(next.recentHands.at(-1).game.handNumber, finished.game.handNumber);
  console.log('PASS: final trick pauses; two of four ready cannot deal; reading/reloading preserves the result; all four ready deal exactly once.');
  console.log('Screenshots:', out);
} finally { clearTimeout(deadline); await browser.close(); await mf.dispose(); }
