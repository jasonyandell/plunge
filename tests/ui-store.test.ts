/**
 * UI store tests: reducer logic, timer-free AI scheduling, localStorage
 * round-trip + resume, difficulty wiring, and friendly copy.
 * No DOM, no timers — the store is pure by design.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Action, GameState, Seat } from '../src/engine';
import { CASUAL_CONFIG, applyAction, legalActions, newGame } from '../src/engine';
import type { Difficulty } from '../src/ai';
import { chooseAction as legacyChoice } from '../src/ai';
// Store transition tests inject a cheap legal policy; the asynchronous Walt
// receipt boundary is exercised separately in native-table and phone tests.
const chooseAction: typeof legacyChoice = (state, seat, _difficulty, rand) => legacyChoice(state, seat, 'easy', rand);
import {
  type AppState,
  type ChooseFn,
  type StorageLike,
  DEFAULT_SETTINGS,
  HUMAN_SEAT,
  STORAGE_KEY,
  aiDelayMs,
  bidLabel,
  configFor,
  handOverCopy,
  initialApp,
  ledChip,
  loadApp,
  pendingAiSeat,
  PIP_SUIT_NAMES,
  thinkingCopy,
  trumpChip,
  reducer,
  saveApp,
  toSaved,
  TRICK_SHOW_MS,
} from '../src/ui/store';
import { updateAvailable } from '../src/ui/update';

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function start(seed = 'test-seed'): AppState {
  return reducer(initialApp(null), { type: 'new-game', seed });
}

/** Pick the human's move: bid the lowest points bid if any (so hands get played), else first legal action. */
function humanPolicy(g: GameState): Action {
  const actions = legalActions(g);
  const pts = actions.filter(
    (a) => a.type === 'bid' && a.bid.kind === 'points',
  );
  const first = pts[0] ?? actions[0];
  if (!first) throw new Error('no legal actions for human');
  return first;
}

/**
 * Drive the app exactly as App.tsx does, but without timers:
 * AI pending -> 'ai'; trick on display -> 'trick-shown'; human turn -> policy.
 * Stops at hand-over/game-over (next-hand is the human's tap, not automatic).
 */
function driveToHandOver(app: AppState, maxSteps = 400): AppState {
  for (let i = 0; i < maxSteps; i++) {
    const g = app.game;
    if (!g) throw new Error('no game');
    if (g.phase === 'hand-over' || g.phase === 'game-over') return app;
    const before = g;
    if (pendingAiSeat(app) !== null) {
      app = reducer(app, { type: 'ai', choose: chooseAction });
    } else if (app.showTrick) {
      app = reducer(app, { type: 'trick-shown' });
    } else if (g.turn === HUMAN_SEAT) {
      app = reducer(app, { type: 'human', action: humanPolicy(g) });
    } else {
      throw new Error(`stuck: phase=${g.phase} turn=${g.turn} showTrick=${app.showTrick}`);
    }
    // Invariant: a trick completed mid-hand always raises the show pause.
    const after = app.game!;
    if (after.tricks.length > before.tricks.length && after.phase === 'playing') {
      expect(app.showTrick).toBe(true);
    }
  }
  throw new Error('did not reach hand-over');
}

describe('store: new game / settings', () => {
  it('new-game creates a deterministic game and shows the table', () => {
    const a = start('abc');
    const b = start('abc');
    expect(a.screen).toBe('table');
    expect(a.game).not.toBeNull();
    expect(a.game).toEqual(b.game);
    expect(a.aiMoves).toBe(0);
    const c = start('different');
    expect(c.game!.dealt).not.toEqual(a.game!.dealt);
  });

  it('preset picks the right config', () => {
    expect(configFor('casual').nello).toBe('open');
    expect(configFor('tournament').nello).toBe('off');
    expect(configFor('tournament').plunge).toBe(false);
    let app = initialApp(null);
    app = reducer(app, { type: 'set-preset', preset: 'tournament' });
    app = reducer(app, { type: 'new-game', seed: 'x' });
    expect(app.game!.config).toEqual(configFor('tournament'));
  });

  it('settings events update settings only', () => {
    let app = initialApp(null);
    app = reducer(app, { type: 'set-difficulty', difficulty: 'hard' });
    expect(app.settings.difficulty).toBe('hard');
    expect(app.game).toBeNull();
  });
});

