import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { ALL_DOMINO_IDS, buildRules, newGame, TOURNAMENT_CONFIG, type GameState } from '../src/engine';
import { counterSuits, DominoCounter } from '../src/mods/domino-counter/DominoCounter';

function text(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text((node as VNode<{ children?: unknown }>).props.children);
}

describe('public domino counter by suit', () => {
  const rules = buildRules({ type: 'pip', pip: 5 }, TOURNAMENT_CONFIG)!;

  it('puts trump first, removes trump from other suits, and includes both natural suits', () => {
    const groups = counterSuits(rules);
    expect(groups[0]).toEqual({ label: 'fives · Trump', ids: ['55', '65', '54', '53', '52', '51', '50'] });
    expect(groups.slice(1).flatMap(group => group.ids)).not.toContain('65');
    expect(groups.find(group => group.label === 'sixes')!.ids).toContain('64');
    expect(groups.find(group => group.label === 'fours')!.ids).toContain('64');
    expect(new Set(groups.flatMap(group => group.ids))).toEqual(new Set(ALL_DOMINO_IDS));
  });

  it('respects separate doubles and inverted Nel-O ranking without calling them trump', () => {
    const groups = counterSuits(buildRules({ type: 'nello' }, { ...TOURNAMENT_CONFIG, nelloDoubles: 'own-suit-inverted' }));
    expect(groups[0]).toEqual({ label: 'Doubles · Own suit', ids: ['00', '11', '22', '33', '44', '55', '66'] });
    expect(groups.slice(1).flatMap(group => group.ids)).not.toContain('66');
    const noTrump = counterSuits(buildRules({ type: 'no-trump' }, { ...TOURNAMENT_CONFIG, noTrumpDoubles: 'low' }));
    expect(noTrump.find(group => group.label === 'sixes')!.ids.at(-1)).toBe('66');
    expect(counterSuits(null)).toEqual([{ label: 'All dominoes', ids: ALL_DOMINO_IDS }]);
  });

  it('stays hidden throughout bidding and trump selection', () => {
    const g = newGame(TOURNAMENT_CONFIG, 'counter');
    expect(DominoCounter({ g })).toBeNull();
    expect(DominoCounter({ g: { ...g, phase: 'declaring' } })).toBeNull();
  });

  it('counts public plays once across suit rows and follows rollback without reading hands', () => {
    const g: GameState = {
      ...newGame(TOURNAMENT_CONFIG, 'counter'), phase: 'playing', rules,
      currentTrick: [{ seat: 0, domino: '64' }, { seat: 1, domino: '41' }],
    };
    const shown = text(DominoCounter({ g }));
    expect(shown).toContain('2 / 28 dominoes played15 / 35 count points played');
    expect(shown).toContain('sixes5 / 6 unplayed');
    expect(shown).toContain('fours4 / 6 unplayed');
    expect(text(DominoCounter({ g: { ...g, hands: [[], [], [], []], dealt: [[], [], [], []] } }))).toBe(shown);
    const completed: GameState = { ...g, currentTrick: [], tricks: [{
      plays: [...g.currentTrick, { seat: 2, domino: '66' }, { seat: 3, domino: '40' }], winner: 2, points: 16,
    }] };
    expect(text(DominoCounter({ g: completed }))).toContain('4 / 28 dominoes played15 / 35 count points played');
    expect(text(DominoCounter({ g: { ...g, currentTrick: g.currentTrick.slice(0, 1) } })))
      .toContain('1 / 28 dominoes played10 / 35 count points played');
    expect(text(DominoCounter({ g: { ...g, currentTrick: [] } })))
      .toContain('0 / 28 dominoes played0 / 35 count points played');
  });
});
