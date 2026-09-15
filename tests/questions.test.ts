import { describe, expect, it, vi, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';
import { decodeReplay, encodeReplay } from '../src/engine/replay-code';
import { decodeHand, encodeHand } from '../src/ui/share';
import { type Question, validQuestion, validUpdate, publicQuestion } from '../src/questions/model';
import { insertQuestion, ownerToken, listQuestions, changeQuestion } from '../src/questions/storage';
import { type NativeReceipt } from '../src/ai/native';
import { attachGame, editNote, syncQuestions, saveQuestion } from '../src/questions/client';

const code='v1t366615143403021656463533231106250423320110060555452444122.P303132D9222132624440644255515350';
const prefix=code.slice(0,code.indexOf('D9')+4); // one opening play, 2-2
let sequence=0;
function question():Question {
  return {schema:'plunge-question-v1',id:(++sequence).toString(16).padStart(32,'0'),created:new Date().toISOString(),
    game_id:`test-${sequence}`,hand_number:1,ply:0,seed:2642199461,snapshot:prefix,replay:prefix,
    note:'Why this lead?',alternative:null,receipt_id:null,receipt:null,build:'test'};
}
beforeAll(()=>{vi.stubGlobal('window',new EventTarget());});
describe('question evidence',()=>{
  it('replays a partial trick and retains the finished-only portable contract',()=>{
    const g=decodeReplay(prefix)!;
    expect(g.currentTrick).toEqual([{seat:3,domino:'22'}]);
    expect(encodeReplay(g)).toBe(prefix);
    expect(decodeHand(prefix)).toBeNull();expect(encodeHand(g)).toBeNull();
    expect(decodeHand(code)?.points).toEqual([0,33]);
  });
  it('rejects illegal evidence and cannot replace the captured decision',()=>{
    const q=question();expect(validQuestion(q)).toEqual(q);
    expect(()=>validQuestion({...q,ply:1})).toThrow();
    expect(()=>validQuestion({...q,replay:prefix+'22'})).toThrow();
    expect(validUpdate(q,{...q,replay:code})).toBe(true);
    expect(validUpdate(q,{...q,snapshot:code,replay:code})).toBe(false);
    expect(validUpdate({...q,replay:code},q)).toBe(false);
  });
  it('preserves matching original scores and rejects another actor or malformed review',()=>{
    const q=question(),rid='e'.repeat(64);
    const receipt:NativeReceipt={schema:'plunge-decision-v1',id:rid,created:q.created,
      identity:{request:{decl:9,bid:32,bidder:3,seat:3,hand:[5,11,14,17,19,20,21],plays:[],seed:q.seed},
        player:{name:'l1-default'},implementation:{test:true},game_id:q.game_id,hand_number:1},
      response:{choice:5,legal:[5,11,14,17,19,20,21],route:'baseline',leader:3,points:[0,0],elapsed_us:100,
        phases:[{name:'baseline',status:'completed'}],evaluation:{outer_worlds:160,options:[[5,'77','80']]}}};
    const captured={...q,receipt_id:rid,receipt};expect(validQuestion(captured).receipt).toEqual(receipt);
    expect(()=>validQuestion({...captured,seed:1})).toThrow();
    expect(()=>validQuestion({...captured,receipt:{...receipt,response:{...receipt.response,phases:{}}}})).toThrow();
    expect(validUpdate(captured,{...captured,receipt:{...receipt,response:{...receipt.response,choice:20}}})).toBe(false);
  });
  it('withholds hidden hands, scores and answers from unfinished public links',()=>{
    const q=question(),answer={body:'An explanation',updated:new Date().toISOString()};
    const shown=publicQuestion(q,answer);
    expect(shown.domino).toBe('22');expect(shown.question).toBeNull();expect(shown.answer).toBeNull();
    expect(publicQuestion({...q,replay:code},answer).question?.snapshot).toBe(prefix);
  });
});
describe('durable anonymous notebook',()=>{
  it('keeps one browser key and deduplicates simultaneous taps without erasing notes',async()=>{
    const tokens=await Promise.all([ownerToken(),ownerToken()]);expect(tokens[0]).toMatch(/^[a-f0-9]{64}$/);expect(tokens[0]).toBe(tokens[1]);
    const q=question();const [a,b]=await Promise.all([insertQuestion(q),insertQuestion({...q,id:'f'.repeat(32),note:''})]);
    expect(a.question.id).toBe(b.question.id);expect(b.question.note).toBe('Why this lead?');
  });
  it('lets an explicit examiner save update a bookmarked note while repeat taps preserve it',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    const game=decodeReplay(prefix)!;
    const a=await saveQuestion(game,0,'review-note-test',null);
    const b=await saveQuestion(decodeReplay(code)!,0,'review-note-test',null,'Now I have a question');
    expect(b.question.id).toBe(a.question.id);expect(b.question.note).toBe('Now I have a question');
    expect(b.question.snapshot).toBe(prefix);expect(b.question.replay).toBe(code);
    const c=await saveQuestion(game,0,'review-note-test',null);
    expect(c.question.note).toBe(b.question.note);
    await syncQuestions();
  });
  it('keeps offline questions and later uploads the same id',async()=>{
    const q=question();await insertQuestion(q);
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    await syncQuestions();expect((await listQuestions()).find(x=>x.question.id===q.id)?.syncedRevision).toBe(0);
    const received:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      const data=JSON.parse(init.body);received.push(data.question.id);
      return Response.json({revision:data.revision,answer:null});
    }));
    await syncQuestions();expect(received).toContain(q.id);
    expect((await listQuestions()).find(x=>x.question.id===q.id)?.syncedRevision).toBe(1);
  });
  it('does not acknowledge a note edited while its previous version uploads',async()=>{
    const q=question();await insertQuestion(q);
    let release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    let started:()=>void=()=>{};const entered=new Promise<void>(resolve=>{started=resolve;});
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      const data=JSON.parse(init.body);
      if(data.question.id===q.id){started();await gate;}
      return Response.json({revision:data.revision,answer:null});
    }));
    const flight=syncQuestions();await entered;
    await editNote(q.id,'New note');release();await flight;
    const local=(await listQuestions()).find(x=>x.question.id===q.id)!;
    expect(local.question.note).toBe('New note');expect(local.revision).toBe(2);expect(local.syncedRevision).toBe(1);
    await syncQuestions();expect((await listQuestions()).find(x=>x.question.id===q.id)?.syncedRevision).toBe(2);
  });
  it('attaches the completed hand after reload using the preserved identity',async()=>{
    const q=question();await insertQuestion(q);
    await attachGame(decodeReplay(prefix)!,q.game_id);
    expect((await listQuestions()).find(x=>x.question.id===q.id)?.revision).toBe(1);
    await attachGame(decodeReplay(code)!,q.game_id);
    const saved=(await listQuestions()).find(x=>x.question.id===q.id)!;
    expect(saved.question.snapshot).toBe(prefix);expect(saved.question.replay).toBe(code);expect(saved.revision).toBe(2);
    await attachGame(decodeReplay(code)!,q.game_id);
    expect((await listQuestions()).find(x=>x.question.id===q.id)?.revision).toBe(2);
    // An old completion event must never roll back later evidence.
    await changeQuestion(q.id,old=>old);
  });
});