describe('store: AI scheduling (timer-free)', () => {
  it('pendingAiSeat is null on home, on human turn, and during the trick pause', () => {
    const home = initialApp(null);
    expect(pendingAiSeat(home)).toBeNull();

    let app = start('sched');
    const turn = app.game!.turn;
    if (turn === HUMAN_SEAT) {
      expect(pendingAiSeat(app)).toBeNull();
    } else {
      expect(pendingAiSeat(app)).toBe(turn);
    }
    // off the table screen the AI must not run
    const away = reducer(app, { type: 'go', screen: 'home' });
    expect(pendingAiSeat(away)).toBeNull();
    // during the trick-show pause the AI must not run
    expect(pendingAiSeat({ ...app, showTrick: true })).toBeNull();
  });

  it("an 'ai' event applies exactly one legal action and is deterministic", () => {
    // find a seed whose first actor is an AI
    let app = start('ai-first');
    while (pendingAiSeat(app) === null) {
      app = reducer(app, { type: 'human', action: humanPolicy(app.game!) });
    }
    const seat = pendingAiSeat(app);
    expect(seat).not.toBeNull();
    const a = reducer(app, { type: 'ai', choose: chooseAction });
    const b = reducer(app, { type: 'ai', choose: chooseAction });
    expect(a.game).toEqual(b.game); // deterministic given identical state
    expect(a.aiMoves).toBe(app.aiMoves + 1);
    expect(a.game!.bids.length + a.game!.tricks.length).toBeGreaterThanOrEqual(
      app.game!.bids.length + app.game!.tricks.length,
    );
  });

  it("'ai' is a no-op when no AI is pending", () => {
    const home = initialApp(null);
    expect(reducer(home, { type: 'ai', choose: chooseAction })).toEqual(home);
  });

  it('difficulty is wired through to chooseAction', () => {
    const seen: Difficulty[] = [];
    const spy: ChooseFn = (state, seat, difficulty, rand) => {
      seen.push(difficulty);
      return chooseAction(state, seat, difficulty, rand);
    };
    let app = start('difficulty');
    app = { ...app, settings: { ...app.settings, difficulty: 'hard' } };
    while (pendingAiSeat(app) === null && app.game!.phase === 'bidding') {
      app = reducer(app, { type: 'human', action: humanPolicy(app.game!) });
    }
    if (pendingAiSeat(app) !== null) {
      app = reducer(app, { type: 'ai', choose: spy });
      expect(seen).toEqual(['hard']);
      app = reducer(app, { type: 'set-difficulty', difficulty: 'easy' });
      if (pendingAiSeat(app) !== null) {
        reducer(app, { type: 'ai', choose: spy });
        expect(seen).toEqual(['hard', 'easy']);
      }
    } else {
      throw new Error('expected an AI turn during bidding');
    }
  });

  it('AI seat passed to chooseAction matches state.turn (never the human)', () => {
    const seats: Seat[] = [];
    const spy: ChooseFn = (state, seat, difficulty, rand) => {
      seats.push(seat);
      expect(state.turn).toBe(seat);
      return chooseAction(state, seat, difficulty, rand);
    };
    let app = start('seats');
    for (let i = 0; i < 60 && app.game!.phase !== 'hand-over' && app.game!.phase !== 'game-over'; i++) {
      if (pendingAiSeat(app) !== null) app = reducer(app, { type: 'ai', choose: spy });
      else if (app.showTrick) app = reducer(app, { type: 'trick-shown' });
      else if (app.game!.turn === HUMAN_SEAT) {
        app = reducer(app, { type: 'human', action: humanPolicy(app.game!) });
      }
    }
    expect(seats.length).toBeGreaterThan(0);
    expect(seats).not.toContain(HUMAN_SEAT);
  });

  it('aiDelayMs stays in the readable 500–950ms band', () => {
    let app = start('delay');
    for (let i = 0; i < 12; i++) {
      const d = aiDelayMs({ ...app, aiMoves: i });
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(950);
    }
    expect(TRICK_SHOW_MS).toBeGreaterThan(0);
  });
});

