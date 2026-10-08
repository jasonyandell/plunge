import { describe, expect, it } from 'vitest';
import { ideaResult } from '../src/ideas/result';
import { previewFor, type IdeaThread } from '../src/ideas/model';

function fixture(): IdeaThread {
  return {
    card: { id:'idea', number:1, name:'Jason', title:'Prior hands', context:'Phone', created:'', updated:'',
      revision:2, status:'checking', pr:37, sha:'a'.repeat(40), preview:null },
    messages: [
      {id:'original',role:'family',name:'Jason',body:'Show prior hands.',created:''},
      {id:'followup',role:'family',name:'Jason',body:'Only this game.',created:''},
      {id:'progress',role:'builder',name:'Plunge builder',body:'Making the change.',created:''},
      {id:'result',role:'builder',name:'Plunge builder',body:'Prior hands now shows this game.',created:'',
        result:{revision:2,requestId:'followup'}},
    ],
  };
}

describe('preview updates attached to the builder reply', () => {
  it('changes the same reply from checking to ready and identifies the exact family request', () => {
    const thread=fixture(), message=thread.messages.at(-1)!;
    expect(ideaResult(thread,message)).toMatchObject({ready:false,request:{id:'followup'},detail:expect.stringContaining('checks are running')});
    thread.card={...thread.card,status:'ready',preview:previewFor(37)};
    expect(ideaResult(thread,message)).toMatchObject({ready:true,request:{body:'Only this game.'},detail:expect.stringContaining('Preview ready for this reply')});
    expect(ideaResult(thread,thread.messages[2]!)).toBeNull();
    expect(ideaResult(thread,thread.messages[1]!)).toBeNull();
  });

  it('never offers an old preview for a newer request or a replaced attempt of the same request', () => {
    const thread=fixture(), message=thread.messages.at(-1)!;
    thread.card={...thread.card,status:'ready',preview:previewFor(37),revision:3};
    expect(ideaResult(thread,message)).toMatchObject({ready:false,detail:expect.stringContaining('newer request')});
    thread.card={...thread.card,revision:2,status:'building'};
    expect(ideaResult(thread,message)?.ready).toBe(false);
    thread.messages.push({...message,id:'replacement'});
    thread.card.status='ready';
    expect(ideaResult(thread,message)).toBeNull();
    expect(ideaResult(thread,thread.messages.at(-1)!)?.ready).toBe(true);
  });

  it('requires the verified preview URL and explains failures and questions without a try button', () => {
    const thread=fixture(), message=thread.messages.at(-1)!;
    thread.card.status='ready';
    expect(ideaResult(thread,message)?.ready).toBe(false);
    thread.card.preview=previewFor(38);
    expect(ideaResult(thread,message)?.ready).toBe(false);
    thread.card.preview=previewFor(37);
    for(const status of ['checking','failed','question','closed','queued'] as const) {
      thread.card.status=status;
      expect(ideaResult(thread,message)?.ready).toBe(false);
    }
    thread.card.status='failed';
    expect(ideaResult(thread,message)?.detail).toContain('could not finish');
    thread.card.status='question';
    expect(ideaResult(thread,message)?.detail).toContain('did not create a new preview');
    thread.card.status='shipped';
    expect(ideaResult(thread,message)).toMatchObject({ready:false,shipped:true});
  });
});
