/** Three real phone contexts at a family table, real Walt, no test routes or game-state writes.
 * Serve a build with rooms on (PLUNGE_ROOMS=experimental npm run build; npx wrangler dev --port 8788),
 * then PLUNGE_ROOM_URL=http://127.0.0.1:8788/ node scripts/test-rooms-browser.mjs.
 * Also runs against a deployed preview. Each invocation is bounded to 260s.
 */
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.PLUNGE_ROOM_URL ?? 'http://127.0.0.1:8788/', url = base + '?rooms=1';
const out = await mkdtemp(join(tmpdir(), 'plunge-room-qa-'));
const browser = await chromium.launch({ headless: true, ...(process.env.PLUNGE_CHROMIUM ? { executablePath: process.env.PLUNGE_CHROMIUM } : {}) });
const faults = [];
const phone = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  page.on('pageerror', e => faults.push(String(e))); page.on('console', m => { if (m.type() === 'error') faults.push('console: ' + m.text()); });
  await page.addInitScript(() => { const Real = window.WebSocket; window.WebSocket = class extends Real { constructor(...a) { super(...a); this.addEventListener('message', e => { try { const m = JSON.parse(e.data); if (m.type === 'state') window.__room = m; if (m.type === 'error') (window.__errors ??= []).push(m); } catch {} }); } }; });
  return page; };
const state = page => page.evaluate(() => window.__room);
const summary = async page => { const s = await state(page); return s ? JSON.stringify({ rev: s.revision, runner: s.runner, thinking: s.thinkingSeat, turn: s.game?.turn, phase: s.game?.phase, seats: s.seats, proposal: s.proposal?.kind, lastVote: s.lastVote, errors: await page.evaluate(() => window.__errors) }) : 'no state'; };
const until = async (fn, timeout = 20000, label = '', page) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await fn()) return; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error('Timed out: ' + label + (page ? ' ' + await summary(page) : '')); };
const checks = [];
const check = m => { checks.push(m); console.log('OK', m); };
const pages = {};
/** People pass when they can, bid when forced, and call the first trump offered. */
const humansPass = async () => { for (const [seat, page] of Object.entries(pages)) { if (page.isClosed()) continue; const s = await state(page); if (s?.game?.turn !== Number(seat)) continue;
  if (s.game.phase === 'bidding') { const pass = page.getByRole('button', { name: 'Pass', exact: true }); if (await pass.count()) { await pass.first().click().catch(() => {}); return true; }
    const bid = page.getByRole('dialog', { name: 'Your bid' }).getByRole('button', { name: /^Bid \d+$/ }); if (await bid.count()) { await bid.first().click().catch(() => {}); return true; } }
  if (s.game.phase === 'declaring') { const decl = page.getByRole('dialog', { name: 'Declare trump' }).getByRole('button'); if (await decl.count()) { await decl.first().click().catch(() => {}); return true; } } }
  return false; };
