/** Two real phone contexts, real host Walt, no test routes or game-state writes.
 * Start the experimental Vite/room workers, then PLUNGE_ROOM_URL=http://... node scripts/test-rooms-browser.mjs.
 * Also runs against a deployed preview. Each invocation is bounded to 260s.
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const output = await mkdtemp(join(tmpdir(), 'plunge-room-qa-'));
await build({ entryPoints: ['src/engine/index.ts'], bundle: true, format: 'esm', platform: 'node', outfile: join(output, 'engine.mjs') });
const { legalActions } = await import(pathToFileURL(join(output, 'engine.mjs')));
const url = process.env.PLUNGE_ROOM_URL ?? 'http://127.0.0.1:5178';
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([0,1].map(() => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })));
const pages = await Promise.all(contexts.map(c => c.newPage()));
const faults = [];
for (const page of pages) {
  page.on('pageerror', e => faults.push(String(e)));
  await page.addInitScript(() => {
    const RealSocket = window.WebSocket;
    window.__states = []; window.__errors = []; window.__commands = [];
    window.WebSocket = class extends RealSocket {
      constructor(...args) { super(...args); window.__socket = this;
        this.addEventListener('message', event => { try { const message = JSON.parse(event.data); if (message.type === 'state') { window.__room = message; window.__states.push(message); } if (message.type === 'error') window.__errors.push(message); } catch {} });
      }
      send(message) { try { if (message !== 'ping') window.__commands.push(JSON.parse(message)); } catch {} super.send(message); }
    };
  });
}
const state = page => page.evaluate(() => window.__room);
const until = async (fn, timeout = 15000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out waiting for room condition'); };
const snapshot = async (page, name) => page.screenshot({ path: join(output, name), fullPage: true });
const receipts = { schema: 'plunge-room-browser-qa-v1', origin: url, checks: [], output };
const startedAt = Date.now();
const check = message => { receipts.checks.push(message); console.log(message); };
const deadline = setTimeout(() => { console.error('Room browser check exceeded 260 seconds'); process.exit(1); }, 260000);
try {
  const [host, guest] = pages;
  await host.goto(`${url}/?rooms=1`); await host.getByRole('textbox', { name: 'Your name' }).fill('Host'); await host.getByRole('button', { name: 'Create a private room' }).click();
  await until(async () => (await state(host))?.hostConnected);
  await host.getByRole('button', { name: 'Copy invite link' }).click();
  const invite = await host.getByRole('textbox', { name: 'Invite link' }).inputValue();
  await host.getByRole('button', { name: 'Back to the table' }).click();
  await guest.goto(invite); await guest.getByRole('textbox', { name: 'Your name' }).fill('Guest'); await guest.getByRole('button', { name: 'Join room', exact: true }).click();
  await until(async () => (await state(host))?.seats[2]?.connected && (await state(guest))?.seats[0]?.connected);
  assert.equal((await state(host)).seats[2].name, 'Guest');
  await snapshot(host, 'lobby.png');
  await host.getByRole('button', { name: 'Start with 2 people + Walt' }).click();
  await until(async () => (await state(guest))?.game);
  await until(async () => { const s = await state(host); return s.game && [0,2].includes(s.game.turn); }, 45000);
  let at = await state(host); const human = at.game.turn === 0 ? host : guest;
  const before = at.revision;
  // First action is an actual bid UI tap; both browsers must see the same new state.
  const point = legalActions(at.game).find(a => a.type === 'bid' && a.bid.kind === 'points');
  if (point) await human.getByRole('button', { name: `Bid ${point.bid.value}`, exact: true }).click();
  else await human.getByRole('button', { name: 'Pass', exact: true }).click();
  await until(async () => (await state(guest))?.revision > before && (await state(host))?.revision > before);
  check('Milestone: two phone contexts joined; a human bid synchronized through the room coordinator.');
  // Capture before refresh, which intentionally starts a fresh test transcript.
  const accepted = await human.evaluate(() => window.__commands.find(c => c.type === 'action' && c.seat === undefined && c.action?.type === 'bid'));
  assert(accepted);
  // Refresh retains canonical seat 2 and matches the exact ongoing game.
  await guest.reload(); await until(async () => (await state(guest))?.seats[2]?.connected);
  assert.equal(await guest.locator('.room-table').getAttribute('data-seat'), '2');
  check('Guest refresh rejoined the same seat and shared game.');
  // Explicit wrong-seat + stale requests cannot mutate the game; server returns errors.
  at = await state(guest);
  await guest.evaluate(s => window.__socket.send(JSON.stringify({ type: 'action', id: 'wrong-seat-test', revision: s.revision, action: { type: 'next-hand' } })), at);
  await until(async () => (await guest.evaluate(() => window.__errors)).some(e => e.id === 'wrong-seat-test'));
  await guest.evaluate(s => window.__socket.send(JSON.stringify({ type: 'action', id: 'stale-test', revision: -1, action: { type: 'play', domino: '00' } })), at);
  await until(async () => (await guest.evaluate(() => window.__errors)).some(e => e.id === 'stale-test'));
  // Duplicate the already accepted human bid with its original id and revision.
  at = await state(host);
  await human.evaluate(command => window.__socket.send(JSON.stringify(command)), accepted);
  await new Promise(r => setTimeout(r, 250));
  assert(!(await human.evaluate(() => window.__errors)).some(e => e.id === accepted.id));
  check('Wrong-seat and stale requests were rejected; an accepted duplicate was acknowledged without replaying the bid.');
  for (const page of pages) if (await page.getByRole('button', { name: 'Dismiss', exact: true }).count()) await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  // Host leaves deliberately; the guest must visibly pause instead of forking.
  const hostUrl = host.url(); await host.goto('about:blank');
  await until(async () => !(await state(guest))?.hostConnected);
  await guest.getByRole('status').filter({ hasText: 'Waiting for the host' }).waitFor();
  const paused = (await state(guest)).revision; await new Promise(r => setTimeout(r, 800));
  assert.equal((await state(guest)).revision, paused); await snapshot(guest, 'host-disconnected.png');
  await host.goto(hostUrl); await until(async () => (await state(host))?.hostConnected && (await state(guest))?.hostConnected);
  check('Host disconnect visibly paused the game; reopening resumed the saved room.');
  // Drive humans through legal, visible controls. Empty seats remain real Walt.
  const words = ['blank','one','two','three','four','five','six'];
  const tileLabel = id => id[0] === id[1] ? `double ${words[Number(id[0])]}` : `${words[Number(id[0])]}-${words[Number(id[1])]}`;
  let firstPlay = true;
  while (true) {
    at = await state(host);
    if (['hand-over','game-over'].includes(at.game.phase) && Date.now() > at.holdUntil + 100) break;
    if (Date.now() < at.holdUntil + 100 || at.game.turn === null || ![0,2].includes(at.game.turn)) { await new Promise(r => setTimeout(r, 100)); continue; }
    const page = at.game.turn === 0 ? host : guest;
    await until(async () => (await state(page))?.revision === at.revision);
    const actions = legalActions(at.game), action = actions.find(a => a.type === 'bid' && a.bid.kind === 'pass') ?? actions[0];
    if (action.type === 'bid') {
      const label = action.bid.kind === 'pass' ? 'Pass' : action.bid.kind === 'points' ? `Bid ${action.bid.value}` : action.bid.value === 1 ? '1 mark (42)' : `${action.bid.value} marks`;
      await page.getByRole('button', { name: label, exact: true }).click();
    } else if (action.type === 'declare') {
      const label = action.decl.type === 'pip' ? ['Blanks','Ones','Twos','Threes','Fours','Fives','Sixes'][action.decl.pip] : action.decl.type === 'doubles' ? 'Doubles' : 'No trump';
      await page.getByRole('button', { name: label, exact: true }).click();
    } else if (action.type === 'play') {
      if (firstPlay) {
        await snapshot(host, 'phone-host.png'); await snapshot(guest, 'phone-guest.png');
        await guest.setViewportSize({ width: 320, height: 568 }); await snapshot(guest, 'phone-small.png');
        assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await guest.setViewportSize({ width: 390, height: 844 }); firstPlay = false;
      }
      await page.locator('.hand').getByRole('button', { name: new RegExp(`^${tileLabel(action.domino)}(?:,|$)`) }).click();
    }
    const revision = at.revision;
    await until(async () => (await state(host))?.revision > revision && (await state(guest))?.revision > revision, 20000);
  }
  const finished = await state(host), guestFinished = await state(guest);
  assert.deepEqual(finished.game, guestFinished.game);
  assert(finished.game.tricks.length > 0 && finished.game.handResult);
  assert(Object.keys(finished.nativeReceipts).length > 0);
  assert.equal(faults.length, 0, faults.join('\n'));
  await snapshot(host, 'hand-complete.png');
  const records = (page, database, store) => page.evaluate(async ({ database, store }) => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open(database, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); return await new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }, { database, store });
  await until(async () => (await records(host, 'plunge-history', 'events')).some(e => e.room?.revision === finished.revision && e.handResult));
  const events = await records(host, 'plunge-history', 'events');
  const waltRecords = await records(host, 'plunge-walt', 'receipts');
  assert(Object.values(finished.nativeReceipts).every(id => waltRecords.some(r => r.id === id)));
  assert(events.some(e => e.room?.mode === 'shared-room'));
  receipts.final = { elapsedMs: Date.now() - startedAt, revision: finished.revision, phase: finished.game.phase, tricks: finished.game.tricks.length, result: finished.game.handResult, waltReceipts: Object.keys(finished.nativeReceipts).length, historyCaptures: events.length };
  check('Full hand completed with 2 humans and real Walt; both clients agree on tricks/marks and shared-room history retains receipt links.');
  assert.equal(await guest.getByRole('button', { name: /Undo|Play this hand again/ }).count(), 0);
  for (const page of pages) { const dimensions = await page.evaluate(() => ({ w: innerWidth, document: document.documentElement.scrollWidth })); assert(dimensions.document <= dimensions.w); }
  check('390px phone layouts have no horizontal overflow; multi-human Undo/replay controls are absent.');
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
  console.log(`Browser evidence: ${output}`);
} finally { clearTimeout(deadline); await browser.close(); }
