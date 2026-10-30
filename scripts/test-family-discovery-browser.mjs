/** Real local room + D1, four isolated phones. Run after a build with PLUNGE_ROOMS=experimental.
 * Fixtures provision two family accounts; joining, discovery, votes, and game state use the real worker. */
import { chromium, webkit } from 'playwright';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const html = await readFile('dist/index.html', 'utf8');
assert.match(html, /name="plunge-rooms" content="experimental"/);
assert.match(html, /name="plunge-questions" content="remote"/);
const out = await mkdtemp(join(tmpdir(), 'plunge-discovery-'));
const bundled = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' };
const mf = new Miniflare({ host: '127.0.0.1', port: 0, modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-05-14',
  durableObjects: { ROOMS: { className: 'PlungeRoom', useSQLite: true } }, d1Databases: ['QUESTIONS'],
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname, file = resolve('dist', path === '/' ? 'index.html' : path.slice(1));
    if (!file.startsWith(resolve('dist') + '/')) return new Response('', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' } }); }
    catch { return new Response('', { status: 404 }); }
  } } });
const origin = (await mf.ready).origin;
const browser = await (process.env.PLUNGE_TEST_BROWSER === 'webkit' ? webkit : chromium).launch();
const deadline = setTimeout(() => { console.error('Family discovery check exceeded 120 seconds'); process.exit(1); }, 120000);
try {
  const db = await mf.getD1Database('QUESTIONS');
  const [tables, trigger] = (await readFile('migrations/0002_family_ideas.sql', 'utf8')).split('CREATE TRIGGER');
  for (const statement of tables.split(';').filter(s => s.trim())) await db.prepare(statement).run();
  await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for (const file of ['0003_accounts.sql', '0004_family_table.sql', '0005_listed_tables.sql'])
    for (const statement of (await readFile(`migrations/${file}`, 'utf8')).split(';').filter(s => s.trim())) await db.prepare(statement).run();
  const seats = [];
  for (const [digit, name] of [['1', 'Host'], ['2', 'Mom']]) {
    const id = digit.repeat(32), token = digit.repeat(64);
    await db.prepare('INSERT INTO accounts(id,name,owner,created) VALUES(?,?,1,?)').bind(id, name, Date.now()).run();
    await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)').bind(createHash('sha256').update(token).digest('hex'), id, Date.now() + 86400000).run();
    const response = await fetch(origin + '/api/rooms/family', { method: 'POST', headers: { Origin: origin, Cookie: `__Host-plunge-session=${token}` } });
    assert.equal(response.status, 200); seats.push(await response.json());
  }
  const phone = async (seat, account) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    // Account endpoints are restricted to the production origin. Dispatch those to
    // this local worker under that origin; provisioned sessions never leave Miniflare.
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!account && !url.pathname.startsWith('/api/account')) return route.continue();
      const headers = { ...request.headers(), ...(account ? { cookie: `__Host-plunge-session=${account.repeat(64)}` } : {}) };
      const target = 'https://plunge.texas42.workers.dev' + url.pathname + url.search;
      headers.origin = 'https://plunge.texas42.workers.dev';
      const response = await mf.dispatchFetch(target, { method: request.method(), headers, ...(request.postData() ? { body: request.postData() } : {}) });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.addInitScript(seat => {
      if (seat) { localStorage.setItem('plunge:room:' + seat.roomId, JSON.stringify(seat)); localStorage.setItem('plunge:room:last', seat.roomId); }
      const Real = WebSocket;
      window.WebSocket = class extends Real { constructor(...args) { super(...args); this.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.type === 'state') window.__room = m; }); } };
    }, seat ?? null);
    return page;
  };
  const host = await phone(seats[0]), mom = await phone(seats[1]), guest = await phone(), knocker = await phone();
  const room = `${origin}/?rooms=1#room=${seats[0].roomId}`;
  await host.goto(room); await host.getByText('Pull up a chair', { exact: true }).waitFor();
  await host.getByRole('radio', { name: 'Zeb', exact: true }).click();
  await host.waitForFunction(() => window.__room?.player === 'zeb');
  await host.getByRole('button', { name: 'Table', exact: true }).click();
  await host.getByRole('button', { name: 'Open the table', exact: true }).click();
  await host.waitForFunction(() => window.__room?.open === true);
  if (await host.getByRole('button', { name: 'Back to the table', exact: true }).count()) await host.getByRole('button', { name: 'Back to the table', exact: true }).click();
  await mom.goto(room); await mom.getByText('Pull up a chair', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Start with 2 people + Zeb', exact: true }).click();
  await mom.getByRole('button', { name: 'Fine', exact: true }).click();
  await host.waitForFunction(() => !!window.__room?.game);
  const before = await host.evaluate(() => ({ session: window.__room.sessionId, hand: window.__room.game.handNumber, seats: window.__room.seats.map(s => s?.name) }));
  await guest.goto(origin); await guest.locator('[data-entry="family"]').click();
  const listing = guest.getByRole('region', { name: 'People playing now' });
  await listing.getByRole('button', { name: /Host, Mom here.*Join/ }).waitFor();
  for (const width of [320, 375, 390, 428]) { await guest.setViewportSize({ width, height: 844 }); assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth), width); }
  await guest.screenshot({ path: join(out, 'home.png'), fullPage: true });
  await listing.getByRole('button', { name: /Join$/ }).click();
  await guest.getByRole('textbox', { name: 'Your name', exact: true }).fill('Uncle');
  await guest.getByRole('button', { name: 'Join the table', exact: true }).click();
  await guest.waitForFunction(() => !!window.__room?.game && window.__room.seats.some(s => s?.name === 'Uncle' && s.connected));
  await host.waitForFunction(() => window.__room.seats.some(s => s?.name === 'Uncle' && s.connected));
  const after = await host.evaluate(() => ({ session: window.__room.sessionId, hand: window.__room.game.handNumber, seats: window.__room.seats.map(s => s?.name) }));
  assert.equal(after.session, before.session); assert.equal(after.hand, before.hand); assert.equal(after.seats[0], 'Host'); assert.equal(after.seats[2], 'Mom');
  await guest.screenshot({ path: join(out, 'joined-mid-hand.png') });
  console.log('PASS: fresh guest finds the live table from Home’s Play together and joins mid-hand without changing the game or existing seats.');
  await host.getByRole('button', { name: 'Table', exact: true }).click();
  await host.getByRole('button', { name: 'Close the table', exact: true }).click();
  await host.waitForFunction(() => window.__room.open === false);
  if (await host.getByRole('button', { name: 'Back to the table', exact: true }).count()) await host.getByRole('button', { name: 'Back to the table', exact: true }).click();
  await knocker.goto(origin + '/?rooms=1');
  await knocker.getByRole('region', { name: 'People playing now' }).getByRole('button', { name: /Knock$/ }).click();
  await knocker.getByRole('textbox', { name: 'Your name', exact: true }).fill('Cousin');
  await knocker.getByRole('button', { name: 'Join the table', exact: true }).click();
  await host.getByRole('button', { name: 'Let them in', exact: true }).click();
  await knocker.waitForFunction(() => !!window.__room?.game && window.__room.seats.some(s => s?.name === 'Cousin' && s.connected));
  assert.equal(await knocker.evaluate(() => window.__room.sessionId), before.session);
  console.log('PASS: family-play page finds the same table; a closed door still requires a person to let the newcomer in.');
  // A full table still belongs to its authenticated players on a fresh phone.
  const returning = await phone(undefined, '2');
  await returning.goto(origin);
  await returning.locator('[data-entry="family"]').click();
  await returning.waitForFunction(() => !!window.__room?.game);
  assert.equal(await returning.evaluate(() => JSON.parse(localStorage.getItem('plunge:room:' + window.__room.roomId)).seat), seats[1].seat);
  assert.equal(await returning.evaluate(() => window.__room.seats.filter(Boolean).length), 4);
  assert.equal(await returning.evaluate(() => window.__room.sessionId), before.session);
  console.log('PASS: authenticated Mom rejoins a full table from a fresh phone, in her existing chair and hand.');
  // An old guest key cannot override the signed-in account on this browser.
  const guestKey = await guest.evaluate(id => JSON.parse(localStorage.getItem('plunge:room:' + id)), seats[0].roomId);
  await returning.evaluate(key => localStorage.setItem('plunge:room:' + key.roomId, JSON.stringify(key)), guestKey);
  await returning.reload();
  await returning.waitForFunction(seat => window.__room?.seats.filter(Boolean).length === 4 && JSON.parse(localStorage.getItem('plunge:room:' + window.__room.roomId)).seat === seat, seats[1].seat);
  const signedOut = await phone();
  await signedOut.goto(origin); await signedOut.locator('[data-entry="family"]').click();
  await signedOut.getByRole('region', { name: 'People playing now' }).getByRole('button', { name: /View table$/ }).click();
  const signIn = signedOut.getByRole('link', { name: 'Already have an account? Sign in to find your chair →' });
  await signIn.waitFor();
  const signInPath = await signIn.getAttribute('href');
  assert.equal(signInPath, '/?account=1&roomReturn=' + seats[0].roomId);
  await signedOut.getByRole('textbox', { name: 'Your name', exact: true }).fill('Another guest');
  await signedOut.getByRole('button', { name: 'Join the table', exact: true }).click();
  await signedOut.getByText(/All four chairs are reserved/).waitFor();
  for (const width of [320, 375, 390, 428]) { await signedOut.setViewportSize({ width, height: 844 }); assert.equal(await signedOut.evaluate(() => document.documentElement.scrollWidth), width); }
  await signedOut.screenshot({ path: join(out, 'full-table-sign-in.png'), fullPage: true });
  await signedOut.getByRole('link', { name: 'Sign in to find your chair →', exact: true }).click();
  await signedOut.getByRole('link', { name: 'Continue without signing in' }).waitFor();
  // The same account destination after authentication preserves the original invite.
  await returning.goto(origin + signInPath);
  const back = returning.getByRole('link', { name: 'Continue to the table as Mom' });
  await back.waitFor();
  assert.equal(await back.getAttribute('href'), '/?rooms=1#room=' + seats[0].roomId);
  await back.click();
  await returning.waitForFunction(() => !!window.__room?.game);
  // Direct invites also use an available account without asking for a name.
  const invitee = await phone(undefined, '2');
  await invitee.goto(room);
  await invitee.getByRole('button', { name: 'Join the table as Mom', exact: true }).waitFor();
  assert.equal(await invitee.getByRole('textbox', { name: 'Your name', exact: true }).count(), 0);
  await invitee.getByRole('button', { name: 'Join the table as Mom', exact: true }).click();
  await invitee.waitForFunction(seat => !!window.__room?.game && JSON.parse(localStorage.getItem('plunge:room:' + window.__room.roomId)).seat === seat, seats[1].seat);
  await invitee.screenshot({ path: join(out, 'account-rejoined-full-table.png') });
  console.log('PASS: account wins over an old guest key; a full-table invitation offers sign-in and keeps its return destination.');
  console.log('Screenshots:', out);
} finally { clearTimeout(deadline); await browser.close(); await mf.dispose(); }
