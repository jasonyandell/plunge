/** A database-free PR preview build: questions never leave the device. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { decodeReplay } from '../src/engine/replay-code';

vi.mock('../src/questions/mode', async original => ({
  ...await original<typeof import('../src/questions/mode')>(), QUESTIONS_LOCAL_ONLY: true,
}));
const { delivery } = await import('../src/questions/mode');
const { editNote, getPublicQuestion, listQuestions, refreshQuestions, saveQuestion, syncQuestions } = await import('../src/questions/client');

const prefix='v1t366615143403021656463533231106250423320110060555452444122.P303132D922';
beforeAll(()=>{vi.stubGlobal('window',new EventTarget());});

describe('local-only questions',()=>{
  it('saves, edits and lists questions without any network request or false acknowledgement',async()=>{
    const network=vi.fn().mockResolvedValue(Response.json({revision:99,answer:null,items:[],next:null}));
    vi.stubGlobal('fetch',network);
    const changes=vi.fn();window.addEventListener('plunge-questions-changed',changes);
    const saved=await saveQuestion(decodeReplay(prefix)!,0,'local-only-test',null);
    await editNote(saved.question.id,'Kept here');
    await syncQuestions();await refreshQuestions();
    const local=(await listQuestions()).find(x=>x.question.id===saved.question.id)!;
    expect(local.question.note).toBe('Kept here');
    expect(local.revision).toBe(2);expect(local.syncedRevision).toBe(0);
    await expect(getPublicQuestion(saved.question.id)).rejects.toThrow(/this device only/);
    expect(network).not.toHaveBeenCalled();
    expect(changes).toHaveBeenCalled();
  });
  it('reports remote delivery honestly when uploads are enabled',()=>{
    expect(delivery({revision:2,syncedRevision:1},false)).toBe('waiting');
    expect(delivery({revision:2,syncedRevision:2},false)).toBe('sent');
    expect(delivery({revision:2,syncedRevision:2},true)).toBe('device-only');
  });
});
