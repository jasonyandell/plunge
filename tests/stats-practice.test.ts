import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type Seat } from '../src/engine';
import { handSteps } from '../src/engine/hand-history';
import { decodeReplay } from '../src/engine/replay-code';
import { actionKey, replayAt } from '../src/stats/replay';
import { acceptPracticeMove, handFinished, playPractice, practiceSave, recordedAction, restorePractice, similarDeal, startPractice } from '../src/stats/practice';
import { practiceStore } from '../src/stats/practice-storage';
import { readHands } from '../src/stats/model';
import { finishedHand, finishedRecord } from './hand-fixtures';
import nello from './fixtures/nello.json';
const start = (game:GameState,seat:Seat=0) => startPractice(game,{id:'attempt-1',created:'2026-10-18T00:00:00Z',seat,source:'source',kind:'same',seed:'stable'});
class MemoryStorage implements Storage {
  values = new Map<string,string>();
  get length(){return this.values.size;}
  clear(){this.values.clear();}
  key(i:number){return [...this.values.keys()][i]??null;}
  getItem(k:string){return this.values.get(k)??null;}
  setItem(k:string,v:string){this.values.set(k,v);}
  removeItem(k:string){this.values.delete(k);}
}
describe('play again at the table', () => {
  it('keeps every position and the outcome identical while following a saved path, including Nel-O', () => {
    for(const original of [finishedHand('same-path'),...nello.slice(0,2).map(f=>decodeReplay(f.replay)!)]) {
      const untouched=JSON.stringify(original);
      for(const seat of [0,1,2,3] as Seat[]) {
        let run=start(original,seat);
        for(const step of handSteps(original)) {
          expect(recordedAction(original,run)).toEqual(step.action);
          run=playPractice(original,run,step.action);
          expect(run.game).toEqual(replayAt(original,run.actions.length));
          expect(run.branchAt).toBeNull();
        }
        expect(run.game).toEqual(original); expect(handFinished(run.game)).toBe(true);
      }
      expect(JSON.stringify(original)).toBe(untouched);
    }
  });
  it('a different choice at trick four becomes a playable position and finishes on its own path', () => {
    let found=false;
    for(let seed=0;seed<50&&!found;seed++) {
      const original=finishedHand(`trick-four-${seed}`),before=JSON.stringify(original);
      let run=start(original);
      for(const step of handSteps(original)) {
        const other=legalActions(run.game).find(a=>actionKey(a)!==actionKey(step.action));
        if(run.game.phase==='playing'&&run.game.tricks.length===3&&other) {
          const prefix=run.actions.slice(),firstThree=run.game.tricks;
          run=playPractice(original,run,other);
          expect(run.branchAt).toBe(prefix.length); expect(run.actions.slice(0,prefix.length)).toEqual(prefix);
          expect(run.game.tricks.slice(0,3)).toEqual(firstThree);
          expect(recordedAction(original,run)).toBeNull();
          for(let n=0;n<40&&!handFinished(run.game);n++) run=playPractice(original,run,legalActions(run.game)[0]!);
          expect(handFinished(run.game)).toBe(true); expect(run.game.handResult).not.toBeNull();
          expect(run.actions[prefix.length]).toEqual(other); expect(JSON.stringify(original)).toBe(before);
          expect(restorePractice(original,'source',practiceSave(run))).toEqual(run);
          found=true;break;
        }
        run=playPractice(original,run,step.action);
      }
    }
    expect(found).toBe(true);
  });
  it('a different bid or declaration branches before any later source move is reused', () => {
    const original=finishedHand('changed-auction');
    for(const phase of ['bidding','declaring']) {
      let run=start(original);
      for(const step of handSteps(original)) {
        const alternative=legalActions(run.game).find(a=>actionKey(a)!==actionKey(step.action));
        if(run.game.phase===phase&&alternative) {
          run=playPractice(original,run,alternative);
          expect(recordedAction(original,run)).toBeNull();
          for(let n=0;n<40&&!handFinished(run.game);n++) run=playPractice(original,run,legalActions(run.game)[0]!);
          expect(handFinished(run.game)).toBe(true);break;
        }
        run=playPractice(original,run,step.action);
      }
      expect(run.branchAt).not.toBeNull();
    }
  });
  it('similar deals keep precisely the selected seven, redeal the other 21, and preserve table context', () => {
    const original={...finishedHand('redeal'),handNumber:9,marks:[4,3] as const},before=JSON.stringify(original);
    for(const seat of [0,1,2,3] as Seat[]) for(let i=0;i<12;i++) {
      const game=similarDeal(original,seat,`new-world-${i}`);
      expect(game.hands[seat]).toEqual(original.dealt[seat]);
      expect(game.hands.flat().sort()).toEqual(original.dealt.flat().sort());
      expect(new Set(game.hands.flat()).size).toBe(28);
      expect(game.dealt).not.toEqual(original.dealt);expect(game.hands.every(h=>h.length===7)).toBe(true);
      expect(game).toEqual(similarDeal(original,seat,`new-world-${i}`));
      expect(game.bids).toEqual([]);expect(game.tricks).toEqual([]);expect(game.shaker).toBe(original.shaker);
      expect(game.config).toEqual(original.config);expect(game.handNumber).toBe(9);
    }
    expect(JSON.stringify(original)).toBe(before);
  });
  it('late computer replies and duplicate taps cannot advance a restarted or already advanced hand', () => {
    const original=finishedHand('stale'),run=start(original),action=handSteps(original)[0]!.action;
    const next=acceptPracticeMove(original,run,{id:run.id,index:0},action);
    expect(next.actions).toHaveLength(1);
    expect(acceptPracticeMove(original,next,{id:run.id,index:0},action)).toBe(next);
    expect(acceptPracticeMove(original,run,{id:'abandoned-attempt',index:0},action)).toBe(run);
    expect(()=>playPractice(original,run,{type:'play',domino:'99'})).toThrow('not legal');
  });
  it('an unfinished recording continues beyond its last saved move', () => {
    const original=finishedHand('unfinished',true,8);
    let run=start(original);
    for(const step of handSteps(original))run=playPractice(original,run,step.action);
    expect(handFinished(run.game)).toBe(false);expect(recordedAction(original,run)).toBeNull();
    while(!handFinished(run.game))run=playPractice(original,run,legalActions(run.game)[0]!);
    expect(run.branchAt).toBe(handSteps(original).length);
  });
  it('restores source game scores and hand number instead of treating every saved deal as hand one', () => {
    const record={...finishedRecord('context'),handNumber:7,marksBefore:[5,4] as const,marksAfter:[6,4] as const};
    const hand=readHands([{id:'context',record,players:[]}]).hands[0]!;
    expect(hand.game.handNumber).toBe(7);expect(hand.game.marks).toEqual([6,4]);
    expect(start(hand.game).game.handNumber).toBe(7);
  });
  it('keeps complete practice paths separate, resumes them, and never changes the solo save or source stats', () => {
    const record=finishedRecord('saved-practice'),hand=readHands([{id:'saved',record,players:[]}]).hands[0]!,storage=new MemoryStorage();
    storage.setItem('plunge:save:v1','original solo save');const original=JSON.stringify(hand);
    const store=practiceStore(hand,0,false,storage);
    let first=startPractice(hand.game,{...practiceSave(start(hand.game)),source:record.code});
    first=playPractice(hand.game,first,legalActions(first.game).find(a=>actionKey(a)!==actionKey(recordedAction(hand.game,first)!))!);
    while(!handFinished(first.game)) first=playPractice(hand.game,first,legalActions(first.game)[0]!);
    store.save(first);
    const second=startPractice(hand.game,{...practiceSave(first),id:'attempt-2',created:'2026-10-18T00:01:00Z',kind:'similar',seed:'new'});store.save(second);
    expect(store.list()).toEqual([first,second]);expect(practiceStore(hand,0,true,storage).list()).toEqual([]);
    expect(practiceStore(hand,1,false,storage).list()).toEqual([]);
    expect(storage.getItem('plunge:save:v1')).toBe('original solo save');expect(JSON.stringify(hand)).toBe(original);
    expect(()=>store.save({...first,actions:[]})).toThrow('another tab');
    expect(()=>restorePractice(hand.game,'different source',practiceSave(first))).toThrow('cannot be opened');
  });
});
