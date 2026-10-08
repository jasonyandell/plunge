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
const takebacks = process.env.PLUNGE_ROOM_TAKEBACKS === '1';
const nello = process.env.PLUNGE_ROOM_NELLO === '1';
const nelloBidder = process.env.PLUNGE_ROOM_NELLO_BIDDER === undefined ? undefined : Number(process.env.PLUNGE_ROOM_NELLO_BIDDER);
assert(nelloBidder === undefined || [0,2].includes(nelloBidder), 'Nel-O test bidder must be a human seat.');
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([0,1].map(() => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })));
const pages = await Promise.all(contexts.map(c => c.newPage()));
const faults = [];
for (const page of pages) {
  page.on('pageerror', e => faults.push(String(e)));
  await page.addInitScript(() => {
    const RealSocket = window.WebSocket, RealWorker = window.Worker;
    window.__workers = []; window.__delayWalt = false;
    window.Worker = class extends RealWorker {
      constructor(...args) { super(...args); this.record = { created: Date.now(), terminated: false }; window.__workers.push(this.record); }
      terminate() { this.record.terminated = true; super.terminate(); }
      set onmessage(handler) { super.onmessage = handler ? event => {
        if (window.__delayWalt) setTimeout(() => handler(event), 700); else handler(event);
      } : null; }
    };
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
  const takeBack = async (before, after, reason) => {
    await host.getByRole('button', { name: 'Undo', exact: true }).click();
    const attempt = (after.retry?.attempt ?? 0) + 1;
    await until(async () => (await state(host))?.retry?.attempt === attempt && (await state(guest))?.retry?.attempt === attempt);
    const undone = await state(host);
    assert.deepEqual(undone.game, before.game);
    assert.deepEqual(undone.game, (await state(guest)).game);
    assert.equal(undone.holdUntil, 0); assert.equal(undone.thinkingSeat, null);
    assert.deepEqual(undone.nativeReceipts, before.nativeReceipts);
    assert(undone.practiceHands.includes(undone.game.handNumber));
    await guest.locator('.room-takeback').waitFor();
    const command = await host.evaluate(() => window.__commands.findLast(c => c.type === 'undo'));
    await host.evaluate(c => { window.__socket.send(JSON.stringify(c)); window.__socket.send(JSON.stringify(c)); }, command);
    await host.evaluate(c => window.__socket.send(JSON.stringify({ ...c, id: 'delayed-undo-' + c.id })), command);
    await until(async () => (await host.evaluate(() => window.__errors)).some(e => e.id === 'delayed-undo-' + command.id));
    await new Promise(r => setTimeout(r, 100)); assert.equal((await state(host)).revision, undone.revision);
    assert(!(await host.evaluate(() => window.__errors)).some(e => e.id === command.id));
    for (const page of pages) if (await page.getByRole('button', { name: 'Dismiss', exact: true }).count()) await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await guest.reload(); await until(async () => (await state(guest))?.revision === undone.revision);
    assert.deepEqual((await state(guest)).game, undone.game); assert.deepEqual((await state(guest)).retry, undone.retry);
    check(`Shared Undo ${reason}: both clients restored the same human decision, duplicate/delayed requests stayed harmless, and reload kept the retry.`);
    return undone;
  };
  await host.goto(url);
  await host.getByRole('button', { name: 'Deal me in', exact: true }).click();
  await host.getByRole('button', { name: 'Menu', exact: true }).click();
  await host.getByRole('button', { name: 'Back to home', exact: true }).click();
  await host.getByRole('button', { name: 'Resume your game', exact: true }).waitFor();
  const soloBefore = await host.evaluate(() => localStorage.getItem('plunge:save:v1'));
  assert(soloBefore);
  await host.getByRole('button', { name: 'Play with family · Experimental', exact: true }).click();
  await host.getByRole('textbox', { name: 'Your name' }).fill('Host'); await host.getByRole('button', { name: 'Create a private room' }).click();
  await until(async () => (await state(host))?.hostConnected);
  await host.getByRole('button', { name: 'Copy invite link' }).click();
  const invite = await host.getByRole('textbox', { name: 'Invite link' }).inputValue();
  const code = await host.getByRole('textbox', { name: 'Room code', exact: true }).inputValue();
  assert.equal(new URL(invite).origin, new URL(url).origin);
  await host.getByRole('button', { name: 'Back to the table' }).click();
  await guest.goto(url); await guest.getByRole('button', { name: 'Play with family · Experimental', exact: true }).click();
  await guest.getByRole('textbox', { name: 'Your name' }).fill('Guest');
  await guest.getByRole('textbox', { name: 'Room code or invite link', exact: true }).fill(code);
  await guest.getByRole('button', { name: 'Join a family room', exact: true }).click();
  await until(async () => (await state(host))?.seats[2]?.connected && (await state(guest))?.seats[0]?.connected);
  assert.equal((await state(host)).seats[2].name, 'Guest');
  assert.equal(await host.evaluate(() => localStorage.getItem('plunge:save:v1')), soloBefore);
  check('Normal home entry and pasted room code joined on the same origin; the existing solo save stayed intact.');
  await snapshot(host, 'lobby.png');
  await host.getByRole('button', { name: 'Start with 2 people + Walt' }).click();
  await until(async () => (await state(guest))?.game);
  await until(async () => { const s = await state(host); return s.game && [0,2].includes(s.game.turn); }, 45000);
  let at = await state(host); const human = at.game.turn === 0 ? host : guest;
  const before = at.revision, beforeBid = at;
  // First action is an actual bid UI tap; both browsers must see the same new state.
  const point = nello && nelloBidder !== undefined && at.game.turn !== nelloBidder ? undefined
    : legalActions(at.game).find(a => a.type === 'bid' && (nello ? a.bid.kind === 'marks' && !a.bid.special && a.bid.value === 2 : a.bid.kind === 'points'));
  if (point) await human.getByRole('button', { name: point.bid.kind === 'marks' ? `${point.bid.value} marks` : `Bid ${point.bid.value}`, exact: true }).click();
  else await human.getByRole('button', { name: 'Pass', exact: true }).click();
  await until(async () => (await state(guest))?.revision > before && (await state(host))?.revision > before);
  check('Milestone: two phone contexts joined; a human bid synchronized through the room coordinator.');
  if (takebacks) {
    const afterBid = await state(host);
    const undoBid = await takeBack(beforeBid, afterBid, 'during the auction');
    await host.reload(); await until(async () => (await state(host))?.revision === (await state(guest))?.revision);
    assert.deepEqual((await state(host)).game, beforeBid.game);
    await human.getByRole('button', { name: point ? point.bid.kind === 'marks' ? `${point.bid.value} marks` : `Bid ${point.bid.value}` : 'Pass', exact: true }).click();
    await until(async () => (await state(host))?.revision > undoBid.revision && (await state(guest))?.revision > undoBid.revision);
  }
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
  let firstPlay = true, aiUndo = false, endUndo = false, sawNello = false;
  let beforeLastHuman = null;
  while (true) {
    at = await state(host);
    if (['hand-over','game-over'].includes(at.game.phase) && Date.now() > at.holdUntil + 100) {
      if (takebacks && !endUndo) {
        assert(beforeLastHuman);
        const originalEnd = at;
        await until(async () => (await host.evaluate(async () => { const r = indexedDB.open('plunge-history', 1); const db = await new Promise(resolve => { r.onsuccess = () => resolve(r.result); }); return await new Promise(resolve => { const get = db.transaction('events').objectStore('events').getAll(); get.onsuccess = () => resolve(get.result); }); })).some(e => e.room?.revision === originalEnd.revision && e.handResult));
        await takeBack(beforeLastHuman, at, 'after the hand result');
        assert(!(await state(host)).game.handResult); endUndo = true;
        continue;
      }
      break;
    }
    if (nello && at.game.phase === 'playing' && !sawNello) {
      assert.equal(at.game.contract.kind, 'nello', 'The human marks bidder must have won to test Nel-O.');
      assert([0,2].includes(at.game.sittingOut));
      const sitter = at.game.sittingOut === 0 ? host : guest;
      await sitter.locator('.room-table[data-sitting-out="true"]').waitFor();
      assert.match(await sitter.locator('.hand-caption').innerText(), /Sitting out/);
      assert.equal(await sitter.locator('.hand').getByRole('button').count(), 0);
      await snapshot(sitter, 'nello-sitting-out.png'); sawNello = true;
      check('Nel-O shows the sitting-out partner, retains seven inactive tiles, and offers no play controls to that person.');
    }
    if (Date.now() < at.holdUntil + 100 || at.game.turn === null || ![0,2].includes(at.game.turn)) { await new Promise(r => setTimeout(r, 100)); continue; }
    const page = at.game.turn === 0 ? host : guest;
    await until(async () => (await state(page))?.revision === at.revision);
    const actions = legalActions(at.game), pass = actions.find(a => a.type === 'bid' && a.bid.kind === 'pass');
    const action = nello && at.game.phase === 'bidding' && (nelloBidder === undefined || at.game.turn === nelloBidder)
      ? actions.find(a => a.type === 'bid' && a.bid.kind === 'marks' && !a.bid.special && a.bid.value === 2) ?? pass ?? actions[0]
      : pass ?? actions[0];
    if (action.type === 'bid') {
      const label = action.bid.kind === 'pass' ? 'Pass' : action.bid.kind === 'points' ? `Bid ${action.bid.value}` : action.bid.value === 1 ? '1 mark (42)' : `${action.bid.value} marks`;
      await page.getByRole('button', { name: label, exact: true }).click();
    } else if (action.type === 'declare') {
      const label = nello && legalActions(at.game).some(a => a.type === 'declare' && a.decl.type === 'nello') ? 'Nel-O · Preview' : action.decl.type === 'pip' ? ['Blanks','Ones','Twos','Threes','Fours','Fives','Sixes'][action.decl.pip] : action.decl.type === 'doubles' ? 'Doubles' : 'No trump';
      await page.getByRole('button', { name: label, exact: true }).click();
    } else if (action.type === 'play') {
      if (firstPlay) {
        await snapshot(host, 'phone-host.png'); await snapshot(guest, 'phone-guest.png');
        await guest.setViewportSize({ width: 320, height: 568 }); await snapshot(guest, 'phone-small.png');
        assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(await guest.evaluate(() => document.querySelector('.hand-area').getBoundingClientRect().top >= document.querySelector('.middle').getBoundingClientRect().bottom));
        await guest.locator('.hand-area').scrollIntoViewIfNeeded(); await snapshot(guest, 'phone-small-scrolled.png');
        assert(await guest.evaluate(() => { const tile = document.querySelector('.hand .dom').getBoundingClientRect(); return tile.top >= 0 && tile.bottom <= innerHeight; }), 'The whole domino must remain reachable after scrolling its hand area.');
        await guest.setViewportSize({ width: 390, height: 844 }); firstPlay = false;
      }
      if (takebacks && !aiUndo) await host.evaluate(() => { window.__delayWalt = true; });
      const workersBefore = await host.evaluate(() => window.__workers.length);
      await page.locator('.hand').getByRole('button', { name: new RegExp(`^${tileLabel(action.domino)}(?:,|$)`) }).click();
      if (takebacks && !aiUndo) {
        await until(async () => (await state(host))?.revision > at.revision);
        const afterPlay = await state(host);
        // A real worker still calculates; only message delivery is delayed to model a slower phone.
        if (!afterPlay.seats[afterPlay.game.turn] && afterPlay.game.phase === 'playing') {
          await until(async () => (await host.evaluate(n => window.__workers.slice(n).some(w => !w.terminated), workersBefore)), 20000);
          await takeBack(at, afterPlay, 'while real Walt work was in flight');
          await host.evaluate(() => { window.__delayWalt = false; });
          const undone = await state(host);
          await host.evaluate(old => window.__socket.send(JSON.stringify({ type: 'action', id: 'late-walt-after-undo', revision: old.revision, seat: old.game.turn, action: old.action })), { ...afterPlay, action: legalActions(afterPlay.game)[0] });
          await until(async () => (await host.evaluate(() => window.__errors)).some(e => e.id === 'late-walt-after-undo'));
          await new Promise(r => setTimeout(r, 900));
          assert.equal((await state(host)).revision, undone.revision);
          for (const p of pages) if (await p.getByRole('button', { name: 'Dismiss', exact: true }).count()) await p.getByRole('button', { name: 'Dismiss', exact: true }).click();
          aiUndo = true; continue;
        }
        await host.evaluate(() => { window.__delayWalt = false; });
      }
    }
    beforeLastHuman = at;
    const revision = at.revision;
    await until(async () => (await state(host))?.revision > revision && (await state(guest))?.revision > revision, 20000);
  }
  const finished = await state(host), guestFinished = await state(guest);
  assert.deepEqual(finished.game, guestFinished.game);
  assert(finished.game.tricks.length > 0 && finished.game.handResult);
  if (takebacks) { assert(aiUndo && endUndo); assert(finished.retry?.sawResult); }
  if (nello) { assert(sawNello); assert(finished.game.tricks.every(t => t.plays.length === 3)); assert.equal(finished.game.hands[finished.game.sittingOut].length, 7); assert.match(await host.locator('.card-title').innerText(), /2 marks/); }
  assert(Object.keys(finished.nativeReceipts).length > 0);
  assert.equal(faults.length, 0, faults.join('\n'));
  await snapshot(host, 'hand-complete.png');
  const records = (page, database, store) => page.evaluate(async ({ database, store }) => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open(database, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); return await new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }, { database, store });
  await until(async () => (await records(host, 'plunge-history', 'events')).some(e => e.room?.revision === finished.revision && e.handResult));
  const events = await records(host, 'plunge-history', 'events');
  const waltRecords = await records(host, 'plunge-walt', 'receipts');
  assert(Object.values(finished.nativeReceipts).every(id => waltRecords.some(r => r.id === id)));
  assert(events.some(e => e.room?.mode === 'shared-room'));
  if (takebacks) {
    assert(events.some(e => e.retry?.practice && e.retry.root.gameId === finished.sessionId && e.retry.from.code));
    assert(events.filter(e => e.gameId === finished.sessionId && e.handResult).length >= 2);
    assert(events.some(e => e.room?.revision === finished.revision && e.retry?.sawResult));
    check('History preserves prior results and takeback branches; retry snapshots retain root identity and Walt evidence.');
  }
  receipts.final = { takebacks, nello, bidder: finished.game.declarer, sittingOut: finished.game.sittingOut, elapsedMs: Date.now() - startedAt, revision: finished.revision, phase: finished.game.phase, tricks: finished.game.tricks.length, result: finished.game.handResult, waltReceipts: Object.keys(finished.nativeReceipts).length, historyCaptures: events.length };
  check('Full hand completed with 2 humans and real Walt; both clients agree on tricks/marks and shared-room history retains receipt links.');
  assert.equal(await guest.getByRole('button', { name: /Undo|Play this hand again/ }).count(), 0);
  await host.getByRole('button', { name: 'Undo', exact: true }).waitFor();
  for (const page of pages) { const dimensions = await page.evaluate(() => ({ w: innerWidth, document: document.documentElement.scrollWidth })); assert(dimensions.document <= dimensions.w); }
  check('390px phone layouts have no horizontal overflow; only the host has Undo and whole-hand replay is absent.');
  await host.goto(url); await host.getByRole('button', { name: 'Resume your game', exact: true }).waitFor();
  assert.equal(await host.evaluate(() => localStorage.getItem('plunge:save:v1')), soloBefore);
  await host.getByRole('button', { name: 'Resume your game', exact: true }).click();
  await host.getByRole('button', { name: 'Menu', exact: true }).waitFor();
  check('Leaving the family room restored the original resumable solo game.');
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
  console.log(`Browser evidence: ${output}`);
} finally { clearTimeout(deadline); await browser.close(); }
