import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyAction, legalActions, newGame, TOURNAMENT_CONFIG, type GameState } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import type { DecorSlotProps, TableUi } from '../src/kernel/mod-api';
import { dealKey, firstSeen, Flourish, startsFlourish } from '../src/mods/shuffle-flourish/Shuffle';

const visit = (search: string) => {
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods();
};
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });
const calm: TableUi = { menuOpen: false, historyOpen: false, sheetOpen: false, showingLast: false, review: false, scenario: false, proposal: false };
const at = (game: GameState, ui: Partial<TableUi> = {}): DecorSlotProps => ({ game, seat: 0, ui: { ...calm, ...ui } });
/** Plays first legal actions until the next hand is dealt. */
function nextHand(g: GameState): GameState {
  const hand = g.handNumber;
  for (let i = 0; i < 200 && (g.handNumber === hand || g.phase !== 'bidding'); i++) g = applyAction(g, legalActions(g)[0]!);
  return g;
}

describe('shuffle flourish', () => {
  const g = newGame(TOURNAMENT_CONFIG, 'shuffle');
  it('adds nothing to the table unless ?mods=shuffle-flourish', () => {
    visit('');
    expect(slotParts('table-decor', modState().enabled)).toEqual([]);
    visit('?mods=shuffle-flourish');
    const parts = slotParts('table-decor', modState().enabled);
    expect(parts.map(p => p.id)).toEqual(['shuffle-flourish']);
    const node = (parts[0]!.Part as (p: DecorSlotProps) => { type: unknown; props: DecorSlotProps })(at(g));
    expect(node.type).toBe(Flourish);
    expect(node.props.game).toBe(g);
  });
  it('starts on a deal the table has not seen, including the one it opens on before anyone bids', () => {
    expect(g.phase).toBe('bidding');
    expect(startsFlourish(firstSeen(g), at(g))).toBe(true);
    const next = nextHand(g);
    expect(next.handNumber).toBe(g.handNumber + 1);
    expect(dealKey(next)).not.toBe(dealKey(g));
    expect(startsFlourish(dealKey(g), at(next))).toBe(true);
  });
  it('does not replay for the same deal: after a bid, an undo, or opening mid-auction', () => {
    const bid = applyAction(g, legalActions(g)[0]!);
    expect(bid.bids.length).toBe(1);
    expect(startsFlourish(dealKey(g), at(bid))).toBe(false);
    expect(startsFlourish(dealKey(bid), at(g))).toBe(false);
    expect(startsFlourish(firstSeen(bid), at(bid))).toBe(false);
  });
  it('holds still outside bidding, in review and on a shared hand from a link', () => {
    expect(startsFlourish(null, at({ ...g, phase: 'playing' }))).toBe(false);
    expect(startsFlourish(null, at(g, { review: true }))).toBe(false);
    expect(startsFlourish(null, at(g, { scenario: true }))).toBe(false);
  });
  it('only animates when motion is welcome', () => {
    const css = readFileSync(resolve(__dirname, '../src/mods/shuffle-flourish/shuffle.css'), 'utf8');
    const still = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/, '');
    expect(still).not.toBe(css);
    expect(still).not.toMatch(/animation:/);
  });
});
