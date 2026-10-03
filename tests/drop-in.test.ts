import { describe, expect, it } from 'vitest';
import { fromId, legalActions } from '../src/engine';
import { DROPPED_HAND, droppedBidGame, parseDrop } from '../src/ui/drop-in';
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

  it('reads any hand from the link payload, share-code style', () => {
    expect(parseDrop(undefined)).toEqual({ hand: DROPPED_HAND, seed: 'dropped' });
    expect(parseDrop('')).toEqual({ hand: DROPPED_HAND, seed: 'dropped' });
    expect(parseDrop('table-b')).toEqual({ hand: DROPPED_HAND, seed: 'table-b' });
    const doubles = ['66', '55', '44', '33', '22', '11', '00'];
    expect(parseDrop('66554433221100')).toEqual({ hand: doubles, seed: 'dropped' });
    expect(parseDrop('66-55-44-33-22,11,00')).toEqual({ hand: doubles, seed: 'dropped' });
    expect(parseDrop('66554433221100.tbl2')).toEqual({ hand: doubles, seed: 'tbl2' });
    // Non-canonical pairs are the same domino either way up.
    expect(parseDrop('66165505342312')).toEqual({ hand: DROPPED_HAND, seed: 'dropped' });
    expect(parseDrop('61165550433221')).toBeNull(); // 6-1 twice, once upside down
    expect(parseDrop('66615550433227')).toBeNull(); // no 7 pip
    expect(parseDrop('666155504332')).toEqual({ hand: DROPPED_HAND, seed: '666155504332' }); // six dominoes: a seed
    expect(parseDrop('66554433221100.bad seed')).toBeNull();
    expect(parseDrop('!!')).toBeNull();
  });

  it('deals a linked hand to you and drops the bid the same way', () => {
    const g = droppedBidGame('tbl2', parseDrop('00-11-22-33-44-55-66')!.hand);
    expect(g.hands[HUMAN_SEAT]).toEqual(['66', '55', '44', '33', '22', '11', '00']);
    expect(g.turn).toBe(HUMAN_SEAT);
    expect(legalActions(g)).not.toContainEqual(pass);
    expect(new Set(g.dealt.flat()).size).toBe(28);
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
