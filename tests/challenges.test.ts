import { describe, expect, it } from 'vitest';
import { ALL_DOMINO_IDS, applyAction, fromId, isCalled, legalDominoes, mulberry32, rank, type GameState } from '../src/engine';
import { CHALLENGES, challengeAttempt, challengeReducer, challengeReply, startChallenge } from '../src/ui/challenge-hands';
import { initialApp, pendingAiSeat, reducer, toSaved } from '../src/ui/store';

describe('challenge hands', () => {
  it.each(CHALLENGES.map((c, i) => [c.title, i] as const))('%s has a forced winning strategy', (_, index) => {
    const game = startChallenge(index);
    expect(game.dealt.flat().sort()).toEqual([...ALL_DOMINO_IDS].sort());
    expect(game.turn).toBe(0);
    expect(game.contract).toEqual({ kind: 'marks', value: 1 });
    const rules = game.rules!;
    const trumps = game.hands.map(hand => hand.filter(id => isCalled(fromId(id), rules)));
    const ourRanks = trumps[0]!.map(id => rank(fromId(id), rules));
    const otherRanks = trumps.slice(1).flat().map(id => rank(fromId(id), rules));
    // Certificate: every trump we lead wins; enough rounds empty every other
    // hand of trump. All our remaining leads are suit-high doubles, so they win
    // too, against ANY legal replies (including our partner's).
    expect(Math.min(...ourRanks)).toBeGreaterThan(Math.max(...otherRanks));
    expect(Math.max(...trumps.slice(1).map(hand => hand.length))).toBeLessThanOrEqual(trumps[0]!.length);
    for (const id of game.hands[0]!.filter(id => !isCalled(fromId(id), rules))) {
      expect(fromId(id).high).toBe(fromId(id).low);
    }
    // Also exercise scoring and follow-suit with varied legal responses.
    for (let seed = 0; seed < 32; seed++) {
      const rand = mulberry32(seed);
      let played = game;
      while (played.phase === 'playing') {
        const legal = legalDominoes(played);
        const domino = played.turn === 0 ? legal[0]! : legal[Math.floor(rand() * legal.length)]!;
        played = applyAction(played, { type: 'play', domino });
      }
      expect(played.handResult?.made).toBe(true);
      expect(played.points).toEqual([42, 0]);
    }
  });

  it.each(CHALLENGES.map((c, i) => [c.title, i] as const))('%s rewards correct order and punishes a premature double', (_, index) => {
    let game = startChallenge(index);
    while (game.phase === 'playing') {
      game = game.turn === 0 ? applyAction(game, { type: 'play', domino: legalDominoes(game)[0]! }) : challengeReply(game);
    }
    expect(game.handResult?.made).toBe(true);
    let mistaken = applyAction(startChallenge(index), { type: 'play', domino: '55' });
    while (mistaken.phase === 'playing' && mistaken.turn !== 0) mistaken = challengeReply(mistaken);
    expect(mistaken.handResult?.made).toBe(false);
  });

  it('supports undo and identical retries, ignoring old taps and responses', () => {
    const initial = challengeAttempt(2);
    let state = challengeReducer(initial, { type: 'play', domino: '55', game: initial.game });
    const afterPlay = state;
    expect(challengeReducer(state, { type: 'play', domino: '66', game: initial.game })).toBe(state);
    while (state.game.phase === 'playing') state = challengeReducer(state, { type: 'reply', game: state.game });
    expect(state.hold).toBe(true);
    expect(state.game.handResult?.made).toBe(false);
    state = challengeReducer(state, { type: 'undo' });
    expect(state.game).toEqual(initial.game);
    expect(state.hold).toBe(false);
    expect(challengeReducer(state, { type: 'reply', game: afterPlay.game })).toBe(state);
    const restarted = challengeReducer(afterPlay, { type: 'restart', index: 2 });
    expect(restarted).toEqual(initial);
    expect(challengeReducer(restarted, { type: 'play', domino: '66', game: initial.game })).toBe(restarted);
  });

  it('does not overwrite or advance an existing match while practicing', () => {
    const match = reducer(initialApp(), { type: 'new-game', seed: 'saved-match' });
    const saved = toSaved(match);
    const practice = reducer(match, { type: 'go', screen: 'challenges' });
    expect(pendingAiSeat(practice)).toBeNull();
    let game: GameState = startChallenge(0);
    game = applyAction(game, { type: 'play', domino: '66' });
    challengeReply(game);
    expect(toSaved(practice)).toEqual(saved);
    const resumed = reducer(reducer(practice, { type: 'go', screen: 'home' }), { type: 'resume' });
    expect(resumed.game).toBe(match.game);
    expect(toSaved(resumed)).toEqual(saved);
  });
});