const deadline = setTimeout(() => { console.error('Room browser check exceeded 260 seconds'); process.exit(1); }, 260000);
try {
  const a = await phone(), b = await phone(), c = await phone();
  await a.goto(base); await a.getByRole('button', { name: 'Deal me in', exact: true }).click();
  await a.getByRole('button', { name: 'Menu', exact: true }).click(); await a.getByRole('button', { name: 'Back to home', exact: true }).click();
  await a.getByRole('button', { name: 'Resume your game', exact: true }).waitFor();
  const soloBefore = await a.evaluate(() => localStorage.getItem('plunge:save:v1'));
  await a.getByRole('button', { name: 'Play with family · Experimental', exact: true }).click();
  await a.getByRole('textbox', { name: 'Your name' }).fill('Host'); await a.getByRole('button', { name: 'Open a family table' }).click();
  await a.getByText('Pull up a chair').waitFor(); const invite = a.url(); check('Host opened a table from the home screen.');
  await b.goto(invite); await b.getByRole('textbox', { name: 'Your name' }).fill('Guest'); await b.getByRole('button', { name: 'Join the table' }).click();
  await until(async () => (await state(a))?.seats[2]?.connected && (await state(b))?.seats[0]?.connected, 15000, 'both seated', a);
  await a.screenshot({ path: join(out, 'lobby.png') }); check('Guest joined the lobby; the host runs Walt.');
  await a.getByRole('button', { name: 'Start with 2 people + Walt' }).click();
  await b.getByText('Host wants to start the game').waitFor({ timeout: 10000 }); await b.screenshot({ path: join(out, 'vote.png') }); await b.getByRole('button', { name: 'Fine' }).click();
  await until(async () => (await state(a))?.game && (await state(b))?.game, 10000, 'game started', a); check('The game started early on a unanimous yes.');
  pages[0] = a; pages[2] = b;
  await a.getByRole('button', { name: 'Menu', exact: true }).click();
  await a.getByRole('switch', { name: 'Show hints' }).waitFor(); await a.getByRole('button', { name: 'The table · votes and chairs' }).waitFor();
  await a.getByRole('button', { name: 'Keep playing', exact: true }).click();
  if (await a.getByRole('button', { name: 'Play this hand again' }).count()) throw new Error('Replay offered at a shared table.');
  check('The ordinary Menu is there, with the hints switch and the table entry; no solo-only replay.');
  const humanTurn = async () => { for (const [seat, page] of Object.entries(pages)) { const s = await state(page); if (s?.game?.phase === 'bidding' && s.game.turn === Number(seat)) return page; } return null; };
  let bidder = null;
  await until(async () => { bidder = await humanTurn(); if (bidder) return true; return (await state(a)).game.phase !== 'bidding'; }, 60000, 'human bid turn', a);
  if (bidder) { await bidder.getByRole('dialog', { name: 'Your bid' }).waitFor({ timeout: 10000 }); await bidder.getByText('Help me bid').waitFor({ timeout: 15000 }); await bidder.screenshot({ path: join(out, 'bid-hint.png') }); check('The bid sheet offers Help me bid at the family table.'); }
  await until(async () => { await humansPass(); return (await state(a)).game.phase !== 'bidding'; }, 90000, 'auction done', a);
  check(`The auction finished (${(await state(a)).game.phase}); Walt bid for the empty chairs.`);
  await b.getByRole('button', { name: 'Table', exact: true }).click(); await b.getByRole('button', { name: 'Close the table' }).click();
  await a.getByText('Guest wants to close the table').waitFor({ timeout: 10000 }); await a.getByRole('button', { name: 'Fine' }).click();
  await until(async () => (await state(a))?.open === false, 10000, 'closed', a); check('The table closed by vote.');
  await c.goto(invite); await c.getByRole('textbox', { name: 'Your name' }).fill('Cousin'); await c.getByRole('button', { name: 'Join the table' }).click();
  await c.getByText('Knocking…').waitFor({ timeout: 10000 }); await a.getByText('Cousin is at the door').waitFor({ timeout: 10000 });
  await a.screenshot({ path: join(out, 'knock.png') }); await a.getByRole('button', { name: 'Let them in' }).click();
  await until(async () => (await state(c))?.seats?.[1]?.name === 'Cousin' && (await state(c)).seats[1].connected, 15000, 'cousin seated', c);
  await c.getByRole('button', { name: 'Menu', exact: true }).waitFor({ timeout: 10000 }); check('Cousin knocked, the first answer let them in, and they sit at the ordinary table.');
  c.once('dialog', d => d.accept()); await c.getByRole('button', { name: 'Leave' }).click();
  await until(async () => (await state(a))?.seats[1] === null, 10000, 'cousin left', a); await until(async () => !c.url().includes('rooms=1'), 10000, 'cousin home'); check('Cousin left; the chair is Walt’s again.');
  const rev = (await state(a)).revision; await b.close();
  await until(async () => (await state(a))?.seats[2]?.away === true, 30000, 'guest away', a);
  await a.getByText('Walt is playing').waitFor({ timeout: 5000 });
  await until(async () => { await humansPass(); const s = await state(a); return s.revision > rev + 1 || (s.game.turn === 0 && s.game.phase === 'playing'); }, 60000, 'play continued', a);
  await a.screenshot({ path: join(out, 'away.png') }); check('Guest dropped: after the grace Walt plays their chair and the game keeps moving.');
  const errors = await a.evaluate(() => window.__errors ?? []);
  if (errors.length) throw new Error('The host saw room errors: ' + JSON.stringify(errors));
  await a.getByRole('button', { name: 'Menu', exact: true }).click(); await a.getByRole('button', { name: 'Back to home', exact: true }).click();
  await a.getByRole('button', { name: 'Resume your game', exact: true }).waitFor({ timeout: 10000 });
  if (await a.evaluate(() => localStorage.getItem('plunge:save:v1')) !== soloBefore) throw new Error('The solo save changed.');
  check('Back home: the solo game is untouched and resumable.');
  const real = faults.filter(f => !f.includes('favicon') && !f.includes('403'));
  if (real.length) throw new Error('Browser faults: ' + JSON.stringify(real));
  console.log(JSON.stringify({ schema: 'plunge-room-browser-qa-v2', origin: base, checks, output: out }, null, 1));
} finally { clearTimeout(deadline); await browser.close(); }
