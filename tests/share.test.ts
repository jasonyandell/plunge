/**
 * Portable hand links (src/ui/share.ts): encode is a replay through the
 * real engine and refuses to emit anything it can't reproduce; decode is
 * the same replay, so a code round-trips to the identical hand — tricks,
 * points, contract, declaration, dealt hands — and corrupted codes yield
 * null instead of a broken table. Plus the store's view-only scenario mode.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type GameState,
  CASUAL_CONFIG,
  PLUNGE_CONFIG,
  applyAction,
  legalDominoes,
  mulberry32,
  newDealtGame,
  newGame,
  toSeed,
} from '../src/engine';
import { chooseAction } from '../src/ai';
import { currentHandFromHash, currentHandUrl, decodeHand, encodeHand } from '../src/ui/share';
import { rotateGame } from '../src/room/view';
import { initialApp, pendingAiSeat, reducer, toSaved } from '../src/ui/store';

/** Drive with medium to the end of the current hand. */
function finishHand(seed: string, skipHands = 0): GameState {
  let st = newGame(CASUAL_CONFIG, seed);
  const rand = mulberry32(toSeed(seed));
  let skipped = 0;
  for (let steps = 0; steps < 50_000; steps++) {
    if (st.phase === 'game-over') return st;
    if (st.phase === 'hand-over') {
      if (skipped >= skipHands) return st;
      skipped++;
      st = applyAction(st, { type: 'next-hand' });
      continue;
    }
    st = applyAction(st, chooseAction(st, st.turn!, 'medium', rand));
  }
  throw new Error('did not finish');
}

describe('share codec', () => {
  it('round-trips finished hands through the engine', () => {
    for (const [seed, skip] of [
      ['share-a', 0],
      ['share-b', 1],
      ['share-c', 2],
    ] as const) {
      const g = finishHand(seed, skip);
      const code = encodeHand(g);
      expect(code, seed).not.toBeNull();
      const back = decodeHand(code!);
      expect(back, seed).not.toBeNull();
      expect(back!.dealt).toEqual(g.dealt);
      expect(back!.tricks).toEqual(g.tricks);
      expect(back!.points).toEqual(g.points);
      expect(back!.contract).toEqual(g.contract);
      expect(back!.declaration).toEqual(g.declaration);
      expect(back!.declarer).toBe(g.declarer);
      expect(back!.shaker).toBe(g.shaker);
      expect(back!.bids).toEqual(g.bids);
      // Codes are compact enough to text somebody.
      expect(code!.length).toBeLessThan(200);
    }
  });

  it('refuses unfinished hands and garbage codes', () => {
    const mid = newGame(CASUAL_CONFIG, 'share-mid');
    expect(encodeHand(mid)).toBeNull();
    expect(decodeHand('')).toBeNull();
    expect(decodeHand('v1xnope')).toBeNull();
    const g = finishHand('share-a');
    const code = encodeHand(g)!;
    // Truncated mid-replay → not at hand end → null.
    expect(decodeHand(code.slice(0, code.length - 4))).toBeNull();
    // Corrupted deal (duplicate domino) → engine validation throws → null.
    expect(decodeHand(code.slice(0, 4) + code.slice(6, 8) + code.slice(6))).toBeNull();
  });

  it('newDealtGame validates the deal', () => {
    const g = finishHand('share-a');
    expect(() => newDealtGame(CASUAL_CONFIG, g.dealt, 0)).not.toThrow();
    const dup = g.dealt.map((h) => [...h]);
    dup[0]![0] = dup[1]![0]!;
    expect(() => newDealtGame(CASUAL_CONFIG, dup, 0)).toThrow();
    expect(() => newDealtGame(CASUAL_CONFIG, g.dealt.slice(0, 3), 0)).toThrow();
  });
});

describe('store: view-only scenario mode', () => {
  it('opens over the player game without touching it, and is view-only', () => {
    const shared = finishHand('share-b');
    let app = initialApp();
    app = reducer(app, { type: 'new-game', seed: 'mine' });
    const myGame = app.game;
    app = reducer(app, { type: 'view-scenario', game: shared });
    expect(app.screen).toBe('table');
    expect(app.scenarioGame).toBe(shared);
    expect(app.game).toBe(myGame); // untouched underneath
    // No AI stepping, no human actions, nothing persisted.
    expect(pendingAiSeat(app)).toBeNull();
    const afterTap = reducer(app, { type: 'human', action: { type: 'next-hand' } });
    expect(afterTap.game).toBe(myGame);
    expect(afterTap.scenarioGame).toBe(shared);
    expect(JSON.stringify(toSaved(app))).not.toContain('scenarioGame');
    // Going home closes the scenario; the player game resumes normally.
    app = reducer(app, { type: 'go', screen: 'home' });
    expect(app.scenarioGame).toBeNull();
    app = reducer(app, { type: 'resume' });
    expect(app.screen).toBe('table');
    expect(app.game).toBe(myGame);
  });
});

