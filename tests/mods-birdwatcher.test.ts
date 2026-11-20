import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, legalActions, newGame, TOURNAMENT_CONFIG, type GameState } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import type { DecorSlotProps, TableUi } from '../src/kernel/mod-api';
import { Birdwatch, PAUSE_MS, pauseKey, pauseTimer } from '../src/mods/birdwatcher/Birdwatch';

const visit = (search: string) => {
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods();
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); reloadMods(); });
const calm: TableUi = { menuOpen: false, historyOpen: false, sheetOpen: false, showingLast: false, review: false, scenario: false, proposal: false };
const at = (game: GameState, ui: Partial<TableUi> = {}): DecorSlotProps => ({ game, seat: 0, ui: { ...calm, ...ui } });
function playing(): GameState {
  let g = newGame(TOURNAMENT_CONFIG, 'birds');
  while (g.phase !== 'playing') {
    const acts = legalActions(g);
    g = applyAction(g, acts.find(a => !(a.type === 'bid' && a.bid.kind === 'pass')) ?? acts[0]!);
  }
  return g;
}
type Node = { key: unknown } | null;

describe('birdwatcher', () => {
  const g = playing();
  it('adds nothing to the table unless ?mods=birdwatcher', () => {
    visit('');
    expect(slotParts('table-decor', modState().enabled)).toEqual([]);
    visit('?mods=birdwatcher');
    const parts = slotParts('table-decor', modState().enabled);
    expect(parts.map(p => p.id)).toEqual(['birdwatcher']);
    expect((parts[0]!.Part as (p: DecorSlotProps) => { type: unknown })(at(g)).type).toBe(Birdwatch);
  });
  it('waits only during play with nothing else on screen', () => {
    expect((Birdwatch(at(g)) as Node)?.key).toBe(pauseKey(g));
    expect(Birdwatch(at({ ...g, phase: 'bidding' }))).toBeNull();
    for (const flag of Object.keys(calm) as (keyof TableUi)[]) expect(Birdwatch(at(g, { [flag]: true })), flag).toBeNull();
  });
  it('starts a fresh pause with every play, every hand and every game', () => {
    const keys = new Set<string>();
    let h = g;
    for (let i = 0; i < 28 && h.phase === 'playing'; i++) { keys.add(pauseKey(h)); h = applyAction(h, legalActions(h)[0]!); }
    expect(keys.size).toBeGreaterThan(4);
    expect(pauseKey({ ...g, handNumber: g.handNumber + 1 })).not.toBe(pauseKey(g));
    expect(pauseKey({ ...g, dealt: [...g.dealt].reverse() })).not.toBe(pauseKey(g));
  });
  it('visits after 20 quiet seconds; a tap, a key or leaving the page starts over', () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const seen: boolean[] = [];
    const stop = pauseTimer(doc as unknown as Document, on => seen.push(on));
    expect(PAUSE_MS).toBe(20_000);
    vi.advanceTimersByTime(PAUSE_MS - 1);
    expect(seen.at(-1)).toBe(false);
    for (const type of ['pointerdown', 'keydown']) {
      doc.dispatchEvent(new Event(type));
      vi.advanceTimersByTime(PAUSE_MS - 1);
      expect(seen.at(-1), type).toBe(false);
    }
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBe(true);
    doc.dispatchEvent(new Event('pointerdown'));
    expect(seen.at(-1)).toBe(false);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(PAUSE_MS * 2);
    expect(seen.at(-1)).toBe(false);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    stop();
    const heard = seen.length;
    doc.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(PAUSE_MS * 2);
    expect(seen.length).toBe(heard);
  });
});
