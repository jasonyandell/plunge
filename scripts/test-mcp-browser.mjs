/** Phone consent smoke test with isolated D1/KV and a test account. No live requests. */
import { chromium } from 'playwright';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';

const origin = 'https://plunge.texas42.workers.dev';
// Browser redirects bypass Playwright routing; the registered callback is a real loopback listener.
const client = createServer((_request, response) => response.end('Connection approved for the test client.'));
await new Promise(resolve => client.listen(0, '127.0.0.1', resolve));
const callback = `http://127.0.0.1:${client.address().port}/callback`;
const out = await mkdtemp(join(tmpdir(), 'plunge-mcp-qa-'));
const bundled = await build({ entryPoints: ['worker/mcp-entry.ts'], bundle: true, write: false, format: 'esm',
  platform: 'browser', conditions: ['workerd'], external: ['cloudflare:workers'] });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-05-14',
  compatibilityFlags: ['global_fetch_strictly_public'], kvNamespaces: ['OAUTH_KV'], d1Databases: ['QUESTIONS'],
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    try { return new Response(await readFile(join('dist', path === '/' ? 'index.html' : path)), { headers: { 'Content-Type': mime[extname(path)] ?? 'text/html' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  } } });
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP plunge.texas42.workers.dev ~NOTFOUND'],
  ...(process.env.PLUNGE_CHROMIUM ? { executablePath: process.env.PLUNGE_CHROMIUM } : {}) });
try {
  const db = await mf.getD1Database('QUESTIONS');
  const [tables, trigger] = (await readFile('migrations/0002_family_ideas.sql', 'utf8')).split('CREATE TRIGGER');
  for (const statement of tables.split(';').filter(s => s.trim())) await db.prepare(statement).run();
  await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for (const statement of (await readFile('migrations/0003_accounts.sql', 'utf8')).split(';').filter(s => s.trim())) await db.prepare(statement).run();
  const session = 'a'.repeat(64);
  await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind('test-account', 'Jason', Date.now()).run();
  await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)')
    .bind(createHash('sha256').update(session).digest('hex'), 'test-account', Date.now() + 3600000).run();
  const registered = await mf.dispatchFetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Family chat', redirect_uris: [callback], token_endpoint_auth_method: 'none' }) });
  assert.equal(registered.status, 201);
  const { client_id } = await registered.json();
  const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: callback, scope: 'plunge:profile',
    resource: `${origin}/api/mcp`, code_challenge_method: 'S256', code_challenge: createHash('sha256').update('v'.repeat(43)).digest('base64url') });
  const authorize = `/oauth/authorize?${params}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addCookies([{ name: '__Host-plunge-session', value: session, domain: 'plunge.texas42.workers.dev', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  // All Plunge requests are intercepted; the client callback stays on loopback. Nothing reaches production.
  await ctx.route('**/*', async route => {
    const request = route.request();
    if (request.url().startsWith(callback)) return route.fulfill({ contentType: 'text/plain', body: 'Connection approved for the test client.' });
    if (new URL(request.url()).origin !== origin) return route.abort();
    let response = await mf.dispatchFetch(request.url(), { method: request.method(), redirect: 'manual',
      headers: await request.allHeaders(), ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    // Fulfilled redirects bypass Playwright routing. Follow same-origin redirects in the isolated Worker.
    if (response.status === 303 && new URL(response.headers.get('Location'), origin).origin === origin)
      response = await mf.dispatchFetch(new URL(response.headers.get('Location'), origin).href, { redirect: 'manual', headers: await request.allHeaders() });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${origin}/?account=1&returnTo=${encodeURIComponent(authorize)}`);
  await page.getByRole('link', { name: 'Continue to connection' }).click();
  await page.getByRole('heading', { name: 'Pull up a chair' }).waitFor();
  await page.getByLabel('Name at the table').fill('Jason’s Luna');
  for (const [width, height] of [[390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Consent must fit narrow phones');
    await page.screenshot({ path: join(out, `consent-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Connect companion', exact: true }).click();
  await page.waitForURL(url => url.origin === new URL(callback).origin, { timeout: 5000 });
  assert.equal(new URL(page.url()).searchParams.has('code'), true);
  await page.goto(`${origin}/oauth/connections`);
  await page.getByRole('heading', { name: 'Jason’s Luna' }).waitFor();
  await page.screenshot({ path: join(out, 'connections.png'), fullPage: true });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByText('No chat companions are connected.').waitFor();
  assert.deepEqual(errors, []);
  console.log(`Phone sign-in continuation, consent, callback and disconnect passed. Screenshots: ${out}`);
} finally { await browser.close(); await mf.dispose(); await new Promise(resolve => client.close(resolve)); }
