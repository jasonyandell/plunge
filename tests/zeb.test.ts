import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, play, version, netId, type Forecast } from '@jasonyandell/zeb';
import { applyAction, legalActions, newGame, LEGACY_PLUNGE_CONFIG, type Action } from '../src/engine';
import { requestOf, checkedAction, nativeMove, playerName } from '../src/ai/native';
import { zebPosition, zebAuctionAction, zebAuctionMove, ZEB_PLAYER, ZEB_WORLDS } from '../src/ai/zeb';
import { decisionStats } from '../src/ai/decision-stats';
import { auctionKey, auctionRequest } from '../src/ai/auction';
import { idOfTile } from '../src/ai/walt/requests';
import { initialApp, reducer, toSaved } from '../src/ui/store';
vi.mock('../src/ai/zeb/client',()=>({runZeb:vi.fn()}));
import { runZeb } from '../src/ai/zeb/client';

const fresh=()=>newGame(LEGACY_PLUNGE_CONFIG,'zeb-integration');
const forecasts=(p=0.9):Forecast[]=>[0,1,2,3,4,5,6,7,9].map(decl=>({decl,mean:0,pmake:Array.from({length:13},(_,i)=>decl===6 && i<=6 ? p : 0.1)}));
const declared=(decl=6)=>{
  let g=applyAction(fresh(),{type:'bid',bid:{kind:'points',value:36}});
  for(let i=0;i<3;i++)g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
  return applyAction(g,{type:'declare',decl:decl===7?{type:'doubles'}:decl===9?{type:'no-trump'}:{type:'pip',pip:decl as 6}});
};
beforeAll(()=>initSync({module:readFileSync(createRequire(import.meta.url).resolve('@jasonyandell/zeb/zeb_bg.wasm'))}));

describe('Zeb at the Plunge boundary',()=>{
  it('bids the forecast ceiling, passes weak hands and partners, and honors the forced minimum',()=>{
    expect(zebAuctionAction(fresh(),forecasts())).toEqual({type:'bid',bid:{kind:'points',value:36}});
    expect(zebAuctionAction(fresh(),forecasts(0.5))).toEqual({type:'bid',bid:{kind:'pass'}});
    let g=applyAction(fresh(),{type:'bid',bid:{kind:'points',value:30}});
    g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
    expect(zebAuctionAction(g,forecasts())).toEqual({type:'bid',bid:{kind:'pass'}});
    g=fresh();for(let i=0;i<3;i++)g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
    expect(zebAuctionAction(g,forecasts(0.1))).toEqual({type:'bid',bid:{kind:'points',value:30}});
    g=applyAction(fresh(),{type:'bid',bid:{kind:'marks',value:2}});
    expect(zebAuctionAction(g,forecasts())).toEqual({type:'bid',bid:{kind:'pass'}});
  });
  it('forecasts an arbitrary hand without a book and reuses that forecast when declaring',async()=>{
    const g=fresh(), seat=g.turn!, evaluate=vi.fn(async()=>({value:forecasts(),version:version(),net:netId(),elapsed_us:1}));
    const d=await zebAuctionMove(g,seat,'test',undefined,undefined,evaluate);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith(auctionRequest(g,'test'));
    expect(d.survey).toMatchObject({schema:'zeb-auction-v1',decl:6,worlds:160,cutoff:0.85});
    let won=applyAction(g,d.action);for(let i=0;i<3;i++)won=applyAction(won,{type:'bid',bid:{kind:'pass'}});
    expect((await zebAuctionMove(won,seat,'test',d.survey!,undefined,evaluate)).action).toEqual({type:'declare',decl:{type:'pip',pip:6}});
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it('sends no hidden hands and replays every straight declaration with engine-legal moves',()=>{
    for(const decl of [0,1,2,3,4,5,6,7,9]) {
      let g=declared(decl), count=0;
      while(g.phase==='playing') {
        const seat=g.turn!, request=requestOf(g,seat,'parity'), position=zebPosition(request,4);
        const changed={...g,hands:g.hands.map((h,i)=>i===seat?h:[])};
        expect(zebPosition(requestOf(changed,seat,'parity'),4)).toEqual(position);
        const result=play(position), action:Action={type:'play',domino:idOfTile(result.tile)};
        expect(legalActions(g)).toContainEqual(action);
        expect(position.hand).toHaveLength(7);
        g=applyAction(g,action);count++;
      }
      expect(count).toBeGreaterThan(0);expect(g.handResult).not.toBeNull();
    }
    expect(()=>zebPosition({...requestOf(declared(),declared().turn!,'test'),contract:'nello',decl:8})).toThrow(/Nel-O/);
  },30000);
  it('retains Zeb provenance in checked decision receipts and rejects them after a player switch',async()=>{
    const g=declared(),req=requestOf(g,g.turn!,'test'),result=play(zebPosition(req,4));
    vi.mocked(runZeb).mockResolvedValue({value:result,version:version(),net:netId(),elapsed_us:1});
    const receipt=await nativeMove(g,g.turn!,'zeb','test');
    expect(receipt.identity).toMatchObject({player:{name:ZEB_PLAYER},implementation:{package:'@jasonyandell/zeb',worlds:ZEB_WORLDS,net:netId()}});
    expect(checkedAction(g,req,receipt)).toEqual({type:'play',domino:idOfTile(result.tile)});
    expect(receipt.response.zeb_result).toEqual(result);
    const stats=decisionStats(receipt.response,req,receipt.response.legal)!;
    expect(stats.sampleBudget).toBe(true);
    expect(stats.options.every(row=>row.successes===null)).toBe(true);
    const defense=decisionStats(receipt.response,{...req,seat:(req.bidder+1)%4},receipt.response.legal)!;
    for(const [tile,q] of result.q)expect(defense.options.find(row=>row.tile===tile)!.chance).toBe(1-q);
    expect(decisionStats({...receipt.response,zeb_result:{...result,q:[[result.tile,NaN]]}},req,receipt.response.legal)).toBeNull();
    let app=reducer(initialApp(),{type:'set-difficulty',difficulty:'zeb'});
    app={...reducer(app,{type:'new-game',seed:'zeb-integration',sessionId:'test'}),game:g};
    const switched=reducer(app,{type:'set-difficulty',difficulty:'native-partner'});
    expect(reducer(switched,{type:'native-ai',receipt,epoch:app.epoch})).toBe(switched);
    expect(playerName('zeb',{...g,contract:{kind:'nello',value:1}})).toBe('l1-partner-rollout');
  });
  it('uses fresh deals and keeps player settings, surveys and games through save/resume',()=>{
    let app=reducer(initialApp(),{type:'set-difficulty',difficulty:'zeb'});
    app=reducer(app,{type:'new-game',seed:'fresh-zeb',sessionId:'test'});
    expect(app.game!.hands).toEqual(newGame(LEGACY_PLUNGE_CONFIG,'fresh-zeb').hands);
    const loaded=initialApp(toSaved(app));
    expect(loaded.settings.difficulty).toBe('zeb');expect(loaded.game).toEqual(app.game);
    const linked=initialApp(toSaved(app),'?settings=player');
    expect(linked.screen).toBe('more');expect(linked.game).toEqual(app.game);expect(linked.settings).toEqual(app.settings);
    expect(auctionKey(loaded.game!,'test')).toBe(auctionKey(app.game!,'test'));
  });
});
