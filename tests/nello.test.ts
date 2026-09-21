import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/nello.json';
import { applyAction, legalActions, newDealtGame, PLUNGE_CONFIG, LEGACY_PLUNGE_CONFIG, type Seat } from '../src/engine';
import { decodeReplay, encodeReplay } from '../src/engine/replay-code';
import { playIndex, playLocation } from '../src/engine/play-index';
import { checkedAction, requestOf, requestKey, type NativeReceipt } from '../src/ai/native';
import { reviewPosition } from '../src/ai/native-analysis';
import { waltDeclarationOf, idOfTile } from '../src/ai/walt/requests';
import { initialApp, toSaved } from '../src/ui/store';
import { decodeObservation } from '../src/ui/observation-link';
import { validQuestion, publicQuestion, type Question } from '../src/questions/model';

const pass = {type:'bid', bid:{kind:'pass'}} as const;

describe('human-called own-suit Nel-O with Walt defense', () => {
  it('replays every physical seat, preserves three-play positions, receipts and reloads', () => {
    for (const f of fixtures) {
      const old=decodeReplay(f.replay)!;
      let g=newDealtGame(PLUNGE_CONFIG,old.dealt,old.shaker);
      g=applyAction(g,{type:'bid',bid:{kind:'marks',value:1}});
      for(let n=0;n<3;n++) g=applyAction(g,pass);
      expect(legalActions(g)).toContainEqual({type:'declare',decl:{type:'nello'}});
      g=applyAction(g,{type:'declare',decl:{type:'nello'}});
      expect(g.sittingOut).toBe((f.declarer+2)%4);
      const receipts: NativeReceipt[]=[];
      for(let ply=0;ply<f.plays.length/2;ply++) {
        const seat=f.plays[2*ply]! as Seat, tile=f.plays[2*ply+1]!;
        expect(g.turn).toBe(seat);
        const req=requestOf(g,seat,'nello-test');
        expect(Object.keys(req).sort()).toEqual(['bid','bidder','contract','decl','hand','plays','seat','seed']);
        expect(req).toMatchObject({contract:'nello',decl:8,bid:1,seat,bidder:f.declarer,plays:f.plays.slice(0,ply*2)});
        const hidden=(seat+1)%4, another=(seat+2)%4;
        const hands=g.hands.map(h=>[...h]),dealt=g.dealt.map(h=>[...h]);
        [hands[hidden]!,hands[another]!]=[hands[another]!,hands[hidden]!];
        [dealt[hidden]!,dealt[another]!]=[dealt[another]!,dealt[hidden]!];
        expect(requestOf({...g,hands,dealt},seat,'nello-test')).toEqual(req);
        const receipt:NativeReceipt={schema:'plunge-decision-v1',id:'a'.repeat(64),created:'2026-09-20',
          identity:{request:req,player:{name:'l1-default'},implementation:{test:true},game_id:'nello-test',hand_number:1},
          response:{contract:'nello',inactive:g.sittingOut!,choice:tile,legal:[],route:'test',leader:g.leader!,points:[...g.points],elapsed_us:0,phases:[]}};
        expect(checkedAction(g,req,receipt)).toEqual({type:'play',domino:idOfTile(tile)});
        const {contract:_,...missingContract}=receipt.response;
        expect(()=>checkedAction(g,req,{...receipt,response:missingContract})).toThrow(/contract/);
        receipts.push(receipt);
        g=applyAction(g,{type:'play',domino:idOfTile(tile)});
        const code=encodeReplay(g)!;
        expect(code.startsWith('v1l')).toBe(true);
        expect(decodeReplay(code)?.tricks).toEqual(g.tricks);
        expect(initialApp(toSaved({...initialApp(),game:g})).game).toEqual(g);
        const loc=playLocation(g,ply)!;
        expect(loc).toEqual({trick:Math.floor(ply/3),play:ply%3});
        expect(playIndex(g,loc.trick,loc.play)).toBe(ply);
        const q:Question={schema:'plunge-question-v1',id:'b'.repeat(32),created:'2026-09-20',game_id:'nello-test',hand_number:1,
          ply,seed:req.seed,snapshot:code,replay:code,note:'Why this play?',alternative:null,receipt_id:receipt.id,receipt,build:'test'};
        expect(validQuestion(q)).toEqual(q);
        expect(publicQuestion(q,null).location).toEqual(loc);
        expect(()=>validQuestion({...q,receipt:{...receipt,identity:{...receipt.identity,request:{...req,contract:undefined}}}})).toThrow(/different decision/);
      }
      expect(g.phase).toBe('hand-over');
      expect(g.points).toEqual(f.points);
      expect(g.tricks.map(t=>t.winner)).toEqual(f.winners);
      expect(g.hands[g.sittingOut!]!.length).toBe(7);
      for(let ply=0;ply<receipts.length;ply++) {
        const receipt=receipts[ply]!, loc=playLocation(g,ply)!;
        const position=reviewPosition(g,loc,receipt.identity.request.seed)!;
        expect(requestKey(position.request)).toBe(requestKey(receipt.identity.request));
        const hash='#q='+encodeURIComponent(JSON.stringify({v:2,hand:encodeReplay(g),ply,seed:position.request.seed,note:'Why?',alternative:null,receipt}));
        expect(decodeObservation(hash)?.flag.request).toEqual(position.request);
      }
    }
  });

  it('keeps old forced-bidding links and the computer auction at nine declarations', () => {
    expect(waltDeclarationOf(8)).toBeNull();
    const old=decodeReplay(fixtures[0]!.replay)!;
    let g=newDealtGame(LEGACY_PLUNGE_CONFIG,old.dealt,old.shaker);
    g=applyAction(g,{type:'bid',bid:{kind:'marks',value:1}});
    for(let i=0;i<3;i++) g=applyAction(g,pass);
    expect(legalActions(g)).not.toContainEqual({type:'declare',decl:{type:'nello'}});
    g=applyAction(g,{type:'declare',decl:{type:'no-trump'}});
    const code=encodeReplay(g)!;
    expect(code.startsWith('v1f')).toBe(true);
    expect(decodeReplay(code)?.config).toEqual(LEGACY_PLUNGE_CONFIG);
    expect(decodeReplay(code.replace('D9','Dn'))).toBeNull();
  });
});
