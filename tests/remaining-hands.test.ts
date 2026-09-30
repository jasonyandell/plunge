import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import type { DominoId, GameState } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { Domino } from '../src/ui/Domino';
import { RemainingHands } from '../src/ui/RemainingHands';
import { initialApp, toSaved } from '../src/ui/store';
import fixtures from './fixtures/nello.json';

function visibleTiles(node: unknown): DominoId[] {
  if (Array.isArray(node)) return node.flatMap(visibleTiles);
  if (!node || typeof node !== 'object') return [];
  const vnode = node as VNode<{ id?: DominoId; children?: unknown }>;
  if (vnode.type === Domino) return [vnode.props.id!];
  return visibleTiles(vnode.props?.children);
}

describe('remaining dominoes after play', () => {
  it('reveals exactly the unplayed tiles, including the sitting-out partner, after reload', () => {
    for (const fixture of fixtures) {
      const finished = decodeReplay(fixture.replay)!;
      const played = new Set(finished.tricks.flatMap(trick => trick.plays.map(play => play.domino)));
      const expected = finished.dealt.flatMap(hand => hand.filter(id => !played.has(id)));
      for (const phase of ['hand-over', 'game-over'] as const) {
        const g = initialApp(toSaved({ ...initialApp(), game: { ...finished, phase } })).game!;
        const tiles = visibleTiles(RemainingHands({ g }));
        expect(tiles).toEqual(expected);
        expect(tiles).toEqual(expect.arrayContaining([...g.dealt[g.sittingOut!]!]));
      }
    }
  });

  it('never reveals tiles during bidding, declaration, or play', () => {
    const finished = decodeReplay(fixtures[0]!.replay)!;
    for (const phase of ['bidding', 'declaring', 'playing'] as const) {
      const g: GameState = { ...finished, phase };
      expect(RemainingHands({ g })).toBeNull();
    }
    expect(RemainingHands({ g: { ...finished, tricks: [], thrownIn: true } })).toBeNull();
  });
});
