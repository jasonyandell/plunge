import { describe, expect, it } from 'vitest';
import { decisionStats, reviewPosition } from '../src/ai/native-analysis';
import { type NativeDecision, type NativeRequest } from '../src/ai/native';
import { decodeHand } from '../src/ui/share';
import { ledChip } from '../src/ui/store';

const request: NativeRequest = { bid:30, bidder:0, decl:0, seat:3, seed:1904490871,
  hand:[10,14,16,17,22,26,27], plays:[0,0,1,21,2,15,3,10,0,5,1,12,2,4,3,17,0,9,1,24,2,8] };
const legal = [14,16,22,26,27];
const response: NativeDecision = { choice:27, legal, route:'baseline', leader:0, points:[0,0], elapsed_us:160000,
  phases:[{name:'baseline',status:'completed'},{name:'fallback-l1',status:'completed'}],
  evaluation:{outer_worlds:40, options:[[14,'21','40'],[16,'9','20'],[22,'19','40'],[26,'17','40'],[27,'2','5']]},
  fallback_evaluation:{outer_worlds:8,options:[[14,'0','1'],[16,'1','1'],[22,'1','1'],[26,'1','1'],[27,'1','1']]} };

describe('native review evidence', () => {
  it('shows the actual defender sample: double six 60%, five-one 55%', () => {
    const stats=decisionStats(response,request,legal)!;
    expect(stats.objective).toBe('set'); expect(stats.worlds).toBe(40);
    expect(stats.options[0]).toEqual({tile:27,chance:0.6,successes:24,best:true});
    expect(stats.options.find((a)=>a.tile===16)?.successes).toBe(22);
    expect(stats.options.find((a)=>a.tile===14)?.best).toBe(false);
  });
  it('ranks make for declarers, including exact ties and reduced fractions', () => {
    const tied={...response,evaluation:{outer_worlds:40,options:[[14,'1','2'],[16,'20','40']] as [number,string,string][]}};
    const stats=decisionStats(tied,{...request,seat:2},[14,16])!;
    expect(stats.objective).toBe('make'); expect(stats.options.every((a)=>a.best && a.successes===20)).toBe(true);
  });
  it('uses the accepted fallback and its actual eight worlds when primary fails', () => {
    const stats=decisionStats({...response,route:'l1-fallback',phases:[{name:'baseline',status:'timeout'},{name:'fallback-l1',status:'completed'}]},request,legal)!;
    expect(stats.fallback).toBe(true); expect(stats.worlds).toBe(8); expect(stats.options[0]?.tile).toBe(14);
    expect(decisionStats({...response,phases:[{name:'baseline',status:'timeout'}]},request,legal)).toBeNull();
    expect(decisionStats({...response,route:'legal-fallback'},request,legal)).toBeNull();
  });
  it('does not invent estimates for forced moves, invalid fractions or incomplete options', () => {
    expect(decisionStats({...response,route:'forced',evaluation:null},request,[27])).toBeNull();
    for(const options of [[[14,'1','0']],[[14,'2','1']],[[14,'NaN','2']],[[29,'1','2']],[[14,'1','2'],[14,'1','2']]] as [number,string,string][][]) {
      expect(decisionStats({...response,evaluation:{outer_worlds:40,options}},request,[14])).toBeNull();
    }
    expect(decisionStats(response,request,[14])).toBeNull();
  });
  it('keeps the L1 estimate when a separate partner check changes the move', () => {
    expect(decisionStats({...response,choice:16,route:'baseline-reviewed'},request,legal)).toEqual(decisionStats(response,request,legal));
  });
  it('reconstructs the flagged forced trump using only the prefix and acting hand', () => {
    const code='v1t063444130201000615453434233226460555131211166656252504032.30PPPD261646563522042216210223133115030435540440053603266415451';
    const g=decodeHand(code)!; const sel={trick:2,play:2};
    const p=reviewPosition(g,sel,1854158014)!;
    expect(p.legal).toEqual([5]); expect(p.played).toBe(5); expect(p.remaining).toEqual([5,9,13,18,19]);
    expect(ledChip(g,g.tricks[2]!.plays.slice(0,2))).toBe('trumps');
    expect(Object.keys(p.request).sort()).toEqual(['bid','bidder','decl','hand','plays','seat','seed']);
    const changed={...g,dealt:g.dealt.map((h,s)=>s===p.request.seat?h:[]) ,hands:[],tricks:g.tricks.slice(0,3)};
    expect(reviewPosition(changed,sel,1854158014)).toEqual(p);
  });
});
