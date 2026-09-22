import { describe, expect, it } from 'vitest';
import { fromId, legalActions } from '../src/engine';
import { DROPPED_HAND, droppedBidGame } from '../src/ui/drop-in';
import { HUMAN_SEAT, initialApp, reducer } from '../src/ui/store';

const pass = { type: 'bid', bid: { kind: 'pass' } } as const;
const thirty = { type: 'bid', bid: { kind: 'points', value: 30 } } as const;

describe('the dropped-in hand', () => {
  it('is the photographed hand, in your seat, with the bid forced on you', () => {
    const g = droppedBidGame();
    expect(g.hands[HUMAN_SEAT]).toEqual(DROPPED_HAND);
    expect(g.shaker).toBe(HUMAN_SEAT);
    expect(g.phase).toBe('bidding');
    expect(g.turn).toBe(HUMAN_SEAT);
    expect(g.bids).toHaveLength(3);
    expect(g.bids.every((b) => b.bid.kind === 'pass')).toBe(true);
    expect(legalActions(g)).not.toContainEqual(pass);
    expect(legalActions(g)).toContainEqual(thirty);
  });

  it('deals a full valid set, deterministically per seed', () => {
    const g = droppedBidGame('table-a');
    const seen = new Set(g.dealt.flat());
    expect(seen.size).toBe(28);
    for (const id of seen) expect(() => fromId(id)).not.toThrow();
    expect(droppedBidGame('table-a').dealt).toEqual(g.dealt);
    expect(droppedBidGame('table-b').dealt).not.toEqual(g.dealt);
    expect(droppedBidGame('table-b').hands[HUMAN_SEAT]).toEqual(DROPPED_HAND);
  });

  it('installs as a live game the player can bid in', () => {
    const app = reducer(initialApp(), {
      type: 'drop-in', game: droppedBidGame(), sessionId: 'drop-dropped',
    });
    expect(app.screen).toBe('table');
    expect(app.scenarioGame).toBeNull();
    const bid = reducer(app, { type: 'human', action: thirty });
    expect(bid.game!.declarer).toBe(HUMAN_SEAT);
    expect(bid.game!.forcedBid).toBe(true);
    expect(bid.game!.phase).toBe('declaring');
  });
});
