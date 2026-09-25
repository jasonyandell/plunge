import { describe, expect, it, vi } from 'vitest';
import { counterexampleStats, decisionStats } from '../src/ai/decision-stats';
import { api, livePlayerCall, type NativeDecision, type NativeRequest } from '../src/ai/native';
import { initialApp, loadApp, pendingAiSeat, reducer, saveApp, toSaved, STORAGE_KEY } from '../src/ui/store';

import { applyAction, legalActions, newGame, PLUNGE_CONFIG } from '../src/engine';
import { runPlayer } from '../src/ai/phone/client';
vi.mock('../src/ai/phone/client', () => ({ runPlayer: vi.fn() }));

const request: NativeRequest = {contract:'nello',decl:8,bid:1,bidder:0,seat:3,hand:[4,7,12,14,16,25,27],plays:[],seed:1};
const legal=[4,16];
const response: NativeDecision = {contract:'nello',inactive:2,choice:16,legal,route:'baseline-counterexamples',leader:3,points:[0,0],elapsed_us:1,
  phases:[{name:'baseline',status:'completed'}], evaluation:{outer_worlds:1,options:[[4,'0','1'],[16,'0','1']]},
  counterexample_result:{schema:'nello-counterexamples-v1',status:'completed',stop:'round-limit',baseline:4,choice:16,
    ordinary_worlds:1,witnesses:4,rounds:1,score_kind:'witness-mixture',options:[[4,'2','5'],[16,'0','1']]}};

