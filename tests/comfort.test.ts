import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, legalDominoes, newGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { DEFAULT_COMFORT, RepeatTapGuard, comfortSettings } from '../src/ui/comfort';
import { selectedForPosition } from '../src/ui/ComfortHand';
import { holdCompletedTrick, initialApp, loadApp, pendingAiSeat, reducer, toSaved } from '../src/ui/store';
import { Domino } from '../src/ui/Domino';

function playing(): GameState {
  let g = newGame(PLUNGE_CONFIG, 'comfort-tests');
  g = applyAction(g, { type: 'bid', bid: { kind: 'points', value: 30 } });
  for (let i = 0; i < 3; i++) g = applyAction(g, { type: 'bid', bid: { kind: 'pass' } });
  g = applyAction(g, { type: 'declare', decl: { type: 'pip', pip: 6 } });
  while (g.turn !== 0) g = applyAction(g, legalActions(g)[0]!);
  return g;
}

describe('Comfort controls', () => {
  it('migrates old settings and malformed preferences without discarding a saved game', () => {
    const app = reducer(initialApp(), { type: 'new-game', seed: 'existing' });
    const saved = JSON.parse(JSON.stringify(toSaved(app)));
    delete saved.settings.comfort;
    const storage = { getItem: () => JSON.stringify(saved), setItem() {}, removeItem() {} };
    expect(loadApp(storage)?.settings.comfort).toEqual(DEFAULT_COMFORT);
    expect(loadApp(storage)?.game).toEqual(app.game);
    saved.settings.comfort = { enabled: true, repeatTapMs: -100, pauseAfterTrick: 'yes' };
    expect(loadApp(storage)?.settings.comfort).toEqual({ ...DEFAULT_COMFORT, enabled: true });
    expect(comfortSettings(null)).toEqual(DEFAULT_COMFORT);
  });

  it('a share link enables comfort without replacing a game or custom preferences', () => {
    const saved = toSaved(reducer(initialApp(), { type: 'new-game', seed: 'saved' }));
    const customized = { ...saved, settings: { ...saved.settings, comfort: {
      ...DEFAULT_COMFORT, repeatTapMs: 600 as const, pauseAfterTrick: false,
    } } };
    const linked = initialApp(customized, '?comfort=1');
    expect(linked.settings.comfort).toEqual({ ...customized.settings.comfort, enabled: true });
    expect(linked.game).toEqual(saved.game);
    expect(initialApp(customized).settings.comfort.enabled).toBe(false);
  });

  it('filters repeated pointer taps across targets without blocking keyboard or indefinite tapping', () => {
    const guard = new RepeatTapGuard();
    expect(guard.accept(0, 1, 600)).toBe(true);
    expect(guard.accept(50, 2, 600)).toBe(false);
    expect(guard.accept(200, 1, 600)).toBe(false);
    expect(guard.accept(250, 0, 600)).toBe(true); // VoiceOver / keyboard
    expect(guard.accept(599, 1, 600)).toBe(false);
    expect(guard.accept(600, 1, 600)).toBe(true);
    expect(guard.accept(601, 1, 0)).toBe(true);
  });

  it('announces selection and rejects a selection from a previous position', () => {
    const game = playing(), id = legalDominoes(game)[0]!;
    const selection = { game, id };
    expect(selectedForPosition(game, selection)).toBe(id);
    expect(selectedForPosition({ ...game }, selection)).toBeNull();
    const vnode = Domino({ id, state: 'legal', selected: true, onTap() {} });
    expect(vnode.props['aria-pressed']).toBe(true);
    const app = { ...initialApp(), screen: 'table' as const, game };
    const stale = { type: 'human' as const, action: { type: 'play' as const, domino: id }, expectedGame: { ...game } };
    expect(reducer(app, stale)).toBe(app);
  });

  it('does not apply repeated human bids to the next computer seat', () => {
    let game = newGame(PLUNGE_CONFIG, 'repeat-bids');
    while (game.turn !== 0) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
    const app = { ...initialApp(), screen: 'table' as const, game };
    const event = { type: 'human' as const, action: { type: 'bid' as const, bid: { kind: 'points' as const, value: 30 } } };
    const after = reducer(app, event);
    expect(after.game).not.toBe(game);
    expect(reducer(after, event)).toBe(after);
    expect(reducer({ ...app, screen: 'home' }, event).game).toBe(game);
  });

  it('holds completed tricks across reload, blocking both actors until Continue', () => {
    let game = playing();
    while (game.tricks.length === 0) game = applyAction(game, legalActions(game)[0]!);
    const app = { ...initialApp(undefined, '?comfort=1'), screen: 'table' as const, game, showTrick: true };
    expect(holdCompletedTrick(app)).toBe(true);
    expect(pendingAiSeat(app)).toBeNull();
    expect(reducer(app, { type: 'human', action: legalActions(game)[0]! })).toBe(app);
    expect(reducer(app, { type: 'ai' })).toBe(app);
    expect(initialApp(toSaved(app)).showTrick).toBe(true);
    const next = reducer(app, { type: 'trick-shown' });
    expect(next.showTrick).toBe(false);
    expect(initialApp(toSaved(next)).showTrick).toBe(false);
    expect(next.game).toBe(game);
    expect(holdCompletedTrick({ ...app, settings: { ...app.settings,
      comfort: { ...app.settings.comfort, pauseAfterTrick: false } } })).toBe(false);
  });
});
