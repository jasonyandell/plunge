import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import type { DominoId, GameState } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { Domino } from '../src/ui/Domino';
import { StartingHands } from '../src/ui/StartingHands';
import { initialApp, toSaved } from '../src/ui/store';
import fixtures from './fixtures/nello.json';

function visibleTiles(node: unknown, status?: string): { id: DominoId; status: string | undefined }[] {
  if (Array.isArray(node)) return node.flatMap(child => visibleTiles(child, status));
  if (!node || typeof node !== 'object') return [];
  const vnode = node as VNode<{ id?: DominoId; children?: unknown; 'aria-label'?: string }>;
  const label = vnode.props?.['aria-label'];
  if (label === 'Played' || label === 'Still in hand') status = label;
  if (vnode.type === Domino) return [{ id: vnode.props.id!, status }];
  return visibleTiles(vnode.props?.children, status);
}

describe('starting hands after play', () => {
  it('shows the full deal after reload and labels held versus played tiles from the replay', () => {
    for (const fixture of fixtures) {
      const finished = decodeReplay(fixture.replay)!;
      const played = new Set(finished.tricks.flatMap(trick => trick.plays.map(play => play.domino)));
      const expected = finished.dealt.flatMap(hand => hand.map(id => ({
        id, status: played.has(id) ? 'Played' : 'Still in hand',
      })));
      for (const phase of ['hand-over', 'game-over'] as const) {
        const g = initialApp(toSaved({ ...initialApp(), game: { ...finished, phase } })).game!;
        const tiles = visibleTiles(StartingHands({ g }));
        expect(tiles).toHaveLength(28);
        expect(tiles).toEqual(expected);
        expect(tiles).toEqual(expect.arrayContaining(g.dealt[g.sittingOut!]!.map(id => ({ id, status: 'Still in hand' }))));
      }
    }
  });

  it('never reveals tiles during bidding, declaration, or play', () => {
    const finished = decodeReplay(fixtures[0]!.replay)!;
    for (const phase of ['bidding', 'declaring', 'playing'] as const) {
      const g: GameState = { ...finished, phase };
      expect(StartingHands({ g })).toBeNull();
    }
    expect(StartingHands({ g: { ...finished, tricks: [], thrownIn: true } })).toBeNull();
  });
});