describe('current hand sharing', () => {
  afterEach(() => vi.unstubAllGlobals());
  const mockLocation = () => vi.stubGlobal('location', new URL('https://plunge.example/preview/?rooms=1#room=private'));

  it('round-trips bidding, trump selection, partial tricks and completed tricks from every seat', () => {
    mockLocation();
    let g = newGame(PLUNGE_CONFIG, 'snapshot');
    const positions = [g];
    g = applyAction(g, { type: 'bid', bid: { kind: 'points', value: 30 } });
    positions.push(g);
    for (let i = 0; i < 3; i++) g = applyAction(g, { type: 'bid', bid: { kind: 'pass' } });
    positions.push(g);
    g = applyAction(g, { type: 'declare', decl: { type: 'pip', pip: 6 } });
    positions.push(g);
    for (let i = 0; i < 5; i++) {
      g = applyAction(g, { type: 'play', domino: legalDominoes(g)[0]! });
      positions.push(g);
    }
    for (const position of positions) {
      for (const seat of [0, 1, 2, 3] as const) {
        const viewed = rotateGame(position, seat);
        const original = JSON.stringify(viewed);
        const url = new URL(currentHandUrl(viewed)!);
        expect(url.origin + url.pathname).toBe('https://plunge.example/preview/');
        expect(url.search).toBe('');
        const snapshot = currentHandFromHash(url.hash);
        expect(snapshot).not.toBeNull();
        for (const key of ['phase', 'turn', 'hands', 'dealt', 'bids', 'contract', 'declaration', 'tricks', 'currentTrick', 'points', 'sittingOut'] as const) {
          expect(snapshot![key], key).toEqual(viewed[key]);
        }
        expect(JSON.stringify(viewed)).toBe(original);
      }
    }
  });

  it('keeps finished hands on the established review link', () => {
    mockLocation();
    const g = finishHand('share-a');
    const url = new URL(currentHandUrl(g)!);
    expect(url.hash).toBe(`#r=${encodeHand(g)}`);
    expect(decodeHand(url.hash.slice(3))?.tricks).toEqual(g.tricks);
  });

  it('rejects malformed snapshot links and corrupt deals', () => {
    mockLocation();
    const hash = new URL(currentHandUrl(newGame(PLUNGE_CONFIG, 'snapshot'))!).hash;
    const code = hash.slice('#hand='.length);
    expect(currentHandFromHash(hash + '!')).toBeNull();
    expect(currentHandFromHash(hash + '00')).toBeNull();
    expect(currentHandFromHash('#hand=garbage')).toBeNull();
    expect(currentHandFromHash('#hand=' + 'v'.repeat(10000))).toBeNull();
    expect(currentHandFromHash(hash.replace('#hand=', '#room='))).toBeNull();
    expect(currentHandFromHash('#hand=' + code.slice(0, 4) + code.slice(6, 8) + code.slice(6))).toBeNull();
  });

  it('leaves the recipient’s ongoing game and save intact while viewing a partial hand', () => {
    mockLocation();
    const snapshot = currentHandFromHash(new URL(currentHandUrl(newGame(PLUNGE_CONFIG, 'sender'))!).hash)!;
    let app = { ...initialApp(), screen: 'table' as const, game: newGame(PLUNGE_CONFIG, 'recipient') } as ReturnType<typeof initialApp>;
    const saved = toSaved(app);
    const game = app.game;
    app = reducer(app, { type: 'view-scenario', game: snapshot });
    expect(pendingAiSeat(app)).toBeNull();
    expect(reducer(app, { type: 'human', action: { type: 'bid', bid: { kind: 'pass' } } })).toBe(app);
    expect(reducer(app, { type: 'ai', epoch: app.epoch })).toBe(app);
    expect(reducer(app, { type: 'undo', epoch: app.epoch })).toBe(app);
    expect(toSaved(app)).toEqual(saved);
    app = reducer(app, { type: 'go', screen: 'home' });
    app = reducer(app, { type: 'resume' });
    expect(app.scenarioGame).toBeNull();
    expect(app.game).toBe(game);
  });
});