describe('Nel-O counterexample preview',()=>{
  it('always includes counterexamples for Nel-O defenders at both sample sizes',()=>{
    expect(livePlayerCall(request,'native-partner',false)).toEqual({request,worlds:40,partner:true,nello_counterexamples:true});
    expect(livePlayerCall(request,'native-partner',true)).toMatchObject({worlds:500,partner:false,nello_counterexamples:true});
    expect(livePlayerCall(request,'native-l1')).toHaveProperty('nello_counterexamples',true);
    expect(livePlayerCall({...request,seat:0},'native-l1',false)).not.toHaveProperty('nello_counterexamples');
    const {contract:_,...straight}=request;
    expect(livePlayerCall(straight,'native-l1',false)).not.toHaveProperty('nello_counterexamples');
    for(const difficulty of ['native-l1','native-partner'] as const) {
      expect(livePlayerCall(straight,difficulty,true)).toEqual({request:straight,worlds:500,partner:false,budget_ms:20000});
      const opening={...straight,seat:straight.bidder,plays:[]};
      expect(livePlayerCall(opening,difficulty,false).worlds).toBe(160);
      expect(livePlayerCall(opening,difficulty,true).worlds).toBe(500);
    }
  });
  it('keeps ordinary estimates and stress counts distinct, even after changing the lead',()=>{
    const ordinary=decisionStats(response,request,legal)!;
    expect(ordinary.worlds).toBe(1); expect(ordinary.options.every(o=>o.best)).toBe(true);
    const stress=counterexampleStats(response,request,legal)!;
    expect(stress.worlds).toBe(5);
    expect(stress.options.map(o=>[o.tile,o.successes,o.best])).toEqual([[16,5,true],[4,3,false]]);
    for(const bad of [{status:'unresolved'},{rounds:0},{witnesses:13},{score_kind:'probability'},{choice:27},{options:[[4,'1','0'],[16,'0','1']]}]) {
      expect(counterexampleStats({...response,counterexample_result:{...response.counterexample_result!,...bad} as NonNullable<NativeDecision['counterexample_result']>},request,legal)).toBeNull();
    }
  });
  it('persists the whole preview and accepts explicit on/off links',()=>{
    const values=new Map<string,string>(); const storage={removeItem:(k:string)=>{values.delete(k);},getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
    const app=initialApp(null,'?nello=preview'); expect(app.settings.nelloPreview).toBe(true);
    saveApp(storage,app); const saved=loadApp(storage)!;
    expect(initialApp(saved).settings.nelloPreview).toBe(true);
    expect(initialApp(saved,'?nello=off').settings.nelloPreview).toBe(false);
    expect(reducer(app,{type:'set-nello-preview',enabled:false}).settings.nelloPreview).toBe(false);
    expect(initialApp().settings.nelloPreview).toBe(false);
    const { nelloPreview: _, ...oldSettings } = saved.settings;
    for (const previous of [undefined, false, true]) {
      storage.setItem(STORAGE_KEY, JSON.stringify({...saved,settings:{...oldSettings,nelloCounterexamples:previous}}));
      expect(loadApp(storage)?.settings.nelloPreview).toBe(previous ?? false);
      expect(loadApp(storage)?.settings).not.toHaveProperty('nelloCounterexamples');
    }
    for (const invalid of ['true',1,null]) {
      storage.setItem(STORAGE_KEY,JSON.stringify({...saved,settings:{...saved.settings,nelloPreview:invalid}}));
      expect(loadApp(storage)).toBeNull();
    }
    expect(initialApp(null,'?nello=counterexamples').settings.nelloPreview).toBe(true);
    expect(initialApp(saved,'?nello=ordinary').settings.nelloPreview).toBe(false);
  });
  it('uses the full defense for fresh rechecks without a separate opt-in', async()=>{
    vi.mocked(runPlayer).mockResolvedValue(response);
    for (const worlds of [40,160,500] as const) {
      const estimate=await api<{identity:{player:unknown}}>('estimates',{request,worlds});
      expect(runPlayer).toHaveBeenLastCalledWith({request,worlds,partner:false,nello_counterexamples:true,
        ...(worlds>40 ? {budget_ms:20000} : {})},undefined);
      expect(estimate.identity.player).toEqual({n:worlds,nello_counterexamples:true});
    }
  });
  it('gates new and resumed auctions, stale declarations, and the next hand',()=>{
    const declaration={type:'declare',decl:{type:'nello'}} as const;
    let game=newGame(PLUNGE_CONFIG,'preview-gate');
    game=applyAction(game,{type:'bid',bid:{kind:'marks',value:1}});
    for(let i=0;i<3;i++) game=applyAction(game,{type:'bid',bid:{kind:'pass'}});
    let app=initialApp(toSaved({...initialApp(),game}));
    expect(legalActions(app.game!)).not.toContainEqual(declaration);
    expect(reducer(app,{type:'human',action:declaration})).toBe(app);
    expect(reducer(app,{type:'new-game',seed:'off'}).game?.config.nello).toBe('off');
    app=reducer(app,{type:'set-nello-preview',enabled:true});
    expect(legalActions(app.game!)).toContainEqual(declaration);
    expect(reducer(app,{type:'new-game',seed:'on'}).game?.config.nello).toBe('open');
    app=reducer(app,{type:'human',action:declaration});
    const active=app.game!;
    const off=reducer(app,{type:'set-nello-preview',enabled:false});
    expect(off.game).toBe(active); expect(off.screen).toBe('home');
    expect(reducer(off,{type:'resume'})).toBe(off);
    expect(pendingAiSeat({...off,screen:'table'})).toBeNull();
    expect(reducer(off,{type:'human',action:legalActions(active)[0]!})).toBe(off);
    app=reducer(reducer(off,{type:'set-nello-preview',enabled:true}),{type:'resume'});
    expect(app.screen).toBe('table'); expect(app.game).toBe(active);
    game=active;
    while(game.phase==='playing') game=applyAction(game,legalActions(game)[0]!);
    for(const enabled of [false,true]) {
      const ended=reducer({...app,game},{type:'set-nello-preview',enabled});
      const next=reducer(ended,{type:'human',action:{type:'next-hand'}});
      expect(next.game?.phase).toBe('bidding');
      expect(next.game?.config.nello).toBe(enabled?'open':'off');
    }
  });
});

it('the imported browser player performs the pass and retains a completed round on interruption', async()=>{
  const { readFileSync } = await import('node:fs');
  const module = await WebAssembly.compile(readFileSync(new URL('../src/ai/phone/walt-player.wasm',import.meta.url)));
  function run(stopAfterRound=false, reserveTest=false, worlds=160) {
    let x: {memory:WebAssembly.Memory;walt_in_prepare(n:number):number;walt_call():number;walt_out_ptr():number};
    let ticks=0n, stop=false;
    const checkpoints: NativeDecision[]=[];
    const decoder=new TextDecoder();
    const instance=new WebAssembly.Instance(module,{walt_host:{now_us:()=>stop ? ticks+=7000000n : ticks,
      checkpoint:(ptr:number,len:number)=>{
        const value=JSON.parse(decoder.decode(new Uint8Array(x.memory.buffer,ptr,len))) as NativeDecision;
        checkpoints.push(value);
        if(reserveTest && value.evaluation?.outer_worlds===40 && !value.counterexample_result?.rounds) ticks=14000000n;
        if(stopAfterRound && value.counterexample_result?.rounds===1) stop=true;
      }}});
    x=instance.exports as unknown as typeof x;
    const call={request:{...request,plays:[0,3,1,23,3,12,1,11,3,25,0,13,3,27,0,9,1,2]},worlds,partner:false,nello_counterexamples:true,budget_ms:20000};
    const bytes=new TextEncoder().encode(JSON.stringify(call));const ptr=x.walt_in_prepare(bytes.length);
    new Uint8Array(x.memory.buffer,ptr,bytes.length).set(bytes);const len=x.walt_call();
    return {result:JSON.parse(decoder.decode(new Uint8Array(x.memory.buffer,x.walt_out_ptr(),len))) as NativeDecision,checkpoints};
  }
  const full=run(); expect(full.result.choice).toBe(16);
  expect(full.result.counterexample_result).toMatchObject({baseline:7,rounds:3,witnesses:12,status:'completed'});
  expect(full.result.evaluation?.outer_worlds).toBe(160);
  const deep=run(false,false,500);
  expect(deep.result.evaluation?.outer_worlds).toBe(500);
  expect(deep.result.counterexample_result).toMatchObject({ordinary_worlds:500,status:'completed',rounds:3});
  const reserved=run(false,true,500);
  expect(reserved.result.evaluation?.outer_worlds).toBe(40);
  expect(reserved.result.phases).toContainEqual(expect.objectContaining({worlds:500,status:'no-time'}));
  expect(reserved.result.counterexample_result).toMatchObject({ordinary_worlds:40,status:'completed',rounds:3});
  const stopped=run(true);const saved=stopped.checkpoints.find(c=>c.counterexample_result?.rounds===1)!;
  expect(stopped.result.counterexample_result).toMatchObject({rounds:1,witnesses:4,status:'completed',stop:'deadline'});
  expect(stopped.result.choice).toBe(saved.choice);
  expect(stopped.result.counterexample_result?.options).toEqual(saved.counterexample_result?.options);
},30000);
