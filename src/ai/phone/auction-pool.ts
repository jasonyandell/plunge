/** Scheduling only. Rust prices each declaration and ranks complete surveys.
 * Each request owns its workers; cancellation releases every WASM heap. */
import type { AuctionCall, AuctionSurvey } from '../auction';
import type { AuctionPrice, MergeCall, PriceCall, WorkerMessage } from './protocol';

const DECLS = [0, 1, 2, 3, 4, 5, 6, 7, 9];
type Work = { kind: 'merge'; call: MergeCall; attempt: number }
  | { kind: 'price'; call: PriceCall; attempt: number };
interface Slot { worker: Worker; current?: { id: number; work: Work } }

// A phone's reported core count is a ceiling, not a useful concurrency target.
export function auctionPoolSize(cores = navigator.hardwareConcurrency): number {
  return cores === 1 ? 1 : 2;
}

export function runAuctionPool(create: () => Worker, call: AuctionCall, signal?: AbortSignal,
  size = auctionPoolSize()): Promise<AuctionSurvey> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
    if (!Number.isInteger(size) || size < 1 || size > 4 || ![4, 12, 40].includes(call.worlds ?? 40)
      || !Number.isInteger(call.budget_ms) || call.budget_ms < 100 || call.budget_ms > 14000) {
      reject(new Error('Invalid auction pool budget.')); return;
    }
    const start = performance.now(), end = start + call.budget_ms;
    const slots: Slot[] = [], rounds = [4, 12, 40].filter(n => n <= (call.worlds ?? 40));
    let settled = false, sequence = 0, round = -1, retries = 0;
    let queue: number[] = [], receipts: AuctionPrice[] = [], saved: AuctionSurvey | undefined;
    const completed: number[] = [];
    const finish = (reason?: string, error?: unknown): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      for (const slot of slots) slot.worker.terminate();
      if (error || !saved) reject(error ?? new Error(reason ?? 'Walt did not finish. Please retry.'));
      else resolve({ ...saved, elapsed_us: Math.round((performance.now() - start) * 1000),
        ...(reason ? { interruption: reason } : {}),
        execution: { kind: 'worker-pool', workers: size, retries, completed_rounds: completed } });
    };
    const abort = (): void => finish(undefined, new DOMException('Stopped', 'AbortError'));
    const timedOut = (): void => finish('Time budget reached; the last complete declaration survey was retained.');
    const timer = setTimeout(timedOut, call.budget_ms);
    signal?.addEventListener('abort', abort, { once: true });

    const send = (slot: Slot, work: Work): void => {
      if (settled) return;
      if (performance.now() >= end) { timedOut(); return; }
      if (work.kind === 'price') {
        // Reserve a little time for the complete-survey merge. Jobs share one
        // wall deadline, rather than each getting a fresh 4.5 seconds.
        work.call.budget_ms = Math.floor(end - performance.now() - 80);
        if (work.call.budget_ms < 5) { timedOut(); return; }
      }
      slot.current = { id: ++sequence, work };
      try { slot.worker.postMessage({ id: sequence, call: work.call }); }
      catch (error) { failed(slot, String(error)); }
    };
    const failed = (slot: Slot, reason: string): void => {
      if (settled) return;
      const work = slot.current?.work;
      // Retry infrastructure failures once per job, within the original budget.
      // A solver deadline or a rejected receipt is handled separately below.
      if (!work || work.attempt >= 1) { finish(reason); return; }
      slot.worker.terminate();
      try {
        slot.worker = create(); attach(slot);
        retries++; send(slot, { ...work, attempt: work.attempt + 1 });
      } catch (error) { finish(String(error)); }
    };
    const pump = (): void => {
      for (const slot of slots) {
        if (settled || !queue.length) break;
        if (!slot.current) send(slot, { kind: 'price', attempt: 0, call: {
          auction_price: call.auction, decl: queue.shift()!, worlds: rounds[round]!, budget_ms: 0,
        } });
      }
    };
    const attach = (slot: Slot): void => {
      const worker = slot.worker;
      worker.onerror = event => { event.preventDefault(); if (slot.worker === worker) failed(slot, event.message); };
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (settled || slot.worker !== worker || data.id !== slot.current?.id) return;
        if (data.error) { failed(slot, data.error); return; }
        if (data.result === undefined) return; // No partial job checkpoints are rankable.
        const result = data.result as { error?: string };
        if (result === null || typeof result !== 'object') { finish('Invalid worker result.'); return; }
        if (result.error) { finish(result.error); return; }
        const work = slot.current!.work;
        delete slot.current;
        if (work.kind === 'merge') {
          // The shared Rust merger validates identity, coverage, fractions,
          // sample size and ties before producing this checkpoint.
          saved = result as AuctionSurvey;
          if (saved.worlds) completed.push(saved.worlds);
          if (++round === rounds.length) { finish(); return; }
          queue = [...DECLS]; receipts = []; pump();
        } else {
          receipts.push(result as AuctionPrice);
          if (receipts.length === DECLS.length) send(slot, { kind: 'merge', attempt: 0,
            call: { auction_merge: call.auction, worlds: rounds[round]!, receipts } });
          else pump();
        }
      };
    };
    try {
      for (let i = 0; i < size; i++) {
        const slot: Slot = { worker: create() }; slots.push(slot); attach(slot);
      }
      // Ask Rust for the validated unpriced fallback before starting any jobs.
      send(slots[0]!, { kind: 'merge', attempt: 0,
        call: { auction_merge: call.auction, worlds: 0, receipts: [] } });
    } catch (error) { finish(undefined, error); }
  });
}
