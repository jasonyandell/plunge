import { newGame, TOURNAMENT_CONFIG } from '../src/engine';
import { auctionRequest, checkedSurvey, type AuctionSurvey } from '../src/ai/auction';
import { runAuctionPool } from '../src/ai/phone/auction-pool';
import manifest from '../src/ai/phone/manifest.json';

interface Row { seed: number; survey: AuctionSurvey; checkpoints: AuctionSurvey[] }
const status=document.querySelector<HTMLPreElement>('#status')!;
const output=document.querySelector<HTMLTextAreaElement>('#results')!;
const run=document.querySelector<HTMLButtonElement>('#run')!;
const stop=document.querySelector<HTMLButtonElement>('#stop')!;
const input=(id:string)=>Number(document.querySelector<HTMLInputElement>('#'+id)!.value);
const create=()=>new Worker(new URL('../src/ai/phone/worker.ts',import.meta.url),{type:'module'});
let controller: AbortController | undefined;
stop.onclick=()=>controller?.abort();
function summary(rows:Row[]) {
  const rules = [[12,1,3],[12,1,2],[40,1,2],[40,3,5]] as const;
  return rules.map(([worlds,num,den])=>{
    const assessable=rows.filter(r=>r.survey.worlds>worlds && r.checkpoints.some(s=>s.worlds===worlds));
    const passes=assessable.filter(r=>r.checkpoints.find(s=>s.worlds===worlds)!.prices.every(([,n,d])=>BigInt(n)*BigInt(den)<=BigInt(d)*BigInt(num)));
    const missed=passes.filter(r=>r.survey.eligible);
    const saved=passes.reduce((sum,r)=>sum+(r.survey.elapsed_us-r.checkpoints.find(s=>s.worlds===worlds)!.elapsed_us),0)/1e6;
    return {screen_worlds:worlds,max_make:[num,den],assessable:assessable.length,early_passes:passes.length,
      missed_deeper_bids:missed.map(r=>r.seed),estimated_seconds_saved:saved};
  });
}
run.onclick=async()=>{
  const first=input('seed'),count=input('count'),workers=input('workers');
  if(!Number.isInteger(first)||first<0||!Number.isInteger(count)||count<1||count>1000||![1,2,3,4].includes(workers)) {status.textContent='Use a nonnegative seed, 1–1000 hands, and 1–4 workers.';return;}
  controller=new AbortController();run.disabled=true;stop.disabled=false;
  const rows:Row[]=[];
  const show=()=>{output.value=JSON.stringify({schema:'walt-auction-study-v1',wasm:manifest.wasm_sha256,workers,budget_ms:20000,
    userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,summary:summary(rows),rows},null,2);};
  try {
    for(let seed=first;seed<first+count;seed++) {
      status.textContent=`Hand ${seed-first+1}/${count} (seed ${seed})…`;
      const storageKey=`walt-auction-study-v1/${manifest.wasm_sha256}/${workers}/${seed}`;
      const prior=localStorage.getItem(storageKey);
      if(prior) {rows.push(JSON.parse(prior) as Row);show();continue;}
      const request=auctionRequest(newGame(TOURNAMENT_CONFIG,`auction-study/${seed}`),`auction-study/${seed}`);
      const checkpoints:AuctionSurvey[]=[];
      const result=await runAuctionPool(create,{auction:request,worlds:160,budget_ms:20000},controller.signal,workers,
        {onSurvey:s=>{if(s.worlds)checkpoints.push(checkedSurvey(request,s));}});
      const row={seed,survey:checkedSurvey(request,result),checkpoints};
      localStorage.setItem(storageKey,JSON.stringify(row));rows.push(row);show();
    }
    status.textContent=`Complete: ${rows.length} hands. See summaries and raw surveys below.`;
  } catch(e) {status.textContent=controller.signal.aborted?'Stopped. Completed seeds are saved; run again to resume.':`Stopped: ${String(e)}`;}
  finally {run.disabled=false;stop.disabled=true;controller=undefined;}
};
