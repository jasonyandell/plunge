import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { newGame, TOURNAMENT_CONFIG, type DominoId, type GameState } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import { store } from '../src/kernel/mod-api';
import { Domino, type DominoProps } from '../src/ui/Domino';
import { DragHand, Tiles, type TilesProps } from '../src/mods/drag-arrange/DragHand';
import { arranged, dealKey, loadOrder, moved, nearest, saveOrder } from '../src/mods/drag-arrange/order';

function memory(): Storage {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, clear: () => map.clear(), key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); } };
}
const visit = (search: string) => { vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', memory()); reloadMods(); };
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

const g: GameState = { ...newGame(TOURNAMENT_CONFIG, 'drag-arrange'), phase: 'playing' };
const hand = g.hands[0]!;
const [a, b, c, d] = hand as [DominoId, DominoId, DominoId, DominoId];

describe('drag-arrange', () => {
  it('is off by default and owns the hand with ?mods=drag-arrange', () => {
    visit('');
    expect(slotParts('hand', modState().enabled)).toEqual([]);
    visit('?mods=drag-arrange');
    expect(slotParts('hand', modState().enabled).map(p => p.id)).toEqual(['drag-arrange']);
    expect(slotParts('hand', modState().enabled)[0]!.Part).toBe(DragHand);
  });

  it('moves a tile to where it is dropped, keeping the rest in order', () => {
    expect(moved([], hand, a, 2).slice(0, 4)).toEqual([b, c, a, d]);
    expect(moved([], hand, c, 0).slice(0, 4)).toEqual([c, a, b, d]);
    expect(arranged(hand, moved([], hand, a, 0))).toEqual([...hand]);
    expect(arranged(hand, moved([], hand, a, 99))).toEqual([...hand]);
    expect(arranged(hand, [d, c])).toEqual([d, c, ...hand.filter(id => id !== c && id !== d)]);
  });

  it('keeps a played tile in its place, so an undo brings it back where it was', () => {
    const order = moved([], hand, d, 0);
    const played = hand.filter(id => id !== c);
    const next = moved(order, played, a, 0);
    expect(arranged(played, next).slice(0, 2)).toEqual([a, d]);
    expect(arranged(hand, next).indexOf(c)).toBe(order.indexOf(c));
  });

  it('drops on the nearest slot', () => {
    const slots = [0, 1, 2].map(i => ({ left: i * 100, top: 0, width: 90, height: 45 }));
    expect(nearest(slots, 250, 20)).toBe(2);
    expect(nearest(slots, -40, 10)).toBe(0);
  });

  it('remembers the order for this deal only', () => {
    visit('');
    const s = store('drag-arrange'), deal = dealKey(g, 0);
    expect(saveOrder(s, deal, [c, a])).toBe(true);
    expect(loadOrder(s, deal)).toEqual([c, a]);
    expect(loadOrder(s, dealKey({ ...g, handNumber: g.handNumber + 1 }, 0))).toEqual([]);
    expect(loadOrder(s, dealKey(newGame(TOURNAMENT_CONFIG, 'another deal'), 0))).toEqual([]);
  });

  describe('tiles', () => {
    const played: DominoId[] = [];
    const props = (over: Partial<TilesProps> = {}): TilesProps => ({ tiles: hand, drag: null, legal: new Set([b]), humanTurn: true,
      showHints: true, onTap: id => played.push(id), onDown: () => {}, onKey: () => {}, ...over });
    const faces = (p: TilesProps) => ((Tiles(p) as VNode<{ children: VNode[] }>).props.children)
      .map(tile => Domino(((tile.props as { children: VNode }).children.props) as DominoProps) as VNode);

    it('are playable buttons exactly when core would make them so, and a tap plays', () => {
      expect(faces(props()).map(v => v.type)).toEqual(hand.map(id => id === b ? 'button' : 'div'));
      expect(faces(props({ showHints: false })).every(v => v.type === 'button')).toBe(true);
      expect(faces(props({ humanTurn: false })).every(v => v.type === 'div')).toBe(true);
      (faces(props())[hand.indexOf(b)]!.props as unknown as { onClick: () => void }).onClick();
      expect(played).toEqual([b]);
    });

    it('carry the lifted tile under the finger while the rest make room', () => {
      const slots = hand.map((_, i) => ({ left: i * 100, top: 0, width: 90, height: 45 }) as DOMRect);
      const tiles = arranged(hand, moved([], hand, a, 2));
      const node = Tiles(props({ tiles, drag: { id: a, from: 0, target: 2, dx: 210, dy: -5, slots } })) as VNode<{ children: VNode<{ style?: { transform: string }; class: string }>[] }>;
      const lifted = node.props.children[2]!;
      expect(lifted.key).toBe(a);
      expect(lifted.props.class).toContain('drag-arrange-lifted');
      expect(lifted.props.style?.transform).toBe('translate(10px, -5px)');
      expect(node.props.children[0]!.props.style).toBeUndefined();
    });
  });
});
