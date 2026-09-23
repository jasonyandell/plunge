import { describe, expect, it } from 'vitest';
import { counterexampleStats, decisionStats } from '../src/ai/decision-stats';
import { livePlayerCall, type NativeDecision, type NativeRequest } from '../src/ai/native';
import { initialApp, loadApp, reducer, saveApp } from '../src/ui/store';

const request: NativeRequest = {contract:'nello',decl:8,bid:1,bidder:0,seat:3,hand:[4,7,12,14,16,25,27],plays:[],seed:1};
const legal=[4,16];
const response: NativeDecision = {contract:'nello',inactive:2,choice:16,legal,route:'baseline-counterexamples',leader:3,points:[0,0],elapsed_us:1,
  phases:[{name:'baseline',status:'completed'}], evaluation:{outer_worlds:1,options:[[4,'0','1'],[16,'0','1']]},
  counterexample_result:{schema:'nello-counterexamples-v1',status:'completed',stop:'round-limit',baseline:4,choice:16,
    ordinary_worlds:1,witnesses:4,rounds:1,score_kind:'witness-mixture',options:[[4,'2','5'],[16,'0','1']]}};

describe('Nel-O counterexample preview',()=>{
  it('opts in only the defender and keeps hidden state out of the call',()=>{
    expect(livePlayerCall(request,'native-partner',false,true)).toEqual({request,worlds:40,partner:true,nello_counterexamples:true});
    expect(livePlayerCall(request,'native-partner',true,true)).toMatchObject({worlds:160,partner:false,nello_counterexamples:true});
    expect(livePlayerCall(request,'native-l1')).not.toHaveProperty('nello_counterexamples');
    expect(livePlayerCall({...request,seat:0},'native-l1',false,true)).not.toHaveProperty('nello_counterexamples');
    const {contract:_,...straight}=request;
    expect(livePlayerCall(straight,'native-l1',false,true)).not.toHaveProperty('nello_counterexamples');
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
  it('supports saved settings, explicit comparison links and legacy saves',()=>{
    const values=new Map<string,string>(); const storage={removeItem:(k:string)=>{values.delete(k);},getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
    const app=initialApp(null,'?nello=counterexamples'); expect(app.settings.nelloCounterexamples).toBe(true);
    saveApp(storage,app); const saved=loadApp(storage)!;
    expect(initialApp(saved).settings.nelloCounterexamples).toBe(true);
    expect(initialApp(saved,'?nello=ordinary').settings.nelloCounterexamples).toBe(false);
    expect(reducer(app,{type:'set-nello-counterexamples',enabled:false}).settings.nelloCounterexamples).toBe(false);
    expect(initialApp().settings.nelloCounterexamples).toBe(false);
  });
});

it('the imported browser player performs the pass and retains a completed round on interruption', async()=>{
  const { readFileSync } = await import('node:fs');
  const module = await WebAssembly.compile(readFileSync(new URL('../src/ai/phone/walt-player.wasm',import.meta.url)));
  function run(stopAfterRound=false) {
    let x: {memory:WebAssembly.Memory;walt_in_prepare(n:number):number;walt_call():number;walt_out_ptr():number};
    let ticks=0n, stop=false;
    const checkpoints: NativeDecision[]=[];
    const decoder=new TextDecoder();
    const instance=new WebAssembly.Instance(module,{walt_host:{now_us:()=>stop ? ticks+=3000000n : 0n,
      checkpoint:(ptr:number,len:number)=>{
        const value=JSON.parse(decoder.decode(new Uint8Array(x.memory.buffer,ptr,len))) as NativeDecision;
        checkpoints.push(value);
        if(stopAfterRound && value.counterexample_result?.rounds===1) stop=true;
      }}});
    x=instance.exports as unknown as typeof x;
    const call={request:{...request,plays:[0,3,1,23,3,12,1,11,3,25,0,13,3,27,0,9,1,2]},worlds:160,partner:false,nello_counterexamples:true,budget_ms:20000};
    const bytes=new TextEncoder().encode(JSON.stringify(call));const ptr=x.walt_in_prepare(bytes.length);
    new Uint8Array(x.memory.buffer,ptr,bytes.length).set(bytes);const len=x.walt_call();
    return {result:JSON.parse(decoder.decode(new Uint8Array(x.memory.buffer,x.walt_out_ptr(),len))) as NativeDecision,checkpoints};
  }
  const full=run(); expect(full.result.choice).toBe(16);
  expect(full.result.counterexample_result).toMatchObject({baseline:7,rounds:3,witnesses:12,status:'completed'});
  expect(full.result.evaluation?.outer_worlds).toBe(160);
  const stopped=run(true);const saved=stopped.checkpoints.find(c=>c.counterexample_result?.rounds===1)!;
  expect(stopped.result.counterexample_result).toMatchObject({rounds:1,witnesses:4,status:'completed',stop:'deadline'});
  expect(stopped.result.choice).toBe(saved.choice);
  expect(stopped.result.counterexample_result?.options).toEqual(saved.counterexample_result?.options);
},30000);
