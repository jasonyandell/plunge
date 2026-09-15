import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, legalActions, newGame, TOURNAMENT_CONFIG, type Action } from '../src/engine';
import { AUCTION_BUDGET_MS, AUCTION_WORLDS, auctionKey, auctionMove, auctionRequest, checkedSurvey, type AuctionSurvey } from '../src/ai/auction';
import { requestOf } from '../src/ai/native';
import { initialApp, reducer, toSaved } from '../src/ui/store';
import { encodeHand, decodeHand } from '../src/ui/share';
import { writeFileSync } from 'node:fs';
vi.mock('../src/ai/phone/client',()=>({runAuction:vi.fn(),runPlayer:vi.fn()}));
import { runAuction } from '../src/ai/phone/client';
const fresh=()=>newGame(TOURNAMENT_CONFIG,'auction-test');
const survey=(g= fresh(),eligible=true): AuctionSurvey=>({...auctionRequest(g,'test'),schema:'walt-auction-v1',decl:5,
  prices:[0,1,2,3,4,5,6,7,9].map(d=>[d,d===5&&eligible?'4':'1','4']),worlds:4,eligible,route:'priced',elapsed_us:100});
afterEach(()=>vi.clearAllMocks());
describe('regular Walt auction',()=>{
  it('starts with an open auction and rotates it on the next hand',()=>{
    let s=reducer(initialApp(),{type:'new-game',seed:'auction',sessionId:'test'});
    expect(s.game!.phase).toBe('bidding');expect(s.game!.bids).toEqual([]);
    for(let i=0;i<4;i++) s={...s,game:applyAction(s.game!,{type:'bid',bid:{kind:'pass'}})};
    expect(s.game!.thrownIn).toBe(true);
    const shaker=s.game!.shaker;
    s=reducer(s,{type:'human',action:{type:'next-hand'}});
    expect(s.game!.bids).toEqual([]);expect(s.game!.shaker).toBe((shaker+1)%4);
  });
  it('prices only own hand at the cheapest legal bid and reuses trump after winning',async()=>{
    const g=fresh(), seat=g.turn!, reply=survey(g);vi.mocked(runAuction).mockResolvedValue(reply);
    const changed={...g,hands:g.hands.map((h,i)=>i===seat?h:[])};
    expect(auctionRequest(changed,'test')).toEqual(auctionRequest(g,'test'));
    expect(Object.keys(auctionRequest(g,'test')).sort()).toEqual(['bid','hand','seat','seed']);
    const decision=await auctionMove(g,seat,'test');
    expect(decision.action).toEqual({type:'bid',bid:{kind:'points',value:30}});
    expect(runAuction).toHaveBeenCalledWith({auction:auctionRequest(g,'test'),worlds:AUCTION_WORLDS,budget_ms:AUCTION_BUDGET_MS},undefined);
    let won=applyAction(g,decision.action);
    for(let i=0;i<3;i++) won=applyAction(won,{type:'bid',bid:{kind:'pass'}});
    const declared=await auctionMove(won,seat,'test',reply);
    expect(declared.action).toEqual({type:'declare',decl:{type:'pip',pip:5}});
    expect(runAuction).toHaveBeenCalledOnce();
  });
  it('passes weak samples and an existing partner bid, and honors raises',async()=>{
    let g=fresh();vi.mocked(runAuction).mockResolvedValue(survey(g,false));
    expect((await auctionMove(g,g.turn!,'test')).action).toEqual({type:'bid',bid:{kind:'pass'}});
    g=applyAction(g,{type:'bid',bid:{kind:'points',value:35}});
    expect(auctionRequest(g,'test').bid).toBe(36);
    g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
    vi.clearAllMocks();expect((await auctionMove(g,g.turn!,'test')).action).toEqual({type:'bid',bid:{kind:'pass'}});
    expect(runAuction).not.toHaveBeenCalled();
  });
  it('refuses partial, inconsistent, and stale auction results; persists the winning survey',()=>{
    const g=fresh(), r=survey(g), req=auctionRequest(g,'test');
    expect(()=>checkedSurvey(req,{...r,prices:r.prices.slice(1)})).toThrow(/Incomplete/);
    expect(()=>checkedSurvey(req,{...r,bid:31})).toThrow(/mismatched/);
    expect(()=>checkedSurvey(req,{...r,eligible:false})).toThrow(/threshold/);
    expect(checkedSurvey(req,{...r,worlds:160})).toMatchObject({worlds:160});
    const app={...reducer(initialApp(),{type:'new-game',seed:'auction-test',sessionId:'test'}),game:g};
    const decision={key:auctionKey(g,'test'),action:{type:'bid',bid:{kind:'points',value:30}} as Action,survey:r};
    const next=reducer(app,{type:'auction-ai',decision});
    expect(next.aiMoves).toBe(1);expect(reducer(next,{type:'auction-ai',decision})).toBe(next);
    expect(initialApp(toSaved(next)).auctionSurveys).toEqual(next.auctionSurveys);
  });
  it('plays, settles, and roundtrips higher points and marks contracts',()=>{
    const fixtures=[];
    for(const bid of [{kind:'points',value:31},{kind:'points',value:41},{kind:'marks',value:1},{kind:'marks',value:2}] as const) {
      let g=applyAction(fresh(),{type:'bid',bid});
      for(let i=0;i<3;i++)g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
      g=applyAction(g,{type:'declare',decl:{type:'pip',pip:5}});
      const target=bid.kind==='points'?bid.value:42;
      while(g.phase==='playing') {
        expect(requestOf(g,g.turn!,'test').bid).toBe(target);
        g=applyAction(g,legalActions(g)[0]!);
      }
      const code=encodeHand(g)!;expect(decodeHand(code)!.tricks).toEqual(g.tricks);
      expect(g.handResult!.marks).toBe(bid.kind==='points'?1:bid.value);
      fixtures.push({code,bid:target,points:g.points});
    }
    if(process.env.AUCTION_AUDIT_OUTPUT)writeFileSync(process.env.AUCTION_AUDIT_OUTPUT,JSON.stringify(fixtures));
  });
});
