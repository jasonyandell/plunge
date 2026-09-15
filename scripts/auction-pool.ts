import { runAuctionPool } from '../src/ai/phone/auction-pool';
import { checkedSurvey, type AuctionSurvey } from '../src/ai/auction';
import { runPlayer } from '../src/ai/phone/client';

const status = document.querySelector<HTMLPreElement>('#status')!;
const output = document.querySelector<HTMLTextAreaElement>('#results')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const fixtures = [
  [1,6,8,19,20,23,27], [6,8,15,19,20,21,26], [0,2,7,13,18,22,25],
];
const create = () => new Worker(new URL('../src/ai/phone/worker.ts', import.meta.url), { type: 'module' });
const comparison = (s: AuctionSurvey) => JSON.stringify([s.worlds,s.prices,s.decl,s.eligible]);
button.onclick = async () => {
  button.disabled = true;
  const rows: unknown[] = [];
  const record = (row: unknown) => { rows.push(row); output.value = JSON.stringify({ userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency, rows }, null, 2); };
  try {
    for (const [index, hand] of fixtures.entries()) {
      const auction = { hand, seat: index, bid: 30, seed: 420914 + index };
      let reference = '';
      for (const workers of [1,2,3,4]) {
        status.textContent = `Hand ${index+1}/3, ${workers} workers…`;
        const call = { auction, worlds: 12, budget_ms: 14000 };
        const result = checkedSurvey(auction, await runAuctionPool(create, call, undefined, workers));
        if (result.worlds !== 12) throw new Error('Fixture did not finish all 12 worlds: '+JSON.stringify(result));
        if (workers === 1) reference = comparison(result);
        else if (reference !== comparison(result)) throw new Error('Pool result differs from single worker');
        record({ fixture: index, workers, ...result });
      }
    }
    const auction = { hand: fixtures[0]!, seat: 0, bid: 30, seed: 420914 };
    // Production wall budget and a deadline which cannot fit a complete round.
    for (const budget_ms of [20000,500]) {
      const result = checkedSurvey(auction, await runAuctionPool(create, { auction, worlds: 160, budget_ms }, undefined, 2));
      record({ check: 'wall-budget', budget_ms, ...result });
    }
    const controller = new AbortController();
    const pending = runAuctionPool(create, { auction, worlds: 160, budget_ms: 20000 }, controller.signal, 4);
    const timer = setTimeout(() => controller.abort(), 150);
    try { await pending; throw new Error('Cancellation returned a move'); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) throw e; }
    finally { clearTimeout(timer); }
    // A new request must work after cancellation; ordinary play uses this same
    // reusable worker implementation, but still owns only one worker.
    const play = await runPlayer({ request: { ...auction, decl: 5, bidder: 0, plays: [] }, worlds: 160, partner: false, budget_ms: 20000 });
    if (!play.legal.includes(play.choice)) throw new Error('Invalid post-cancellation move');
    record({ check: 'post-cancellation-play', result: play });
    status.textContent = 'Passed: exact prices/ties across all pool sizes; bounded surveys; cancellation and subsequent play.';
  } catch (e) { record({ error: String(e) }); status.textContent = 'FAILED: '+String(e); }
  finally { button.disabled = false; }
};
