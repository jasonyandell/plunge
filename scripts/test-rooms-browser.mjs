/** Three real phone contexts at a family table, real computer players, no test routes or game-state writes.
 * Serve a build with rooms on (PLUNGE_ROOMS=experimental npm run build; npx wrangler dev --port 8788),
 * then PLUNGE_ROOM_URL=http://127.0.0.1:8788/ node scripts/test-rooms-browser.mjs.
 * Also runs against a deployed preview. Each invocation is bounded to 260s.
 */
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const model = process.env.PLUNGE_ROOM_PLAYER === 'Zeb' ? 'Zeb' : 'Walt';
const base = process.env.PLUNGE_ROOM_URL ?? 'http://127.0.0.1:8788/', url = base + '?rooms=1';
const out = await mkdtemp(join(tmpdir(), 'plunge-room-qa-'));
const browser = await chromium.launch({ headless: true, ...(process.env.PLUNGE_CHROMIUM ? { executablePath: process.env.PLUNGE_CHROMIUM } : {}) });
const faults = [];
const phone = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  page.on('pageerror', e => faults.push(String(e))); page.on('console', m => { if (m.type() === 'error') faults.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    window.WebSocket = class extends Real {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', e => {
          try {
            const m = JSON.parse(e.data);
            if (m.type === 'state') window.__room = m;
            if (m.type === 'error') (window.__errors ??= []).push({ ...m, command: window.__commands?.[m.id],
              receivedRevision: window.__room?.revision });
          } catch {}
        });
      }
      send(data) {
        try {
          const c = JSON.parse(data);
          if (c.id) (window.__commands ??= {})[c.id] = { type: c.type, revision: c.revision, seat: c.seat,
            modelKey: c.modelKey, action: c.action?.type, kind: c.kind, vote: c.vote };
        } catch {}
        return super.send(data);
      }
    };
  });
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
  if (s.game.phase === 'declaring') { const decl = page.getByRole('dialog', { name: 'Declare trump' }).getByRole('button', { name: 'Blanks', exact: true }); if (await decl.count()) { await decl.first().click().catch(() => {}); return true; } } }
  return false; };
