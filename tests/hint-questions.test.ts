import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { writeFileSync } from 'node:fs';
import { BID_BOOK } from '../src/ai/bid-book';
import { initialApp, toSaved } from '../src/ui/store';
import { applyAction, legalActions, legalDominoes, newDealtGame, newGame, PLUNGE_CONFIG } from '../src/engine';
import { decodeReplay, encodeReplay } from '../src/engine/replay-code';
import { allPlays, ownerQuestion, publicQuestion, validQuestion, validUpdate } from '../src/questions/model';
import { questionTarget, listQuestions } from '../src/questions/storage';
import { saveHintQuestion, saveQuestion, attachGame, editNote, syncQuestions } from '../src/questions/client';
import { idOfTile } from '../src/ai/walt/requests';
import { auctionFixture, bookEvidence, finish, hintQuestion, moveEvidence, moveFixture, session } from './hint-question-fixtures';

beforeAll(() => { vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))); });
describe('hint questions preserve pre-action advice', () => {
  it('roundtrips auction, declaration and unplayed move positions without inventing an action', () => {
    for (const g of [auctionFixture(), auctionFixture(true), moveFixture()]) {
      const replay = encodeReplay(g)!; expect(replay).toBeTruthy();
      const decoded = decodeReplay(replay)!;
      expect(decoded.phase).toBe(g.phase); expect(decoded.turn).toBe(0); expect(allPlays(decoded)).toEqual([]);
      const q = hintQuestion(g, g.phase === 'playing' ? moveEvidence(g) : bookEvidence(g));
      expect(validQuestion(q)).toEqual(q);
    }
  });
  it('rejects scores for a different hand, seed or action and malformed book evidence', () => {
    const q = hintQuestion();
    expect(() => validQuestion({ ...q, seed: q.seed + 1 })).toThrow(/another decision/);
    expect(() => validQuestion({ ...q, ply: 1 })).toThrow(/capture/);
    const move = moveEvidence();
    expect(() => validQuestion({ ...q, hint: { ...move, choice: 99 } })).toThrow();
    const stale = structuredClone(move); stale.estimate!.identity.request.hand[0] = 99;
    expect(() => validQuestion({ ...q, hint: stale })).toThrow(/another decision/);
    const wrongChoice = structuredClone(move); wrongChoice.estimate!.response.choice = 99;
    expect(() => validQuestion({ ...q, hint: wrongChoice })).toThrow();
    const badPhase = { ...move, estimate: { ...move.estimate!, response: { ...move.estimate!.response, phases: {} } } };
    expect(() => validQuestion({ ...q, hint: badPhase })).toThrow();
    const b = hintQuestion(auctionFixture(), bookEvidence());
    expect(() => validQuestion({ ...b, hint: { ...bookEvidence(), explored_target: 99 } })).toThrow();
    const bad = structuredClone(bookEvidence()); if (bad.kind === 'move') throw new Error();
    bad.advice.panels[0]!.tails[1] = 99999;
    expect(() => validQuestion({ ...b, hint: bad })).toThrow(/counts/);
    expect(validUpdate(q, b)).toBe(false);
  });
  it('keeps suggestions distinct from actual plays and 40/deeper captures separate', async () => {
    const g = moveFixture(), before = structuredClone(g), evidence = moveEvidence(g);
    const first = await saveHintQuestion(g, session, evidence);
    await editNote(first.question.id, 'I would keep that count.');
    const repeat = await saveHintQuestion(g, session, evidence);
    expect(repeat.question.id).toBe(first.question.id); expect(repeat.question.note).toContain('keep that count');
    const deeper = await saveHintQuestion(g, session, moveEvidence(g,500));
    expect(deeper.question.id).not.toBe(first.question.id);
    const legacy=await saveHintQuestion(g,session,moveEvidence(g,160));
    expect(legacy.question.id).not.toBe(deeper.question.id);
    expect(legacy.question.id).not.toBe(first.question.id);
    const played = applyAction(g, { type: 'play', domino: idOfTile(evidence.choice) });
    const actual = await saveQuestion(played, 0, session, null);
    expect(questionTarget(actual.question)).not.toBe(questionTarget(first.question));
    expect(g).toEqual(before);
    await syncQuestions();
    expect((await listQuestions()).find(q => q.question.id === first.question.id)?.syncedRevision).toBe(0);
  });
  it('attaches the real continuation even when the player ignores the suggestion', async () => {
    const g = moveFixture(), evidence = moveEvidence(g), gameId = 'different-action';
    const first = await saveHintQuestion(g, gameId, evidence);
    const different = legalDominoes(g).find(d => d !== idOfTile(evidence.choice))!;
    const complete = finish(applyAction(g, { type: 'play', domino: different }));
    await attachGame(complete, gameId);
    const saved = (await listQuestions()).find(q => q.question.id === first.question.id)!.question;
    expect(saved.hint).toEqual(first.question.hint); expect(saved.snapshot).toBe(encodeReplay(g));
    expect(allPlays(decodeReplay(saved.replay)!)[0]!.domino).toBe(different);
    expect(validQuestion(saved)).toEqual(saved);
    expect(validUpdate(first.question,saved)).toBe(true);
    if (saved.schema !== 'plunge-question-v2') throw new Error();
    expect(validUpdate(saved,{...saved,hint_id:'8'.repeat(64)})).toBe(false);
    expect(validUpdate(saved,hintQuestion())).toBe(false);
  });
  it('allows owner inspection now and redacts even the suggested domino from unfinished public links', () => {
    const q = hintQuestion(), answer = { body: 'Private explanation', updated: q.created };
    const shared = publicQuestion(q, answer);
    expect(shared.kind).toBe('move'); expect(shared.domino).toBeNull(); expect(shared.question).toBeNull(); expect(shared.answer).toBeNull();
    expect(ownerQuestion(q, answer).question).toEqual(q);
    expect(ownerQuestion(q, answer).answer).toBeNull();
    const complete = { ...q, replay: encodeReplay(finish(moveFixture()))! };
    expect(publicQuestion(complete,answer).question?.hint).toEqual(q.hint);
    expect(publicQuestion(complete,answer).answer).toEqual(answer);
    for (const g of [auctionFixture(), auctionFixture(true)]) {
      const book = hintQuestion(g, bookEvidence(g));
      expect(publicQuestion(book,answer).question).toBeNull();
      expect(ownerQuestion(book,answer).question?.hint).toEqual(book.hint);
      expect(publicQuestion({...book,replay:encodeReplay(finish(g))!},answer).question?.hint).toEqual(book.hint);
    }
  });
  it('keeps complete hint evidence immutable while permitting notes and completion', () => {
    const g = auctionFixture(), q = hintQuestion(g,bookEvidence(g));
    const changed = structuredClone(q); if (changed.hint?.kind !== 'bid') throw new Error();
    changed.hint.advice.panels[0]!.tails[0] = changed.hint.advice.panels[0]!.tails[0]! - 1;
    expect(validUpdate(q,changed)).toBe(false);
    expect(validUpdate(q,{...q,note:'Added note'})).toBe(true);
    expect(validUpdate(q,{...q,replay:encodeReplay(finish(g))!})).toBe(true);
  });
});

// Optional real table states for browser checks; no generated data enters the repository.
afterAll(() => {
  if (!process.env.HINT_NOTEBOOK_FIXTURES) return;
  let move = moveFixture();
  for (const seed of BID_BOOK.seeds) {
    let g = newDealtGame(PLUNGE_CONFIG,newGame(PLUNGE_CONFIG,seed).dealt,0);
    g = applyAction(g,{type:'bid',bid:{kind:'points',value:30}});
    for(let i=0;i<3;i++)g=applyAction(g,{type:'bid',bid:{kind:'pass'}});
    g=applyAction(g,{type:'declare',decl:{type:'pip',pip:5}});
    for(let i=0;i<3;i++)g=applyAction(g,legalActions(g)[0]!);
    if(legalDominoes(g).length>1){move=g;break;}
  }
  const fixtures=Object.fromEntries(Object.entries({move,bid:auctionFixture(),trump:auctionFixture(true)}).map(([kind,game])=>[
    kind,{save:toSaved({...initialApp(),game,sessionId:`hint-notebook-${kind}`}),complete:finish(game)},
  ]));
  writeFileSync(process.env.HINT_NOTEBOOK_FIXTURES,JSON.stringify(fixtures));
});
