import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, newGame, PLUNGE_CONFIG, type GameState, type Seat } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { seatNote, seatRevealed } from '../src/kernel/Slot';
import type { SeatSlotProps } from '../src/kernel/mod-api';

const visit = (search: string) => { vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods(); };
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

let declaring = newGame(PLUNGE_CONFIG, 'nello-sitout-view');
declaring = applyAction(declaring, { type: 'bid', bid: { kind: 'marks', value: 1 } });
for (let n = 0; n < 3; n++) declaring = applyAction(declaring, { type: 'bid', bid: { kind: 'pass' } });
const nello = applyAction(declaring, { type: 'declare', decl: { type: 'nello' } });
const trump = applyAction(declaring, { type: 'declare', decl: { type: 'pip', pip: 3 } });
const out = nello.sittingOut!;
const at = (game: GameState, viewer: Seat, seat: Seat): SeatSlotProps =>
  ({ game, viewer, seat, name: 'Gran', relation: seat === viewer ? 'you' : (seat + 2) % 4 === viewer ? 'partner' : 'opponent' });
const others = (viewer: Seat) => ([0, 1, 2, 3] as Seat[]).filter(s => s !== viewer);
const SAYS = 'Sitting out Nel-O: the other hands are face up.';

describe('nello-sitout-view', () => {
  it('is off by default: hands stay face down and core keeps its words', () => {
    visit('');
    expect(modState().enabled.has('nello-sitout-view')).toBe(false);
    for (const seat of others(out)) expect(seatRevealed(at(nello, out, seat), false)).toBe(false);
    expect(seatNote(at(nello, out, out), 'core')).toBe('core');
  });
  it('shows the other three hands to whoever sits out, from any chair', () => {
    visit('?mods=nello-sitout-view');
    expect(out).not.toBeNull();
    for (const seat of others(out)) expect(seatRevealed(at(nello, out, seat), false)).toBe(true);
    expect(seatNote(at(nello, out, out), 'core')).toBe(SAYS);
  });
  it('shows nothing to players who play, or when nobody sits out', () => {
    visit('?mods=nello-sitout-view');
    for (const viewer of others(out)) for (const seat of others(viewer)) {
      expect(seatRevealed(at(nello, viewer, seat), false)).toBe(false);
      expect(seatNote(at(nello, viewer, seat), 'core')).toBe('core');
    }
    for (const g of [declaring, trump]) for (const seat of others(out)) expect(seatRevealed(at(g, out, seat), false)).toBe(false);
  });
  it('never reveals at a shared table, where every hand reaches every client', () => {
    visit('?mods=nello-sitout-view');
    for (const seat of others(out)) expect(seatRevealed(at(nello, out, seat), true)).toBe(false);
  });
});
