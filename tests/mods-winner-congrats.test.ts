import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { newGame, TOURNAMENT_CONFIG, type GameState } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import type { GameOverSlotProps } from '../src/kernel/mod-api';
import { VictoryPicture } from '../src/mods/winner-congrats/VictoryPicture';

const visit = (search: string) => {
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods();
};
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });
const g: GameState = { ...newGame(TOURNAMENT_CONFIG, 'congrats'), phase: 'game-over', winner: 0 };
type Node = VNode<{ won: boolean }>;

describe('winner congrats', () => {
  it('adds nothing to the game-over card unless ?mods=winner-congrats', () => {
    visit('');
    expect(slotParts('gameover-header', modState().enabled)).toEqual([]);
  });
  it('heads the game-over card with the picture, for whichever team won', () => {
    visit('?mods=winner-congrats');
    const parts = slotParts('gameover-header', modState().enabled);
    expect(parts.map(p => p.id)).toEqual(['winner-congrats']);
    const Part = parts[0]!.Part as (p: GameOverSlotProps) => Node;
    for (const won of [true, false]) {
      const node = Part({ game: g, seat: 0, won });
      expect(node.type).toBe(VictoryPicture);
      expect(node.props.won).toBe(won);
    }
  });
  it('names the winning team to screen readers', () => {
    const label = (won: boolean) => (VictoryPicture({ won }) as VNode<{ 'aria-label': string; role: string }>).props;
    expect(label(true)).toMatchObject({ role: 'img', 'aria-label': expect.stringMatching(/^Congratulations to your team!/) });
    expect(label(false)['aria-label']).toMatch(/^Congratulations to the other team!/);
  });
});
