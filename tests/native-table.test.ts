import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('VITE_NATIVE_TABLE', '1'));
import { writeFileSync } from 'node:fs';
import { applyAction, legalActions, newDealtGame, newGame, TOURNAMENT_CONFIG, type Declaration, type GameState, type Seat } from '../src/engine';
import { checkedAction, livePlayerCall, nativeMove, requestOf, type NativeReceipt } from '../src/ai/native';
import { tileOfId } from '../src/ai/walt/requests';
import { initialApp, practice30, reducer, toSaved } from '../src/ui/store';
import { encodeHand, decodeHand } from '../src/ui/share';
import { reviewLegal } from '../src/ui/NativeReview';

function opening(seed = 'native-test', decl: Declaration = { type: 'pip', pip: 3 }): GameState {
  return applyAction(practice30(newDealtGame(TOURNAMENT_CONFIG, newGame(TOURNAMENT_CONFIG, seed).dealt, 0)), { type: 'declare', decl });
}
function receipt(g: GameState, session = 'test'): NativeReceipt {
  const choice = legalActions(g).find((a) => a.type === 'play')!;
  if (choice.type !== 'play') throw new Error('no play');
  return { schema: 'plunge-decision-v1', id: 'a'.repeat(64), created: 'test',
    identity: { request: requestOf(g, g.turn!, session), player: { name: 'l1-partner-rollout' },
      implementation: {}, game_id: session, hand_number: g.handNumber },
    response: { choice: tileOfId(choice.domino), legal: [], route: 'test', leader: g.leader!, points: [...g.points], elapsed_us: 100 } };
}
afterEach(() => vi.unstubAllGlobals());

