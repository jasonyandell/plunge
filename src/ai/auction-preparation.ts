import { AUCTION_BUDGET_MS, AUCTION_WORLDS, checkedSurvey, type AuctionCall, type AuctionRequest, type AuctionSurvey } from './auction';
import { runAuction } from './phone/client';
import type { AuctionPoolOptions } from './phone/auction-pool';

type Run = (call: AuctionCall, signal?: AbortSignal, options?: AuctionPoolOptions) => Promise<AuctionSurvey>;
const key = (r: AuctionRequest) => JSON.stringify([r.hand, r.seat, r.bid, r.seed]);
const aborted = () => new DOMException('Stopped', 'AbortError');

/** One pool at a time, shared by preparation and the actual bidder. Each seat
 * first gets a 12-world survey, then 40. Only complete surveys survive preemption. */
export class AuctionPreparation {
  private cache = new Map<string, AuctionSurvey>();
  private failed = new Set<string>();
  private wanted: AuctionRequest[] = [];
  private background: AbortController | undefined;
  private foreground: AbortController | undefined;
  private closed = false;

  constructor(private run: Run = runAuction) {}

  prepare(requests: AuctionRequest[]): void {
    this.pause();
    if (this.closed) return;
    this.wanted = requests;
    this.pump();
  }

  pause(): void {
    this.wanted = [];
    this.background?.abort();
    this.background = undefined;
  }

  close(): void {
    this.closed = true;
    this.pause();
    this.foreground?.abort();
    this.cache.clear();
  }

  private remember(request: AuctionRequest, survey: AuctionSurvey): void {
    if (this.closed || !survey.worlds) return;
    checkedSurvey(request, survey);
    if (survey.worlds >= (this.cache.get(key(request))?.worlds ?? 0)) this.cache.set(key(request), survey);
  }

  private pump(): void {
    if (this.closed || this.background || this.foreground) return;
    for (const worlds of [12, 40]) {
      const request = this.wanted.find(r => (this.cache.get(key(r))?.worlds ?? 0) < worlds && !this.failed.has(key(r)));
      if (!request) continue;
      const controller = new AbortController();
      this.background = controller;
      const initial = this.cache.get(key(request));
      void this.run({ auction: request, worlds, budget_ms: AUCTION_BUDGET_MS }, controller.signal, {
        initial, onSurvey: s => { if (!controller.signal.aborted) this.remember(request, s); },
      }).then(s => {
        if (controller.signal.aborted) return;
        this.remember(request, s);
        if (s.worlds < worlds) this.failed.add(key(request));
      }).catch(() => { if (!controller.signal.aborted) this.failed.add(key(request)); })
        .finally(() => {
          if (this.background !== controller) return;
          this.background = undefined;
          this.pump();
        });
      return;
    }
  }

  /** Start the full turn budget now, continuing a matching completed survey. */
  evaluate = async (request: AuctionRequest, signal?: AbortSignal): Promise<AuctionSurvey> => {
    if (this.closed || signal?.aborted) throw aborted();
    this.pause();
    this.foreground?.abort();
    const controller = new AbortController();
    this.foreground = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const initial = this.cache.get(key(request));
    try {
      const survey = await this.run({ auction: request, worlds: AUCTION_WORLDS, budget_ms: AUCTION_BUDGET_MS }, controller.signal, {
        initial, onSurvey: s => { if (!controller.signal.aborted) this.remember(request, s); },
      });
      if (controller.signal.aborted) throw aborted();
      this.remember(request, survey);
      return checkedSurvey(request, survey);
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.foreground === controller) this.foreground = undefined;
    }
  };
}
