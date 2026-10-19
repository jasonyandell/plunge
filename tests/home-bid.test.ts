import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, legalDeclarations, newGame, PLUNGE_CONFIG, type Seat } from '../src/engine';
import { rotateGame } from '../src/room/view';
import { initialApp, reducer, type AppEvent } from '../src/ui/store';
import { NewGameButton } from '../src/ui/NewGameButton';
import { YourBid } from '../src/ui/YourBid';

afterEach(() => vi.unstubAllGlobals());

describe('starting a new game', () => {
  it('leaves the saved game alone on cancel and starts a fresh session on confirmation', () => {
    const app = reducer(initialApp(), { type: 'new-game', seed: 'old', sessionId: 'old-session' });
    const sent: AppEvent[] = [], started = vi.fn(), confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('window', { confirm });
    const button = NewGameButton({ app, dispatch: e => sent.push(e), onStarted: started })!;
    button.props.onClick();
    expect(sent).toEqual([]);
    expect(started).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    button.props.onClick();
    expect(sent).toHaveLength(1);
    const fresh = reducer(app, sent[0]!);
    expect(fresh.screen).toBe('table');
    expect(fresh.sessionId).not.toBe(app.sessionId);
    expect(fresh.game!.marks).toEqual([0, 0]);
    expect(fresh.game!.handNumber).toBe(1);
    expect(started).toHaveBeenCalledOnce();
  });
});

describe('your auction choice', () => {
  it('persists each player’s pass through declaring and play, from every family seat', () => {
    let game = newGame(PLUNGE_CONFIG, 'bid-display');
    const bidder = game.turn!;
    game = applyAction(game, { type: 'bid', bid: { kind: 'points', value: 35 } });
    for (let n = 0; n < 3; n++) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
    for (const phase of ['declaring', 'playing']) {
      if (phase === 'playing') game = applyAction(game, { type: 'declare', decl: legalDeclarations(game)[0]! });
      for (const viewer of [0, 1, 2, 3] as Seat[]) {
        expect(YourBid({ g: rotateGame(game, viewer), seat: 0 })?.props.children)
          .toBe(viewer === bidder ? 'Bid 35' : 'Passed');
      }
    }
    expect(YourBid({ g: newGame(PLUNGE_CONFIG, 'next-deal'), seat: 0 })).toBeNull();
  });
});
