import { afterEach, describe, expect, it, vi } from 'vitest';
import { putReceipt, getReceipt } from '../src/ai/phone/records';
import { runInWorker } from '../src/ai/phone/client';
import { type NativeDecision, type NativeReceipt } from '../src/ai/native';
import { decodeObservation, observationUrl } from '../src/ui/observation-link';
import { decodeHand } from '../src/ui/share';
import { reviewPosition } from '../src/ai/native-analysis';
import { initialApp, reducer } from '../src/ui/store';

const code='v1t063444130201000615453434233226460555131211166656252504032.30PPPD261646563522042216210223133115030435540440053603266415451';
const game=decodeHand(code)!;
const position=reviewPosition(game,{trick:2,play:2},42)!;
const response:NativeDecision={choice:5,legal:[5],route:'forced',leader:3,points:[0,0],elapsed_us:4};
const receipt:NativeReceipt={schema:'plunge-decision-v1',id:'a'.repeat(64),created:'test',
  identity:{request:position.request,player:{name:'l1-default'},implementation:{build:'test'},game_id:'test',hand_number:1},response};
class FakeWorker {
  onmessage: ((event:MessageEvent)=>void) | null = null;
  onerror: ((event:ErrorEvent)=>void) | null = null;
  postMessage=vi.fn();terminate=vi.fn();
  send(value:unknown) { this.onmessage?.({data:{id:0,...value as object}} as MessageEvent); }
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('phone player lifetime',()=>{
  it('returns a completed result and destroys the worker',async()=>{
    const worker=new FakeWorker();const p=runInWorker(()=>worker as unknown as Worker,{request:position.request,worlds:40,partner:true});
    worker.send({checkpoint:response});worker.send({result:{...response,elapsed_us:8}});
    expect((await p).elapsed_us).toBe(8);expect(worker.terminate).toHaveBeenCalledOnce();
    expect(Object.keys(worker.postMessage.mock.calls[0]![0].call.request).sort()).toEqual(['bid','bidder','decl','hand','plays','seat','seed']);
  });
  it('a hard timeout retains the last complete checkpoint, including its original scores',async()=>{
    vi.useFakeTimers();const worker=new FakeWorker();
    const p=runInWorker(()=>worker as unknown as Worker,{request:position.request,worlds:40,partner:true,budget_ms:100});
    worker.send({checkpoint:response});vi.advanceTimersByTime(4100);
    expect(await p).toMatchObject({...response,interruption:expect.any(String)});
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('leaving a position aborts without playing a stale checkpoint',async()=>{
    const worker=new FakeWorker(), controller=new AbortController();
    const p=runInWorker(()=>worker as unknown as Worker,{request:position.request,worlds:40,partner:false},controller.signal);
    const rejected=expect(p).rejects.toMatchObject({name:'AbortError'});
    worker.send({checkpoint:response});controller.abort();await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('a load failure with no checkpoint is retryable and does not choose an unrelated AI',async()=>{
    const worker=new FakeWorker();const p=runInWorker(()=>worker as unknown as Worker,{request:position.request,worlds:40,partner:true});
    const rejected=expect(p).rejects.toThrow('load failed');worker.send({error:'load failed'});await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
describe('portable phone observations',()=>{
  it('keeps play and session scores available when device storage fails',async()=>{
    vi.stubGlobal('indexedDB',{open:()=>{throw new Error('storage unavailable');}});
    expect(await putReceipt(receipt)).toBe(false);expect(await getReceipt(receipt.id)).toEqual(receipt);
  });
  it('replays the selected move, Unicode note, seed and original receipt on another device',()=>{
    vi.stubGlobal('location',{origin:'https://plunge.example',pathname:'/'});
    const url=observationUrl(game,10,42,'Why trump Gran? 🁡',5,receipt)!;
    const decoded=decodeObservation(new URL(url).hash)!;
    expect(decoded.game.tricks).toEqual(game.tricks);expect(decoded.flag.request).toEqual(position.request);
    expect(decoded.flag.note).toBe('Why trump Gran? 🁡');expect(decoded.flag.original_receipt).toEqual(receipt);
    const app=reducer(initialApp(),{type:'new-game',seed:'ongoing'});
    expect(reducer(app,{type:'view-scenario',...decoded}).game).toBe(app.game);
  });
  it('rejects inconsistent selected positions, receipts and illegal alternatives',()=>{
    vi.stubGlobal('location',{origin:'https://plunge.example',pathname:'/'});
    const base={v:2,hand:code,ply:10,seed:42,note:'test',alternative:null,receipt};
    for(const bad of [{...base,ply:99},{...base,alternative:27},{...base,seed:-1},
      {...base,receipt:{...receipt,response:{...response,choice:27}}},
      {...base,receipt:{...receipt,identity:{...receipt.identity,request:{...position.request,seed:44}}}}]) {
      expect(decodeObservation('#q='+encodeURIComponent(JSON.stringify(bad)))).toBeNull();
    }
  });
  it('the default table player is shared Walt with an open auction',()=>{
    const app=reducer(initialApp(),{type:'new-game',seed:'phone'});
    expect(app.settings.difficulty).toBe('native-partner');expect(app.game!.contract).toBeNull();
    expect(app.game!.phase).toBe('bidding');expect(app.game!.bids).toEqual([]);
  });
});