describe('store: full hand flow', () => {
  it('drives a hand to hand-over; next-hand advances only on the human tap', () => {
    let app = driveToHandOver(start('full-hand'));
    const g = app.game!;
    expect(['hand-over', 'game-over']).toContain(g.phase);
    if (g.phase === 'hand-over') {
      // AI never advances the hand
      expect(pendingAiSeat(app)).toBeNull();
      expect(reducer(app, { type: 'ai', choose: chooseAction })).toEqual(app);
      const handNumber = g.handNumber;
      app = reducer(app, { type: 'human', action: { type: 'next-hand' } });
      expect(app.game!.handNumber).toBe(handNumber + 1);
      expect(app.game!.phase).toBe('declaring');
      expect(app.game!.contract).toEqual({kind:'points', value:30});
    }
  });

  it('illegal/stale human actions are ignored, not thrown', () => {
    const app = start('illegal');
    const next = reducer(app, {
      type: 'human',
      action: { type: 'play', domino: '65' },
    });
    expect(next).toEqual(app); // bidding phase: a play is illegal -> ignored
    const next2 = reducer(app, { type: 'human', action: { type: 'next-hand' } });
    expect(next2).toEqual(app);
  });

  it('property: any seed reaches hand-over without throwing', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const app = driveToHandOver(start(seed));
        const g = app.game!;
        expect(['hand-over', 'game-over']).toContain(g.phase);
        if (!g.thrownIn) {
          expect(g.handResult ?? g.winner !== null).toBeTruthy();
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('store: persistence', () => {
  it('round-trips settings + in-progress game through storage', () => {
    const storage = fakeStorage();
    let app = start('persist-seed');
    // play a few steps so the game is mid-flight
    for (let i = 0; i < 5 && pendingAiSeat(app) !== null; i++) {
      app = reducer(app, { type: 'ai', choose: chooseAction });
    }
    saveApp(storage, app);
    const loaded = loadApp(storage);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(JSON.parse(JSON.stringify(toSaved(app))));
    const resumedApp = reducer(initialApp(loaded), { type: 'resume' });
    expect(resumedApp.screen).toBe('table');
    expect(resumedApp.game).toEqual(JSON.parse(JSON.stringify(app.game)));
    expect(resumedApp.settings).toEqual(app.settings);
    expect(resumedApp.aiMoves).toBe(app.aiMoves);
    // the resumed game keeps playing identically
    if (pendingAiSeat(resumedApp) !== null && pendingAiSeat(app) !== null) {
      expect(reducer(resumedApp, { type: 'ai', choose: chooseAction }).game).toEqual(
        reducer(app, { type: 'ai', choose: chooseAction }).game,
      );
    }
  });

  it('rejects corrupt or foreign payloads', () => {
    const storage = fakeStorage();
    expect(loadApp(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, 'not json');
    expect(loadApp(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ v: 99 }));
    expect(loadApp(storage)).toBeNull();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, settings: { difficulty: 'nope', preset: 'casual' }, seed: 's', game: null, aiMoves: 0 }),
    );
    expect(loadApp(storage)).toBeNull();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, settings: DEFAULT_SETTINGS, seed: 's', game: { phase: 'bidding', hands: [[], []] }, aiMoves: 0 }),
    );
    expect(loadApp(storage)).toBeNull();
  });

  it('resume is a no-op without a saved game', () => {
    const app = initialApp(null);
    expect(reducer(app, { type: 'resume' })).toEqual(app);
  });
});

describe('store: copy', () => {
  it('bid labels read like the table', () => {
    expect(bidLabel({ kind: 'pass' })).toBe('Pass');
    expect(bidLabel({ kind: 'points', value: 31 })).toBe('31');
    expect(bidLabel({ kind: 'marks', value: 1 })).toBe('1 mark (42)'.replace(' (42)', '')); // "1 mark"
    expect(bidLabel({ kind: 'marks', value: 2 })).toBe('2 marks');
    expect(bidLabel({ kind: 'marks', value: 4, special: 'plunge' })).toContain('Plunge');
  });

  it('thinking copy names the seat', () => {
    expect(thinkingCopy(1 as Seat)).toBe("Earl's thinking it over");
    expect(thinkingCopy(2 as Seat)).toBe("Gran's thinking it over");
    expect(thinkingCopy(3 as Seat)).toBe("Ruby's thinking it over");
  });

  it('hand-over copy: thrown-in hand', () => {
    let app = start('copy');
    const g = app.game!;
    const thrown: GameState = { ...g, thrownIn: true, phase: 'hand-over' };
    const c = handOverCopy(thrown);
    expect(c.title).toBe('Nobody wanted it');
    expect(c.detail).toContain("shake 'em up");
  });

  it("hand-over copy: a set against them says y'all held 'em", () => {
    const app = driveToHandOver(start('copy-set'));
    const g = app.game!;
    if (g.handResult && !g.handResult.made && g.handResult.team === 0 && g.handResult.contract.kind === 'points') {
      expect(handOverCopy(g).title).toMatch(/Set! Y'all held 'em to \d+/);
    }
    // always: copy exists and mentions marks
    if (g.handResult) {
      const c = handOverCopy(g);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.detail).toMatch(/mark/);
    }
  });
});

