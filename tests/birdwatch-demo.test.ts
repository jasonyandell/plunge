import { describe, expect, it } from 'vitest';
import { legalDominoes } from '../src/engine';
import { birdwatchDemoApp, opensBirdwatchDemo } from '../src/ui/birdwatch-demo';
import { reducer } from '../src/ui/store';

describe('birdwatch demonstration', () => {
  it('opens directly on this preview, without replacing regular games or shared links', () => {
    const preview = { hostname: 'plunge-pr-55.texas42.workers.dev', search: '', hash: '' };
    expect(opensBirdwatchDemo(preview)).toBe(true);
    expect(opensBirdwatchDemo({ ...preview, hostname: 'plunge.texas42.workers.dev' })).toBe(false);
    expect(opensBirdwatchDemo({ ...preview, hostname: 'plunge-pr-56.texas42.workers.dev' })).toBe(false);
    expect(opensBirdwatchDemo({ ...preview, search: '?rooms=1' })).toBe(false);
    expect(opensBirdwatchDemo({ ...preview, hash: '#r=shared-hand' })).toBe(false);
    expect(opensBirdwatchDemo({ hostname: 'localhost', search: '?demo=birdwatch', hash: '' })).toBe(true);
  });

  it('starts at a legal human play, accepts a tile and can recreate the untouched sample', () => {
    const sample = birdwatchDemoApp();
    const game = sample.game!;
    expect(game.phase).toBe('playing');
    expect(game.turn).toBe(0);
    expect(game.currentTrick).toHaveLength(0);
    expect(sample.room).toBeUndefined();
    const domino = legalDominoes(game)[0]!;
    const played = reducer(sample, { type: 'human', action: { type: 'play', domino } });
    expect(played.game!.currentTrick).toEqual([{ seat: 0, domino }]);
    expect(game.hands[0]).toHaveLength(7);
    expect(birdwatchDemoApp()).toEqual(sample);
  });
});
