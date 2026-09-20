import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyAction, legalActions, newDealtGame, newGame, TOURNAMENT_CONFIG, type GameState, type Seat } from '../src/engine';
import { BID_BOOK, bestPanel, playedHand, qualifies, validateBook, type PlayedHand } from '../src/ai/bid-book';
import { anticipatedAuctions, auctionMove } from '../src/ai/auction';
import { tileOfId } from '../src/ai/walt/requests';
import { catalogueDeal, catalogueSeed } from '../src/ai/catalogue';
import { initialApp, reducer, toSaved } from '../src/ui/store';
vi.mock('../src/ai/phone/client',()=>({runAuction:vi.fn(),runPlayer:vi.fn()}));
import { runAuction } from '../src/ai/phone/client';
const gameFor=(h: PlayedHand): GameState => newDealtGame(TOURNAMENT_CONFIG,newGame(TOURNAMENT_CONFIG,h.seed).dealt,((h.seat+3)%4) as Seat);
const ceiling=(h: PlayedHand)=>Math.max(0,...h.panels.flatMap(p=>p.tails.flatMap((n,i)=>5*n>=4*p.games?[i+30]:[])));
beforeEach(()=>vi.clearAllMocks());

describe('empirical bid book',()=>{
 it('covers every seat in all 125 engine-generated catalogue deals',()=>{
  expect(BID_BOOK.games).toBe(305440);expect(BID_BOOK.hands).toHaveLength(500);
  for(const seed of BID_BOOK.seeds){
   const g=newGame(TOURNAMENT_CONFIG,seed);
   for(let seat=0;seat<4;seat++){
    const hand=g.hands[seat]!.map(tileOfId);const h=playedHand(hand,seat)!;
    expect(h.seed).toBe(seed);expect(h.hand).toEqual([...hand].sort((a,b)=>a-b));
   }
  }
 });
 it('refuses old model surveys, broken tails, incomplete declarations and duplicate catalogues',()=>{
  expect(()=>validateBook({schema:'kiln-book-v1'})).toThrow();
  for(const damage of [(b:any)=>b.hands[0].panels[0].tails[1]=9999,(b:any)=>b.hands[0].panels.pop(),
   (b:any)=>b.hands.push(b.hands[0]),(b:any)=>b.threshold=[3,4],(b:any)=>b.games++]){
   const b=structuredClone(BID_BOOK);damage(b);expect(()=>validateBook(b)).toThrow();
  }
 });
 it('takes the highest empirical supported bid, or passes, across all 500 hands without a worker',async()=>{
  for(const h of BID_BOOK.hands){
   const g=gameFor(h),d=await auctionMove(g,h.seat as Seat,'book-test');const max=ceiling(h);
   expect(legalActions(g)).toContainEqual(d.action);
   expect(d.action).toEqual(max===0?{type:'bid',bid:{kind:'pass'}}:max<42?{type:'bid',bid:{kind:'points',value:max}}:{type:'bid',bid:{kind:'marks',value:1}});
   expect(d.survey?.schema).toBe('plunge-played-auction-v1');
   if(d.survey?.schema==='plunge-played-auction-v1'){
    expect(d.survey.book_id).toBe(BID_BOOK.source_book);expect(d.survey.policy_bid).toBe(30);
    expect(d.survey.decl).toBe(bestPanel(h.panels,max||30).decl);
   }
  }
  expect(runAuction).not.toHaveBeenCalled();
 });
 it('depends only on own hand and public auction, respects partner, and never overbids a raise',async()=>{
  const h=BID_BOOK.hands.find(h=>ceiling(h)>=35)!,g=gameFor(h),seat=h.seat as Seat;
  const original=await auctionMove(g,seat,'privacy');
  expect(await auctionMove({...g,hands:g.hands.map((hand,i)=>i===seat?hand:[])},seat,'privacy')).toEqual(original);
  const partner=((seat+2)%4) as Seat,opponent=((seat+3)%4) as Seat;
  expect((await auctionMove({...g,bids:[{seat:partner,bid:{kind:'points',value:30}}]},seat,'privacy')).action).toEqual({type:'bid',bid:{kind:'pass'}});
  expect((await auctionMove({...g,bids:[{seat:opponent,bid:{kind:'points',value:41}}]},seat,'privacy')).action).toEqual({type:'bid',bid:{kind:'pass'}});
  expect(anticipatedAuctions(g,'privacy',0)).toEqual([]);expect(runAuction).not.toHaveBeenCalled();
 });
 it('names the best declaration at the actual contract after winning; supports a forced weak bid',async()=>{
  const h=BID_BOOK.hands.find(h=>ceiling(h)>=35)!,seat=h.seat as Seat;let g=gameFor(h);
  const d=await auctionMove(g,seat,'trumps');g=applyAction(g,d.action);
  for(let i=0;i<3;i++)g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
  const declaration=await auctionMove(g,seat,'trumps',d.survey!);
  expect(legalActions(g)).toContainEqual(declaration.action);expect(declaration.survey?.bid).toBe(ceiling(h));
  expect(declaration.survey?.decl).toBe(d.survey?.decl);
  const weak=BID_BOOK.hands.find(h=>!ceiling(h))!;const w=gameFor(weak);
  const forced={...w,shaker:weak.seat as Seat,config:{...w.config,allPass:'force-30' as const},bids:[1,2,3].map(n=>({seat:((weak.seat+n)%4) as Seat,bid:{kind:'pass' as const}}))};
  const f=await auctionMove(forced,weak.seat as Seat,'forced');expect(f.action).toEqual({type:'bid',bid:{kind:'points',value:30}});
  expect(f.survey).toMatchObject({forced:true,eligible:false});expect(runAuction).not.toHaveBeenCalled();
 });
 it('selects no-repeat catalogue deals and preserves match state, reloads and next-hand rotation',()=>{
  const seeds=Array.from({length:125},(_,i)=>catalogueSeed('match',i+1));expect(new Set(seeds).size).toBe(125);
  expect(seeds).toEqual(Array.from({length:125},(_,i)=>catalogueSeed('match',i+1)));
  let s=reducer(initialApp(),{type:'new-game',seed:'catalogue',sessionId:'catalogue'});
  for(let i=0;i<7;i++){
   const g=s.game!;for(let seat=0;seat<4;seat++)expect(playedHand(g.hands[seat]!.map(tileOfId),seat)).toBeDefined();
   const resumed=initialApp(toSaved(s));expect(resumed.game).toEqual(g);
   for(let pass=0;pass<4;pass++)s={...s,game:applyAction(s.game!,{type:'bid',bid:{kind:'pass'}})};
   s=reducer(s,{type:'human',action:{type:'next-hand'}});expect(s.game!.handNumber).toBe(g.handNumber+1);expect(s.game!.shaker).toBe((g.shaker+1)%4);
  }
  const plain=newGame(TOURNAMENT_CONFIG,'carry'),changed=catalogueDeal({...plain,marks:[3,4],handNumber:8},'carry');
  expect(changed.marks).toEqual([3,4]);expect(changed.rngState).toBe(plain.rngState);
  expect(()=>catalogueDeal(applyAction(plain,{type:'bid',bid:{kind:'pass'}}),'carry')).toThrow();
 });
 it('retains empirical auction provenance through a saved match and rejects stale dispatches',async()=>{
  let app=reducer(initialApp(),{type:'new-game',seed:'save-book',sessionId:'save'});
  while(app.game!.turn===0)app=reducer(app,{type:'human',action:{type:'bid',bid:{kind:'pass'}}});
  const g=app.game!,d=await auctionMove(g,g.turn!,'save');const next=reducer(app,{type:'auction-ai',decision:d});
  expect(next.aiMoves).toBe(1);expect(reducer(next,{type:'auction-ai',decision:d})).toBe(next);
  expect(initialApp(toSaved(next)).auctionSurveys).toEqual(next.auctionSurveys);
 });
});
