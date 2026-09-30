import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { applyAction, newGame, TOURNAMENT_CONFIG, PLUNGE_CONFIG, legalActions, mulberry32, type Seat, type Declaration } from '../src/engine';
import { requestOf, livePlayerCall, checkedAction, type NativeRequest, type NativeReceipt } from '../src/ai/native';
import { tileOfId, waltDeclarationOf } from '../src/ai/walt/requests';
import { decisionStats } from '../src/ai/decision-stats';
import { initialApp, reducer, toSaved } from '../src/ui/store';

let module: WebAssembly.Module;
beforeAll(async () => { module = await WebAssembly.compile(readFileSync(new URL('../src/ai/phone/walt-player.wasm', import.meta.url))); });
function decide(request: NativeRequest, samples = [2]) {
  let x: { memory: WebAssembly.Memory; walt_in_prepare(n:number):number; walt_call():number; walt_out_ptr():number };
  const instance = new WebAssembly.Instance(module, { walt_host: {
    now_us: () => BigInt(Math.floor(performance.now()*1000)), checkpoint: () => {},
  } });
  x = instance.exports as unknown as typeof x;
  const input = new TextEncoder().encode(JSON.stringify({request, worlds:samples[samples.length-1],profile:samples,partner:false,budget_ms:20000}));
  const ptr=x.walt_in_prepare(input.length);new Uint8Array(x.memory.buffer,ptr,input.length).set(input);
  const n=x.walt_call();
  const response=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,x.walt_out_ptr(),n))) as import('../src/ai/native').NativeDecision & {error?:string};
  if(response.error)throw new Error(response.error);return response;
}
function opening(seed: string, bidder: Seat, bid: number, decl: Declaration) {
  let g = newGame(decl.type==='nello' ? PLUNGE_CONFIG : TOURNAMENT_CONFIG, seed);
  g = { ...g, shaker: ((bidder + 3) % 4) as Seat, turn: bidder };
  g = applyAction(g, { type: 'bid', bid: bid === 42 || decl.type==='nello' ? { kind: 'marks', value: 1 } : { kind: 'points', value: bid } });
  for (let i = 0; i < 3; i++) g = applyAction(g, { type: 'bid', bid: { kind: 'pass' } });
  return applyAction(g, { type: 'declare', decl });
}
describe('portable Walt in the actual WASM artifact', () => {
  it('agrees with the independent table engine for all declarations, bidder seats and target extremes', () => {
    const rand = mulberry32(123);
    let positions = 0;
    for (const decl of [0,1,2,3,4,5,6,7,8,9]) for (const bidder of [0,1,2,3] as Seat[]) for (const bid of [30,42]) {
      let g = opening(`portable/${decl}/${bidder}/${bid}`, bidder, bid, decl===8 ? {type:'nello'} : waltDeclarationOf(decl)!);
      while (g.phase === 'playing') {
        const request = requestOf(g, g.turn!, 'portable-rules');
        const response = decide(request);
        const legal = legalActions(g).flatMap(a => a.type === 'play' ? [tileOfId(a.domino)] : []).sort((a,b) => a-b);
        expect(response.legal).toEqual(legal);
        expect(response.leader).toBe(g.leader);
        expect(response.points).toEqual(g.points);
        expect(legal).toContain(response.choice);
        // Explore histories independent of the player, including voids and sloughs.
        const actions = legalActions(g); g = applyAction(g, actions[Math.floor(rand()*actions.length)]!); positions++;
      }
    }
    console.log(`Cross-engine rules: ${positions} positions across 80 hands`);
    expect(positions).toBeGreaterThan(72 * 4);
  }, 60000);

  it('uses one Rust player for both levels and contracts, and records the completed profile', () => {
    const g = opening('profile', 0, 30, { type:'pip', pip:3 });
    const request = requestOf(g, 0, 'profile');
    expect(livePlayerCall(request, 'native-partner')).toMatchObject({ worlds:160, profile:[24,160], budget_ms:20000 });
    expect(livePlayerCall(request, 'native-l1')).toMatchObject({ worlds:160, profile:[160] });
    const nello = { ...request, contract:'nello' as const, decl:8, bid:1 };
    expect(livePlayerCall(nello, 'native-partner')).toMatchObject({ profile:[24,160] });
    const response = decide(request, [24,160]);
    expect(response.player_version).toBe('walt-table-v3');
    expect(response.profile).toEqual({delta:1, level:2, samples:[24,160]});
    const stats = decisionStats(response, request, response.legal)!;
    expect(stats.options.find(a=>a.tile===response.choice)?.best).toBe(true);
    const receipt: NativeReceipt = { schema:'plunge-decision-v1', id:'test', created:'test', identity:{request, player:{name:'walt-l2'}, implementation:{},game_id:'profile',hand_number:g.handNumber}, response };
    expect(checkedAction(g, request, receipt)).toMatchObject({type:'play'});
    const interrupted = {...response, profile:{delta:1,level:1,samples:[160]}, interruption:'L2 deadline'};
    expect(decisionStats(interrupted, request, response.legal)?.fallback).toBe(true);
    expect(initialApp().settings.difficulty).toBe('native-partner');
    expect(initialApp(toSaved(initialApp())).settings.difficulty).toBe('native-partner');
    expect(reducer(initialApp(),{type:'set-difficulty',difficulty:'native-l1'}).settings.difficulty).toBe('native-l1');
  }, 30000);

  it('times complete L2 hands and records timeouts separately', () => {
    const rows=[];
    for(let seed=1;seed<=3;seed++) {
      let g=opening(`portable-benchmark-${seed}`,1,30,{type:'pip',pip:seed as 1|2|3});
      const started=performance.now();let moves=0;
      while(g.phase==='playing') {
        const req=requestOf(g,g.turn!,`benchmark-${seed}`);
        const response=decide(req,[24,160]);
        const action=legalActions(g).find(a=>a.type==='play'&&tileOfId(a.domino)===response.choice)!;
        g=applyAction(g,action);moves++;
        if(performance.now()-started>30000)break;
      }
      rows.push({seed,seconds:(performance.now()-started)/1000,moves,status:g.phase==='playing'?'timeout':'complete'});
    }
    if(process.env.PORTABLE_BENCH_OUTPUT)writeFileSync(process.env.PORTABLE_BENCH_OUTPUT,JSON.stringify({engine:'WASM in Node',samples:[24,160],rows},null,2)+'\n');
    console.log('Portable L2 timing',rows);
    expect(rows.every(r=>r.status==='complete')).toBe(true);
  }, 100000);
});