// ---------------------------------------------------------------------------
// Info bar chips (trump / led suit)
// ---------------------------------------------------------------------------

describe('store: info bar chips', () => {
  // Drive a real game to the playing phase so chips come from genuine state.
  const playingState = (seed: string): GameState => {
    let g = newGame(CASUAL_CONFIG, seed);
    let guard = 0;
    while (g.phase !== 'playing') {
      if (g.phase === 'hand-over') {
        g = applyAction(g, { type: 'next-hand' });
        continue;
      }
      const acts = legalActions(g);
      // bid 1 mark when possible so declaring happens; otherwise first action
      const act =
        acts.find(
          (a) => a.type === 'bid' && a.bid.kind === 'marks' && a.bid.value === 1 && !a.bid.special,
        ) ?? acts[0]!;
      g = applyAction(g, act);
      if (++guard > 100) throw new Error('never reached playing');
    }
    return g;
  };

  it('trumpChip names a pip trump and ledChip follows the lead', () => {
    let g = playingState('chips-1');
    // force a known declaration by rebuilding the declare step is overkill;
    // instead assert consistency with whatever was declared.
    const chip = trumpChip(g);
    expect(chip).toBeTruthy();
    if (g.declaration?.type === 'pip') {
      expect(chip).toBe(`trump: ${PIP_SUIT_NAMES[g.declaration.pip]}`);
    }
    expect(ledChip(g, g.currentTrick)).toBeNull(); // nothing led yet
    const lead = legalActions(g)[0]!;
    g = applyAction(g, lead);
    const led = ledChip(g, g.currentTrick);
    expect(led).toBeTruthy();
    if (g.declaration?.type === 'pip') {
      const d = g.currentTrick[0]!.domino;
      const pip = g.declaration.pip;
      const isTrump = d[0] === String(pip) || d[1] === String(pip);
      if (isTrump) expect(led).toBe('trumps');
      else expect(led).toBe(PIP_SUIT_NAMES[Number(d[0])]);
    }
  });

  it('spells out doubles treatment for no-trump and Nel-O', () => {
    const base = playingState('chips-2');
    const fake = (decl: GameState['declaration'], cfg: Partial<GameState['config']>): GameState =>
      ({ ...base, declaration: decl, config: { ...base.config, ...cfg } }) as GameState;
    expect(trumpChip(fake({ type: 'doubles' }, {}))).toBe('trump: doubles');
    expect(trumpChip(fake({ type: 'no-trump' }, { noTrumpDoubles: 'high' }))).toBe(
      'no trump — doubles high',
    );
    expect(trumpChip(fake({ type: 'no-trump' }, { noTrumpDoubles: 'low' }))).toBe(
      'no trump — doubles low',
    );
    expect(trumpChip(fake({ type: 'nello' }, { nelloDoubles: 'own-suit' }))).toBe(
      'Nel-O — doubles own suit',
    );
    expect(trumpChip(fake({ type: 'sevens' }, {}))).toContain('closest to 7');
    expect(trumpChip({ ...base, declaration: null } as GameState)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deploy-aware reload (issue #2)
// ---------------------------------------------------------------------------

describe('update detection', () => {
  it('offers an update only for a real, different build id', () => {
    expect(updateAvailable('abc', { build: 'def' })).toBe(true);
    expect(updateAvailable('abc', { build: 'abc' })).toBe(false);
    expect(updateAvailable('dev', { build: 'def' })).toBe(false); // local dev never nags
    expect(updateAvailable('abc', { build: '' })).toBe(false);
    expect(updateAvailable('abc', { build: 42 })).toBe(false);
    expect(updateAvailable('abc', null)).toBe(false);
    expect(updateAvailable('abc', undefined)).toBe(false);
    expect(updateAvailable('abc', 'def')).toBe(false);
  });
});