describe('native table boundary', () => {
  it('deepens only the bidder opening and leaves later partner play at the normal profile', () => {
    const g=opening(), openingRequest=requestOf(g,g.turn!,'test');
    expect(openingRequest.seat).toBe(openingRequest.bidder);expect(openingRequest.plays).toEqual([]);
    expect(livePlayerCall(openingRequest,'native-partner')).toEqual({request:openingRequest,worlds:160,partner:false,budget_ms:20000});
    expect(livePlayerCall({...openingRequest,seat:(openingRequest.seat+1)%4},'native-partner')).toEqual({
      request:{...openingRequest,seat:(openingRequest.seat+1)%4},worlds:40,partner:true});
    expect(livePlayerCall({...openingRequest,plays:[openingRequest.seat,openingRequest.hand[0]!]},'native-l1')).toMatchObject({worlds:40,partner:false});
  });

  it('can deepen every later seat with either computer setting', () => {
    const g=opening();
    const req=requestOf(g,g.turn!,'test');
    for (const seat of [0,1,2,3]) for (const difficulty of ['native-l1','native-partner'] as const) {
      const later={...req,seat,plays:[req.seat,req.hand[0]!]};
      expect(livePlayerCall(later,difficulty,true)).toEqual({request:later,worlds:160,partner:false,budget_ms:20000});
      expect(livePlayerCall(later,difficulty,false)).toMatchObject({worlds:40,partner:difficulty==='native-partner'});
    }
  });

  it('sends the opt-in deeper profile to the Mac without extra game information', async () => {
    const g=opening();
    const fetcher=vi.fn(async () => new Response(JSON.stringify(receipt(g)),{status:200}));
    vi.stubGlobal('fetch',fetcher);
    await nativeMove(g,g.turn!,'native-partner','test',undefined,true);
    const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
    expect(body).toEqual({request:requestOf(g,g.turn!,'test'),player:'l1-partner-rollout',game_id:'test',hand_number:g.handNumber,think_deeper:true});
  });

  it('sends only own hand and public history, independent of hidden holdings', async () => {
    const g = opening(); const seat = g.turn!;
    const others = [0,1,2,3].filter((s) => s !== seat);
    const hands = g.hands.map((h) => [...h]); const dealt = g.dealt.map((h) => [...h]);
    [hands[others[0]!]!, hands[others[1]!]!] = [hands[others[1]!]!, hands[others[0]!]!];
    [dealt[others[0]!]!, dealt[others[1]!]!] = [dealt[others[1]!]!, dealt[others[0]!]!];
    expect(requestOf({ ...g, hands, dealt }, seat, 'test')).toEqual(requestOf(g, seat, 'test'));
    const response = receipt(g);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await nativeMove(g, seat, 'native-partner', 'test');
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(['game_id','hand_number','player','request']);
    expect(Object.keys(body.request).sort()).toEqual(['bid','bidder','decl','hand','plays','seat','seed']);
    expect(body.request.hand).toEqual(g.dealt[seat]!.map(tileOfId).sort((a,b) => a-b));
  });

  it('rejects stale, illegal, and mechanically inconsistent answers', () => {
    const g = opening(); const r = receipt(g); const req = r.identity.request;
    expect(checkedAction(g, req, r).type).toBe('play');
    expect(() => checkedAction(g, { ...req, seed: req.seed+1 }, r)).toThrow(/match/);
    expect(() => checkedAction(g, req, { ...r, response: { ...r.response, points: [99,0] } })).toThrow(/disagree/);
    const absent = Array.from({length:28},(_,i)=>i).find((t)=>!req.hand.includes(t))!;
    expect(() => checkedAction(g, req, { ...r, response: { ...r.response, choice: absent } })).toThrow(/illegal/);
  });

  it('applies a receipt only once and retains it across a save and resume', () => {
    let app = reducer(initialApp(null), { type:'set-difficulty', difficulty:'native-partner' });
    app = reducer(app,{type:'new-game',seed:'native-test',sessionId:'test'});
    expect(app.game!.phase).toBe('bidding');
    app = {...app,game:opening()};
    // Pick an AI opening for this fixture (default shaker zero, bidder one).
    expect(app.game!.turn).not.toBe(0);
    const r = receipt(app.game!);
    const moved = reducer(app,{type:'native-ai',receipt:r});
    expect(moved.nativeReceipts[`${app.game!.handNumber}:0`]).toBe(r.id);
    expect(reducer(moved,{type:'native-ai',receipt:r})).toBe(moved);
    expect(initialApp(toSaved(moved)).nativeReceipts).toEqual(moved.nativeReceipts);
    expect(initialApp(toSaved(moved)).game).toEqual(moved.game);
    expect(reducer(app,{type:'native-ai',receipt:{...r,identity:{...r.identity,game_id:'elsewhere'}}})).toBe(app);
  });

  it('rotates fixed-30 bidders and exactly reconstructs every legal choice after a hand', () => {
    const declarations: Declaration[] = [0,1,2,3,4,5,6].map((pip)=>({type:'pip',pip:pip as 0|1|2|3|4|5|6}));
    declarations.push({type:'doubles'},{type:'no-trump'});
    const fixture = declarations.map((decl,i) => {
      let g = opening(`native-codec-${i}`,decl);
      const positions: {request: ReturnType<typeof requestOf>; legal:number[]; points:number[]; leader:number}[]=[];
      while(g.phase === 'playing') {
        const actions = legalActions(g).filter((a)=>a.type==='play');
        positions.push({ request:requestOf(g,g.turn as Seat,'codec'), legal:actions.map((a)=>tileOfId(a.domino)).sort((a,b)=>a-b),points:[...g.points],leader:g.leader! });
        g=applyAction(g,actions[0]!);
      }
      const code=encodeHand(g)!; expect(code).toBeTruthy(); expect(decodeHand(code)!.tricks).toEqual(g.tricks);
      positions.forEach((p,ply)=>expect(reviewLegal(g,{trick:Math.floor(ply/4),play:ply%4}).sort((a,b)=>a-b)).toEqual(p.legal));
      const next=practice30(applyAction(g,{type:'next-hand'}));
      expect(next.declarer).toBe((g.declarer!+1)%4);
      expect(next.contract).toEqual({kind:'points',value:30});
      return {code,positions,points:g.points};
    });
    // Explicit cross-language audit export; normal tests do not write fixtures.
    if(process.env.NATIVE_AUDIT_OUTPUT) writeFileSync(process.env.NATIVE_AUDIT_OUTPUT,JSON.stringify(fixture));
  });
});
