import { describe, expect, it, vi } from 'vitest';
import { AuctionPreparation } from '../src/ai/auction-preparation';
import { anticipatedAuctions, type AuctionCall, type AuctionRequest, type AuctionSurvey } from '../src/ai/auction';
import type { AuctionPoolOptions } from '../src/ai/phone/auction-pool';
import { applyAction, newGame, TOURNAMENT_CONFIG } from '../src/engine';

const request: AuctionRequest = { hand: [1,6,8,19,20,23,27], seat: 1, bid: 30, seed: 420914 };
const survey = (r = request, worlds = 12): AuctionSurvey => ({ ...r, schema:'walt-auction-v1', decl:5,
  prices:[0,1,2,3,4,5,6,7,9].map(d=>[d,d===5?'1':'0','1']), worlds, eligible:true, route:'priced', elapsed_us:100 });
function setup() {
  const jobs: { call: AuctionCall; signal?: AbortSignal | undefined; options?: AuctionPoolOptions | undefined; finish: (s: AuctionSurvey) => void }[] = [];
  const run = vi.fn((call: AuctionCall, signal?: AbortSignal, options?: AuctionPoolOptions) => new Promise<AuctionSurvey>((resolve, reject) => {
    jobs.push({call,signal,options,finish:resolve});
    signal?.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
  }));
  return { prep:new AuctionPreparation(run),jobs,run };
}
const flush = async () => { for (let i=0;i<6;i++) await Promise.resolve(); };

describe('bidding preparation',()=>{
  it('prepares each seat at 12 before 40, running only one pool at once',async()=>{
    const {prep,jobs}=setup(), other={...request,seat:2};
    prep.prepare([request,other]);expect(jobs).toHaveLength(1);
    jobs[0]!.finish(survey());await flush();
    expect(jobs[1]!.call).toMatchObject({auction:other,worlds:12});
    jobs[1]!.finish(survey(other));await flush();
    expect(jobs[2]!.call).toMatchObject({auction:request,worlds:40});
    expect(jobs[2]!.options!.initial!.worlds).toBe(12);
    prep.close();await flush();expect(jobs).toHaveLength(3);
  });
  it('preempts background work, retains only a complete survey and gives the bidder a fresh budget',async()=>{
    const {prep,jobs}=setup();prep.prepare([request]);
    jobs[0]!.options!.onSurvey!(survey(request,4));
    const result=prep.evaluate(request);
    expect(jobs[0]!.signal!.aborted).toBe(true);
    expect(jobs[1]!.call).toMatchObject({worlds:160,budget_ms:20000});
    expect(jobs[1]!.options!.initial!.worlds).toBe(4);
    // A late checkpoint from the terminated pool cannot overwrite evidence.
    jobs[0]!.options!.onSurvey!(survey(request,40));
    jobs[1]!.finish(survey(request,160));
    expect((await result).worlds).toBe(160);prep.close();
  });
  it('does not reuse a different bid, hand, seat or sample seed',async()=>{
    for(const change of [{bid:31},{hand:[0,6,8,19,20,23,27]},{seat:2},{seed:12}]) {
      const {prep,jobs}=setup();prep.prepare([request]);jobs[0]!.options!.onSurvey!(survey());
      const changed={...request,...change},result=prep.evaluate(changed);
      expect(jobs[1]!.options!.initial).toBeUndefined();
      jobs[1]!.finish(survey(changed,160));await result;prep.close();
    }
  });
  it('does not spin on background deadlines or let canceled turns return a bid',async()=>{
    const {prep,jobs}=setup();prep.prepare([request]);jobs[0]!.finish(survey(request,4));await flush();
    expect(jobs).toHaveLength(1);
    const controller=new AbortController(),result=prep.evaluate(request,controller.signal);
    const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
    controller.abort();await rejected;prep.close();
    await expect(prep.evaluate(request)).rejects.toMatchObject({name:'AbortError'});
  });
  it('builds own-hand-only requests and excludes seats that already bid or currently defer to partner',()=>{
    let g=newGame(TOURNAMENT_CONFIG,'preparation');
    const requests=anticipatedAuctions(g,'game',0);
    expect(requests).toHaveLength(3);
    for(const r of requests)expect(Object.keys(r).sort()).toEqual(['bid','hand','seat','seed']);
    const bidder=g.turn!;
    g=applyAction(g,{type:'bid',bid:{kind:'points',value:35}});
    const next=anticipatedAuctions(g,'game',0);
    expect(next.every(r=>r.bid===36 && r.seat!==bidder && r.seat!==(bidder+2)%4)).toBe(true);
  });
});
