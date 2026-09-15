import { afterEach, describe, expect, it, vi } from 'vitest';
import { auctionPoolSize, runAuctionPool } from '../src/ai/phone/auction-pool';
import type { AuctionSurvey } from '../src/ai/auction';

const auction = { hand: [1,6,8,19,20,23,27], seat: 0, bid: 30, seed: 420914 };
const call = { auction, budget_ms: 4500 };
const fallback: AuctionSurvey = { ...auction, schema: 'walt-auction-v1', worlds: 0,
  prices: [], decl: 0, eligible: false, route: 'unpriced-pass', elapsed_us: 0 };
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn<(message: { id: number; call: Record<string, unknown> }) => void>();
  get job() { return this.postMessage.mock.calls.at(-1)![0]; }
  send(message: object, id = this.job.id) { this.onmessage?.({ data: { id, ...message } } as MessageEvent); }
  price() {
    const job = this.job.call;
    this.send({ result: { schema: 'walt-auction-price-v1', auction: job.auction_price,
      worlds: job.worlds, inner_worlds: 8, price: [job.decl, '1', '1'] } });
  }
}
function setup(worlds = 40, size = 2, controller?: AbortController) {
  const workers: FakeWorker[] = [];
  const create = () => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker; };
  const result = runAuctionPool(create, { ...call, worlds }, controller?.signal, size);
  return { workers, result };
}
function completePrices(workers: FakeWorker[], worlds: number) {
  const seen = new Set<number>();
  // Deliberately finish later declarations before earlier ones.
  for (let i = 0; i < 9; i++) {
    const worker = [...workers].reverse().find(w => !w.terminate.mock.calls.length
      && w.job.call.auction_price && w.job.call.worlds === worlds && !seen.has(w.job.id))!;
    seen.add(worker.job.id); worker.price();
  }
  return workers.find(w => w.job.call.auction_merge && w.job.call.worlds === worlds)!;
}
afterEach(() => vi.useRealTimers());
describe('declaration pool', () => {
  it('caps the phone default at four, leaving room on smaller devices', () => {
    expect([1,2,4,8,32,NaN].map(auctionPoolSize)).toEqual([1,1,3,4,4,2]);
  });
  it('queues independent jobs through 160 and waits for Rust to merge each full survey', async () => {
    const { workers, result } = setup(160);
    expect(workers).toHaveLength(2);
    workers[0]!.send({ result: fallback });
    for (const n of [4,12,40,160]) {
      const merger = completePrices(workers, n);
      const receipts = merger.job.call.receipts as { auction: unknown; worlds: number; price: number[] }[];
      expect(receipts).toHaveLength(9);
      expect(receipts.map(r => r.price[0]).sort((a,b) => a!-b!)).toEqual([0,1,2,3,4,5,6,7,9]);
      for (const r of receipts) { expect(r.auction).toEqual(auction); expect(r.worlds).toBe(n); }
      expect(workers.flatMap(w=>w.postMessage.mock.calls).some(([m])=>Number(m.call.worlds) > n)).toBe(false);
      merger.send({ result: { ...fallback, worlds: n, route: 'priced' } });
    }
    expect(await result).toMatchObject({ worlds: 160, execution: { workers: 2, completed_rounds: [4,12,40,160] } });
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('a deadline discards a partially priced round and releases the entire pool', async () => {
    vi.useFakeTimers(); const { workers, result } = setup();
    workers[0]!.send({ result: fallback });
    completePrices(workers,4).send({ result: { ...fallback, worlds: 4, route: 'priced' } });
    workers[1]!.price(); vi.advanceTimersByTime(4500);
    expect(await result).toMatchObject({ worlds: 4, interruption: expect.any(String) });
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('revalidates a prepared survey in Rust and skips already completed rounds',async()=>{
    const workers: FakeWorker[] = [], onSurvey=vi.fn();
    const initial={...fallback,worlds:40,route:'priced',prices:[0,1,2,3,4,5,6,7,9].map(d=>[d,'1','1'] as [number,string,string])};
    const result=runAuctionPool(()=>{const w=new FakeWorker();workers.push(w);return w as unknown as Worker;},
      {...call,worlds:160},undefined,2,{initial,onSurvey});
    expect(workers[0]!.job.call).toMatchObject({auction_merge:auction,worlds:40});
    expect(workers[0]!.job.call.receipts).toHaveLength(9);
    workers[0]!.send({result:initial});
    expect(workers[1]!.job.call.worlds).toBe(160);
    completePrices(workers,160).send({result:{...initial,worlds:160}});
    expect((await result).execution!.completed_rounds).toEqual([40,160]);
    expect(onSurvey.mock.calls.map(([s])=>s.worlds)).toEqual([40,160]);
  });
  it('a complete set of job receipts is still unranked until Rust merges it', async () => {
    vi.useFakeTimers(); const { workers, result } = setup(4);
    workers[0]!.send({ result: fallback }); completePrices(workers,4);
    vi.advanceTimersByTime(4500);
    expect(await result).toMatchObject({ worlds: 0, prices: [], eligible: false });
  });
  it('later jobs receive the remaining wall budget, not a new full budget', async () => {
    vi.useFakeTimers(); const { workers, result } = setup();
    workers[0]!.send({ result: fallback });
    const before = Number(workers[0]!.job.call.budget_ms);
    vi.advanceTimersByTime(1000); workers[0]!.price();
    expect(Number(workers[0]!.job.call.budget_ms)).toBeLessThanOrEqual(before - 1000);
    vi.advanceTimersByTime(3500); expect((await result).worlds).toBe(0);
  });
  it('cancels all workers and discards even a completed checkpoint', async () => {
    const controller = new AbortController(), { workers, result } = setup(40, 4, controller);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    workers[0]!.send({ result: fallback }); controller.abort(); await rejected;
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
    workers[0]!.price(); // A late message cannot revive abandoned work.
    expect(workers).toHaveLength(4);
  });
  it('retries a crashed job once and ignores old or duplicate replies', async () => {
    const { workers, result } = setup(4);
    workers[0]!.send({ result: fallback });
    const crashed = workers[0]!, oldJob = crashed.job;
    crashed.send({ error: 'worker crashed' });
    expect(workers).toHaveLength(3); expect(crashed.terminate).toHaveBeenCalledOnce();
    expect(workers[2]!.job.call.decl).toBe(oldJob.call.decl);
    crashed.send({ result: { error: 'stale failure' } });
    workers[2]!.send({ result: { error: 'wrong job' } }, oldJob.id);
    completePrices(workers,4).send({ result: { ...fallback, worlds: 4, route: 'priced' } });
    expect(await result).toMatchObject({ worlds: 4, execution: { retries: 1 } });
  });
  it('stops repeated failures and keeps the validated fallback', async () => {
    const { workers, result } = setup(); workers[0]!.send({ result: fallback });
    workers[0]!.send({ error: 'crashed' }); workers[2]!.send({ error: 'crashed again' });
    expect(await result).toMatchObject({ worlds: 0, interruption: 'crashed again' });
    expect(workers).toHaveLength(3);
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('does not retry a solver deadline or promote job checkpoints', async () => {
    const { workers, result } = setup(); workers[0]!.send({ result: fallback });
    workers[0]!.send({ checkpoint: { ...fallback, worlds: 40 } });
    workers[0]!.send({ result: { error: 'deadline' } });
    expect(await result).toMatchObject({ worlds: 0, interruption: 'deadline' }); expect(workers).toHaveLength(2);
  });
  it('cleans up partial initialization and rejects calls with no valid fallback', async () => {
    const worker = new FakeWorker(); let created = 0;
    const result = runAuctionPool(() => { if (created++) throw new Error('No workers'); return worker as unknown as Worker; }, call, undefined, 2);
    await expect(result).rejects.toThrow('No workers'); expect(worker.terminate).toHaveBeenCalledOnce();
    const next = setup(); next.workers[0]!.send({ result: { error: 'Invalid hand' } });
    await expect(next.result).rejects.toThrow('Invalid hand');
  });
});
