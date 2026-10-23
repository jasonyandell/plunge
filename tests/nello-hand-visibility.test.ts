import { expect, it } from 'vitest';
import { toChildArray, type VNode } from 'preact';
import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type GameState, type Seat } from '../src/engine';
import { rotateGame } from '../src/room/view';
import { Domino, dominoAriaLabel, type DominoProps } from '../src/ui/Domino';
import { OpponentSide, OpponentTop } from '../src/ui/Table';

function tiles(node: VNode): DominoProps[] {
  if (node.type === Domino) return [node.props as DominoProps];
  return toChildArray((node.props as { children?: VNode[] }).children)
    .flatMap(child => typeof child === 'object' && child !== null ? tiles(child as VNode) : []);
}

function checkViews(game: GameState) {
  for (const viewer of [0, 1, 2, 3] as Seat[]) {
    const g = rotateGame(game, viewer);
    for (const seat of [1, 2, 3] as Seat[]) {
      const node = seat === 2 ? OpponentTop({ g, thinking: null }) : OpponentSide({ g, seat, thinking: null });
      const hand = tiles(node);
      expect(hand).toHaveLength(g.hands[seat]!.length);
      hand.forEach((props, i) => {
        const face = Domino(props)!;
        // Watching a hand never grants a play button or exposes hidden pips to screen readers.
        expect(face.type).toBe('div');
        expect(face.props['aria-label']).toBe(viewer === game.sittingOut
          ? dominoAriaLabel(g.hands[seat]![i]!) : 'face-down domino');
        expect(props.faceDown).toBe(viewer !== game.sittingOut);
      });
    }
  }
}

it('reveals remaining Nel-O hands only to the sitting-out viewer, then hides the next deal', () => {
  let game = newGame(PLUNGE_CONFIG, 'nello-hand-visibility');
  checkViews(game);
  game = applyAction(game, { type: 'bid', bid: { kind: 'marks', value: 1 } });
  for (let n = 0; n < 3; n++) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
  const declaring = game;
  checkViews(declaring);
  game = applyAction(game, { type: 'declare', decl: { type: 'nello' } });
  expect(game.sittingOut).not.toBeNull();
  while (game.phase === 'playing') {
    checkViews(game);
    game = applyAction(game, legalActions(game)[0]!);
  }
  checkViews(game);
  checkViews(applyAction(game, { type: 'next-hand' }));
  // Undoing the declaration and choosing normal trump must also hide every other hand.
  checkViews(declaring);
  checkViews(applyAction(declaring, { type: 'declare', decl: { type: 'pip', pip: 3 } }));
});
