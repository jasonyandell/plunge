import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, legalActions, legalDominoes, newGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { getHint, hintExplanation } from '../src/ai/hint';
import { api, requestOf, type NativeEstimate } from '../src/ai/native';
import { tileOfId } from '../src/ai/walt/requests';
import { hintTrickEffect } from '../src/ui/MoveHint';
import { initialApp, toSaved } from '../src/ui/store';
import { writeFileSync } from 'node:fs';

vi.mock('../src/ai/native', async original => ({...await original<typeof import('../src/ai/native')>(), api:vi.fn()}));

function position(defending=false, forced=false): GameState {
  for(let seed=0;seed<100;seed++) {
    let g=newGame(PLUNGE_CONFIG,`hint-${seed}`);
    g={...g,shaker:defending?0:3,turn:defending?1:0};
    g=applyAction(g,{type:'bid',bid:{kind:'points',value:30}});
    for(let i=0;i<3;i++)g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
    g=applyAction(g,{type:'declare',decl:{type:'pip',pip:3}});
    while(g.phase==='playing') {
      if(g.turn===0 && (legalDominoes(g).length===1)===forced)return g;
      g=applyAction(g,legalActions(g)[0]!);
    }
  }
  throw Error('fixture missing');
}
function estimate(g:GameState,worlds=40):NativeEstimate {
  const request=requestOf(g,0,'hint-test'),legal=legalDominoes(g).map(tileOfId),defending=request.bidder%2!==0;
  return {schema:'plunge-estimate-v1',id:'test',created:'test',identity:{request,player:{n:worlds}},response:{
    choice:legal[0]!,legal,route:'baseline',leader:g.leader!,points:[...g.points],elapsed_us:100,
    phases:[{name:'baseline',status:'completed'}],
    evaluation:{outer_worlds:worlds,options:legal.map((t,i)=>[t,i===0?(defending?'0':'1'):'1',i===0?'1':'2'])},
  }};
}
beforeEach(()=>vi.clearAllMocks());
describe('own-view move hints',()=>{
  it('compares only own hand and public history, without changing the game',async()=>{
    const g=position(),snapshot=JSON.stringify(g),reply=estimate(g);vi.mocked(api).mockResolvedValue(reply);
    const controller=new AbortController();const hint=await getHint(g,'hint-test',40,controller.signal);
    expect(api).toHaveBeenCalledWith('estimates',{request:reply.identity.request,worlds:40},18000,controller.signal);
    expect(Object.keys(reply.identity.request).sort()).toEqual(['bid','bidder','decl','hand','plays','seat','seed']);
    const hidden={...g,hands:g.hands.map((h,s)=>s===0?h:[]),dealt:g.dealt.map((h,s)=>s===0?h:[])};
    expect(await getHint(hidden,'hint-test',40)).toEqual(hint);
    expect(hintTrickEffect(hidden,hint.choice!)).toBe(hintTrickEffect(g,hint.choice!));
    expect(JSON.stringify(g)).toBe(snapshot);
    expect(hintExplanation(hint)).toContain('Your team made the 30 bid in 40 of 40 sampled deals');
    if(process.env.HINT_FIXTURE_OUTPUT)writeFileSync(process.env.HINT_FIXTURE_OUTPUT,JSON.stringify({
      normal:toSaved({...initialApp(),game:g,sessionId:'hint-test'}),
      forced:toSaved({...initialApp(),game:position(false,true),sessionId:'hint-test'}),
    }));
  });
  it('explains setting the bid from the defender perspective and names ties honestly',async()=>{
    const g=position(true),reply=estimate(g,160);vi.mocked(api).mockResolvedValue(reply);
    const hint=await getHint(g,'hint-test',160);
    expect(hint.stats!.options[0]!.chance).toBe(1);
    expect(hintExplanation(hint)).toContain('Your team set the 30 bid in 160 of 160 sampled deals');
    reply.response.evaluation!.options=reply.response.evaluation!.options.map(([t])=>[t,'1','2']);
    const tied=await getHint(g,'hint-test',160);
    expect(hintExplanation(tied)).toContain('plays tied for the highest estimate');
  });
  it('explains a forced move without starting a calculation',async()=>{
    const g=position(false,true),hint=await getHint(g,'hint-test',40);
    expect(hint.choice).toBe(tileOfId(legalDominoes(g)[0]!));expect(hint.forced).toBe(true);
    expect(hintExplanation(hint)).toBe('This is your only legal play.');expect(api).not.toHaveBeenCalled();
  });
  it('withholds unscored fallback advice but retains a completed smaller sample',async()=>{
    const g=position(),reply=estimate(g);reply.response.route='legal-fallback';vi.mocked(api).mockResolvedValue(reply);
    expect((await getHint(g,'hint-test',40)).choice).toBeNull();
    reply.response.route='l1-fallback';reply.response.phases=[{name:'fallback-l1',status:'completed'}];
    reply.response.fallback_evaluation={...reply.response.evaluation!,outer_worlds:8};
    const hint=await getHint(g,'hint-test',40);
    expect(hint.stats).toMatchObject({fallback:true,worlds:8});expect(hintExplanation(hint)).toContain('8 of 8');
    expect(hint.requestedWorlds).toBe(40);
  });
  it('rejects stale, illegal, inconsistent and non-highest recommendations',async()=>{
    const g=position(),original=estimate(g);
    for(const change of [
      (v:NativeEstimate)=>{v.identity.request.seed++;},
      (v:NativeEstimate)=>{v.identity.player.n=160;},
      (v:NativeEstimate)=>{v.response.choice=99;},
      (v:NativeEstimate)=>{v.response.points=[42,0];},
      (v:NativeEstimate)=>{v.response.choice=v.response.legal[1]!;},
    ]) {
      const reply=structuredClone(original);change(reply);vi.mocked(api).mockResolvedValue(reply);
      await expect(getHint(g,'hint-test',40)).rejects.toThrow();
    }
  });
  it('rejects a response after cancellation and refuses another player’s turn',async()=>{
    const g=position(),controller=new AbortController();vi.mocked(api).mockImplementation(async()=>{
      controller.abort();return estimate(g);
    });
    await expect(getHint(g,'hint-test',40,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    await expect(getHint({...g,turn:1},'hint-test',40)).rejects.toThrow('your turn');
  });
});
