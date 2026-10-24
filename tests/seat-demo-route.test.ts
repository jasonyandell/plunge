import { expect, it } from 'vitest';
import { seatDemoRoute } from '../src/room/seat-demo-route';

const preview = 'plunge-pr-87.texas42.workers.dev';

it('takes this preview straight to the demo without changing production or other previews', () => {
  expect(seatDemoRoute('', '', preview, true)).toBe(true);
  expect(seatDemoRoute('', '', preview, false)).toBe(false);
  expect(seatDemoRoute('', '', 'plunge-pr-88.texas42.workers.dev', true)).toBe(false);
  expect(seatDemoRoute('', '', 'plunge.texas42.workers.dev', false)).toBe(false);
  expect(seatDemoRoute('?demo=seats', '', 'localhost', false)).toBe(true);
});

it('preserves explicit destinations, game links, and the way out of the demo', () => {
  for (const search of ['?rooms=1', '?account=1', '?ideas=1', '?stats=1', '?play=1', '?demo=invite'])
    expect(seatDemoRoute(search, '', preview, true)).toBe(false);
  for (const hash of ['#room=' + 'a'.repeat(32), '#hand=saved-deal']) {
    expect(seatDemoRoute('', hash, preview, true)).toBe(false);
    expect(seatDemoRoute('?demo=seats', hash, preview, true)).toBe(false);
  }
});
