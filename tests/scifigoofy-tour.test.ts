import { expect,it } from 'vitest';
import { applyAction,legalDominoes } from '../src/engine';
import { SHOWCASE_ID,opensShowcase,showcaseGame,showcaseLink,tourStep } from '../src/ui/scifigoofy-tour';

it('opens the combined tour directly while preserving room and shared-hand links',()=>{
  expect(opensShowcase({search:'?demo=scifigoofy',hash:''})).toBe(true);
  expect(opensShowcase({search:`?idea=${SHOWCASE_ID}`,hash:''})).toBe(true);
  expect(opensShowcase({search:'?demo=scifigoofy&rooms=1',hash:''})).toBe(false);
  expect(opensShowcase({search:'?demo=scifigoofy',hash:'#hand=existing'})).toBe(false);
  expect(opensShowcase({search:'?play=1',hash:''})).toBe(false);
});
it('shares only the public tour and valid step, with deterministic fallbacks',()=>{
  expect(showcaseLink('https://example.test',2)).toBe('https://example.test/?demo=scifigoofy&step=birdwatch');
  expect(showcaseLink('https://example.test/path?token=secret#invite=private')).toBe('https://example.test/?demo=scifigoofy');
  expect(tourStep('?step=birdwatch')).toBe(2);
  expect(tourStep('?step=unknown')).toBe(0);
});
it('starts a legal disposable human turn and never needs the saved game',()=>{
  const a=showcaseGame(),b=showcaseGame();
  expect(a.game).toEqual(b.game);
  expect(a.game?.phase).toBe('playing');expect(a.game?.turn).toBe(0);
  const action={type:'play' as const,domino:legalDominoes(a.game!)[0]!};
  const next=applyAction(a.game!,action);
  expect(next.currentTrick).toHaveLength(1);
  expect(b.game?.currentTrick).toHaveLength(0);
});