const deadline = setTimeout(() => { console.error('Room browser check exceeded 260 seconds'); process.exit(1); }, 260000);
try {
  const a = await phone(), b = await phone(), c = await phone();
  await a.goto(base); await a.getByRole('button', { name: 'Deal me in', exact: true }).click();
  await a.getByRole('button', { name: 'Menu', exact: true }).click(); await a.getByRole('button', { name: 'Back to home', exact: true }).click();
  await a.getByRole('button', { name: 'Resume your game', exact: true }).waitFor();
  const soloBefore = await a.evaluate(() => localStorage.getItem('plunge:save:v1'));
  await a.locator('button.home-family').click();
  await a.getByRole('textbox', { name: 'Your name' }).fill('Host'); await a.getByRole('button', { name: 'Open a family table' }).click();
  await a.getByText('Pull up a chair').waitFor(); const invite = a.url(); check('Host opened a table from the home screen.');
  await b.goto(invite); await b.getByRole('textbox', { name: 'Your name' }).fill('Guest'); await b.getByRole('button', { name: 'Join the table' }).click();
  await until(async () => (await state(a))?.seats[2]?.connected && (await state(b))?.seats[0]?.connected, 15000, 'both seated', a);
  await a.screenshot({ path: join(out, 'lobby.png') }); check('Guest joined the lobby; the host runs Walt.');
  if (model === 'Zeb') {
    await a.getByRole('radio', { name: 'Zeb', exact: true }).click();
    await b.getByText('Host wants Zeb to play the computer seats').waitFor();
    await b.getByRole('button', { name: 'Yes', exact: true }).click();
    await until(async () => (await state(a)).player === 'zeb' && (await state(b)).player === 'zeb', 10000, 'Zeb agreed', a);
    check('Both people agreed to Zeb; all phones share its versioned selection.');
  }
  await a.getByRole('button', { name: `Start with 2 people + ${model}` }).click();
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
  if (bidder) {
    await bidder.getByRole('dialog', { name: 'Your bid' }).waitFor({ timeout: 10000 });
    await bidder.getByRole('button', { name: 'Help me bid', exact: true }).click();
    await bidder.getByRole('heading', { name: new RegExp(model + ' (suggests|would)') }).waitFor({ timeout: 30000 });
    if (model === 'Zeb') {
      await bidder.getByText('Compare trumps', { exact: true }).click();
      await bidder.getByLabel('Explore a target', { exact: true }).selectOption('36');
      await bidder.getByText('Estimated chance of making 36', { exact: true }).waitFor();
      if (await bidder.getByRole('table').getByRole('row').count() !== 10) throw new Error('Missing family forecast declarations.');
    }
    await bidder.screenshot({ path: join(out, 'bid-hint.png') });
    await bidder.getByRole('button', { name: 'Close hint', exact: true }).click(); check(`The family bidding hint comes from ${model}.`);
  }
  await until(async () => { await humansPass(); return (await state(a)).game.phase !== 'bidding'; }, 90000, 'auction done', a);
  check(`The auction finished (${(await state(a)).game.phase}); ${model} bid for the empty chairs.`);
  await until(async () => {
    if (await humansPass()) return false;
    const current = await state(a);
    if (Object.keys(current.decisionReceipts ?? {}).length) return true;
    for (const [seat, page] of Object.entries(pages)) {
      if (current.game.phase === 'playing' && current.game.turn === Number(seat)) {
        const legal = page.getByLabel('Your hand', { exact: true }).getByRole('button');
        if (await legal.count()) await legal.first().click().catch(() => {});
      }
    }
    return false;
  }, 60000, 'first computer receipt', a);
  await until(async () => b.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('plunge-walt', 1);
    open.onerror = () => resolve(false);
    open.onsuccess = () => { const db = open.result, read = db.transaction('receipts').objectStore('receipts').getAll();
      read.onsuccess = () => { resolve(read.result.some(r => r.perspective?.viewer === 2)); db.close(); }; };
  })), 10000, 'partner receives projected scores', b);
  const modelEvents = (await state(a)).playerEvents ?? [];
  if (!modelEvents.length || modelEvents.some(e => e.model.name !== model)) throw new Error('Wrong model in room action log.');
  check(`${model} played a real move; both phones retain the original scores and the partner has a projected receipt.`);
  const other = model === 'Zeb' ? 'Walt' : 'Zeb', oldSession = (await state(a)).sessionId;
  await a.getByRole('button', { name: 'Table', exact: true }).click();
  await a.getByRole('radio', { name: other, exact: true }).click();
  await a.getByRole('dialog', { name: `Switch to ${other}?`, exact: true }).waitFor();
  await a.screenshot({ path: join(out, 'switch-warning.png') });
  await a.getByRole('button', { name: `Keep ${model}`, exact: true }).click();
  if ((await state(a)).sessionId !== oldSession || (await state(a)).proposal) throw new Error('Cancelled model switch changed the family game.');
  await a.getByRole('radio', { name: other, exact: true }).click();
  await a.getByRole('button', { name: 'Ask to end game and switch', exact: true }).click();
  await b.getByText(`Host wants to end this game and switch to ${other}`, { exact: true }).waitFor();
  await b.getByRole('button', { name: 'No', exact: true }).click();
  await until(async () => !(await state(a)).proposal, 10000, 'model change declined', a);
  if ((await state(a)).sessionId !== oldSession || !(await state(a)).game) throw new Error('Declined model switch ended the family game.');
  check('Cancelling the warning or declining the vote keeps the existing family game.');
  await a.getByRole('button', { name: 'Table', exact: true }).click();
  await a.getByRole('radio', { name: other, exact: true }).click();
  await a.getByRole('button', { name: 'Ask to end game and switch', exact: true }).click();
  await b.getByRole('button', { name: 'End game & switch', exact: true }).click();
  await a.getByRole('heading', { name: 'Pull up a chair', exact: true }).waitFor();
  await b.getByRole('heading', { name: 'Pull up a chair', exact: true }).waitFor();
  const lobby = await state(a);
  if (lobby.game || lobby.started || lobby.sessionId || lobby.playerEvents.length || Object.keys(lobby.nativeReceipts).length || lobby.seats[2]?.name !== 'Guest') throw new Error('Model switch did not reset the family game while keeping its seats.');
  check('Explicit agreement ends the game for both phones and returns the same people to a clean lobby.');
  // Return to the original model before the remaining room lifecycle checks.
  await a.getByRole('radio', { name: model, exact: true }).click();
  await b.getByRole('button', { name: 'Yes', exact: true }).click();
  await a.getByRole('button', { name: `Start with 2 people + ${model}`, exact: true }).click();
  await b.getByRole('button', { name: 'Fine', exact: true }).click();
  await until(async () => !!(await state(a)).game && (await state(a)).sessionId !== oldSession, 10000, 'fresh game after model switch', a);
  if ((await state(a)).game.marks.some(n => n !== 0)) throw new Error('The new game kept old marks.');
  await b.getByRole('button', { name: 'Table', exact: true }).click(); await b.getByRole('button', { name: 'Close the table' }).click();
  await a.getByText('Guest wants to close the table').waitFor({ timeout: 10000 }); await a.getByRole('button', { name: 'Fine' }).click();
  await until(async () => (await state(a))?.open === false, 10000, 'closed', a); check('The table closed by vote.');
  await c.goto(invite); await c.getByRole('textbox', { name: 'Your name' }).fill('Cousin'); await c.getByRole('button', { name: 'Join the table' }).click();
  await c.getByText('Knocking…').waitFor({ timeout: 10000 }); await a.getByText('Cousin is at the door').waitFor({ timeout: 10000 });
  await a.screenshot({ path: join(out, 'knock.png') }); await a.getByRole('button', { name: 'Let them in' }).click();
  await until(async () => (await state(c))?.seats?.[1]?.name === 'Cousin' && (await state(c)).seats[1].connected, 15000, 'cousin seated', c);
  await c.getByRole('button', { name: 'Menu', exact: true }).waitFor({ timeout: 10000 }); check('Cousin knocked, the first answer let them in, and they sit at the ordinary table.');
  c.once('dialog', d => d.accept()); await c.getByRole('button', { name: 'Leave' }).click();
  await until(async () => (await state(a))?.seats[1] === null, 10000, 'cousin left', a); await until(async () => !c.url().includes('rooms=1'), 10000, 'cousin home'); check(`Cousin left; the chair is ${model}’s again.`);
  const rev = (await state(a)).revision; await b.close();
  await until(async () => (await state(a))?.seats[2]?.away === true, 30000, 'guest away', a);
  await a.getByText(`${model} is playing`, { exact: true }).waitFor({ timeout: 5000 });
  await until(async () => { await humansPass(); const s = await state(a); return s.revision > rev + 1 || (s.game.turn === 0 && s.game.phase === 'playing'); }, 60000, 'play continued', a);
  await a.screenshot({ path: join(out, 'away.png') }); check(`Guest dropped: after the grace ${model} plays their chair and the game keeps moving.`);
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
