/**
 * Hand replay on the shared table (no DOM: the felt pieces are hook-free
 * functions, so their vnode trees are expanded and inspected directly).
 */
import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import {
  type Action, type GameState, type Seat, LEGACY_PLUNGE_CONFIG, legalActions, newGame,
} from '../src/engine';
import { encodeReplay } from '../src/engine/replay-code';
import { Domino, type DominoProps } from '../src/ui/Domino';
import { Felt } from '../src/ui/TableFelt';
import { ReplayTable, type ReplayTableProps, shownTrick } from '../src/ui/ReplayTable';
import { collectHands, isLiveHand } from '../src/review/library';
import { exampleRecords } from '../src/review/fixtures';
import { back, finalState, handSteps, play, positionAt, resetBranch, sameAction } from '../src/review/steps';
import { finishHand } from '../src/review/whatif';
import { initialApp, liveHand, reducer } from '../src/ui/store';
import { GameOverSheet, HandOverSheet } from '../src/ui/sheets';

interface Tree { type: unknown; props: Record<string, unknown>; children: Tree[]; text: string }

/** Expands function components (all hook-free here) into a plain tree; records every Domino. */
function expand(node: unknown, dominoes: DominoProps[]): Tree[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(n => expand(n, dominoes));
  if (typeof node === 'string' || typeof node === 'number') return [{ type: '#text', props: {}, children: [], text: String(node) }];
  const v = node as VNode<Record<string, unknown>>;
  if (v.type === Domino) dominoes.push(v.props as DominoProps);
  if (typeof v.type === 'function') return expand((v.type as (p: unknown) => unknown)(v.props), dominoes);
  const children = expand(v.props.children, dominoes);
  return [{ type: v.type, props: v.props, children, text: children.map(c => c.text).join('') }];
}
function render(node: unknown) {
  const dominoes: DominoProps[] = [];
  const tree = expand(node, dominoes);
  const all: Tree[] = [];
  const walk = (t: Tree) => { all.push(t); t.children.forEach(walk); };
  tree.forEach(walk);
  const byClass = (c: string) => all.filter(t => String(t.props['class'] ?? '').split(' ').includes(c));
  return { dominoes, all, byClass, text: tree.map(t => t.text).join(' ') };
}
const faceUpIds = (ds: DominoProps[]) => ds.filter(d => !d.faceDown && d.id).map(d => d.id!);
const replay = (p: Partial<ReplayTableProps> & { g: GameState }) =>
  render(ReplayTable({ actual: null, reveal: false, onReveal: () => {}, onChoose: () => {}, endNote: 'End of the hand.', ...p }));

const hand = collectHands(exampleRecords()).hands.find(h => h.key === 'example-you-bid:1')!;
const steps = handSteps(hand.game)!;
const end = finalState(steps, hand.game);
/** A play decision for a seat, preferring one with a trick open and a real choice. */
const playStep = (seat: Seat) => {
  const plays = steps.filter(s => s.state.phase === 'playing' && s.state.turn === seat);
  return plays.find(s => s.state.currentTrick.length > 0 && legalActions(s.state).length > 1)
    ?? plays.find(s => legalActions(s.state).length > 1)!;
};

describe('replay on the shared table', () => {
  it('shows only the acting seat’s tiles (plus the open trick) by default, for any seat', () => {
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const step = playStep(seat);
      const g = step.state;
      const r = replay({ g, actual: step.action });
      const visible = new Set(faceUpIds(r.dominoes));
      const allowed = new Set([...g.hands[seat]!, ...g.currentTrick.map(p => p.domino)]);
      expect([...visible].filter(id => !allowed.has(id))).toEqual([]);
      for (const other of [0, 1, 2, 3].filter(s => s !== seat)) {
        for (const id of g.hands[other]!) expect(visible.has(id)).toBe(false);
      }
      // Every hidden tile is still present face down, so counts are honest.
      const down = r.dominoes.filter(d => d.faceDown).length;
      expect(down).toBe([0, 1, 2, 3].filter(s => s !== seat).reduce((n, s) => n + g.hands[s]!.length, 0));
      expect(r.byClass('replay-hindsight')).toEqual([]);
    }
  });

  it('keeps original seating and names the acting seat instead of calling it “You”', () => {
    const step = playStep(1);
    const r = replay({ g: step.state, actual: step.action });
    expect(r.byClass('seat-left')[0]!.text).toContain('Earl');
    expect(r.byClass('seat-top')[0]!.text).toContain('Gran');
    expect(r.byClass('seat-right')[0]!.text).toContain('Ruby');
    // You stay at the bottom (face down) while Earl’s hand is in the hand area.
    expect(r.byClass('replay-bottom')[0]!.text).toContain('You');
    const label = r.byClass('you-label')[0]!;
    expect(label.text).toBe('Earl');
    expect(String(label.props['class'])).toContain('replay-seat-label');
    expect(r.byClass('hand-caption')[0]!.text).toMatch(/Earl to play · Earl’s hand \(left seat\)/);
    const yours = replay({ g: playStep(0).state, actual: playStep(0).action });
    expect(yours.byClass('you-label')[0]!.text).toBe('You');
    expect(yours.byClass('replay-bottom')).toEqual([]);
  });

  it('offers exactly the legal moves, and outlines the move that actually happened', () => {
    const step = playStep(2);
    const chosen: Action[] = [];
    const r = replay({ g: step.state, actual: step.action, onChoose: a => chosen.push(a) });
    const tappable = r.dominoes.filter(d => d.onTap);
    const legal = legalActions(step.state);
    expect(tappable.map(d => d.id).sort()).toEqual(legal.map(a => (a as { domino: string }).domino).sort());
    expect(r.dominoes.filter(d => d.state === 'illegal' && d.onTap)).toEqual([]);
    tappable.forEach(d => d.onTap!());
    expect(chosen).toHaveLength(legal.length);
    expect(chosen.every(a => legal.some(l => sameAction(l, a)))).toBe(true);
    const actual = r.byClass('is-actual');
    expect(actual).toHaveLength(1);
    expect(actual[0]!.text).toContain('actual');
    // On a what-if branch there is no recorded move to outline.
    expect(replay({ g: step.state, actual: null }).byClass('is-actual')).toEqual([]);
  });

  it('offers legal bids and trump calls as chips, recorded choice marked', () => {
    for (const step of steps.filter(s => s.state.phase !== 'playing').slice(0, 5)) {
      const chosen: Action[] = [];
      const r = replay({ g: step.state, actual: step.action, onChoose: a => chosen.push(a) });
      const chips = r.byClass('replay-call');
      expect(chips).toHaveLength(legalActions(step.state).length);
      expect(chips.filter(c => String(c.props['class']).includes('is-actual'))).toHaveLength(1);
      chips.forEach(c => (c.props['onClick'] as () => void)());
      expect(chosen).toEqual(legalActions(step.state));
    }
  });

  it('turns every hand face up only under a conspicuous hindsight warning', () => {
    const step = playStep(3);
    let hidden: boolean | null = null;
    const r = replay({ g: step.state, actual: step.action, reveal: true, onReveal: on => { hidden = !on; } });
    const visible = new Set(faceUpIds(r.dominoes));
    for (const s of [0, 1, 2, 3]) for (const id of step.state.hands[s]!) expect(visible.has(id)).toBe(true);
    const banner = r.byClass('replay-hindsight')[0]!;
    expect(banner.text).toMatch(/Hindsight: all hands face up\. Nobody at the table could see these\./);
    expect(r.byClass('is-hindsight')).toHaveLength(1);
    (r.byClass('replay-hindsight-off')[0]!.props['onClick'] as () => void)();
    expect(hidden).toBe(true);
  });

  it('shows the trick in progress, and the last trick with its winner once the hand is over', () => {
    expect(shownTrick(playStep(1).state).plays).toBe(playStep(1).state.currentTrick);
    const leadStep = steps.find(s => s.state.phase === 'playing' && s.state.tricks.length > 0 && s.state.currentTrick.length === 0)!;
    expect(shownTrick(leadStep.state).plays).toEqual([]);
    const last = end.tricks[end.tricks.length - 1]!;
    expect(shownTrick(end)).toEqual({ plays: last.plays, winner: last.winner });
    const r = replay({ g: end, endNote: 'End of the hand.' });
    expect(r.text).toContain('End of the hand.');
    expect(r.dominoes.some(d => d.onTap)).toBe(false);
  });

  it('the live felt never shows another seat’s tiles', () => {
    let app = reducer(initialApp(), { type: 'new-game', seed: 'felt-live', sessionId: 'felt-live' });
    let checked = 0;
    for (let i = 0; i < 200 && app.game && app.game.phase !== 'game-over'; i++) {
      const g = app.game;
      const r = render(Felt({ g, plays: g.currentTrick, winner: null, gathering: false, thinking: null }));
      const visible = new Set(faceUpIds(r.dominoes));
      for (const s of [1, 2, 3]) for (const id of g.hands[s]!) expect(visible.has(id)).toBe(false);
      checked++;
      if (app.showTrick) { app = reducer(app, { type: 'trick-shown' }); continue; }
      const opts = legalActions(g);
      const mine = opts.find(a => a.type === 'bid' && a.bid.kind === 'points') ?? opts[0]!;
      app = g.turn === 0 || g.phase === 'hand-over'
        ? reducer(app, { type: 'human', action: mine })
        : reducer(app, { type: 'ai', choose: s => legalActions(s)[0]! });
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('in-game entry', () => {
  it('end-of-hand cards offer past-hand replay only when the table passes it', () => {
    const g = finishHand(newGame(LEGACY_PLUNGE_CONFIG, 'entry-card'));
    let opened = 0;
    const withEntry = render(HandOverSheet({ g, dispatch: () => {}, onPastHands: () => { opened++; } }));
    const button = withEntry.all.find(t => t.type === 'button' && t.text === 'Replay past hands')!;
    (button.props['onClick'] as () => void)();
    expect(opened).toBe(1);
    expect(render(HandOverSheet({ g, dispatch: () => {} })).text).not.toContain('Replay past hands');
    expect(render(GameOverSheet({ g, dispatch: () => {}, onPastHands: () => {} })).text).toContain('Replay past hands');
  });
});

describe('review stays detached from the game in progress', () => {
  it('keeps the hand being played closed, and only that hand', () => {
    let app = reducer(initialApp(), { type: 'new-game', seed: 'live-lock', sessionId: 'live-lock' });
    expect(liveHand(app)).toEqual({ gameId: 'live-lock', handNumber: 1 });
    const record = { ...hand, gameId: 'live-lock', handNumber: 1, finished: false };
    expect(isLiveHand(record, liveHand(app))).toBe(true);
    expect(isLiveHand({ ...record, handNumber: 2 }, liveHand(app))).toBe(false);
    expect(isLiveHand({ ...record, gameId: 'other' }, liveHand(app))).toBe(false);
    expect(isLiveHand({ ...record, finished: true }, liveHand(app))).toBe(false);
    expect(isLiveHand(record, null)).toBe(false);
    // Once the hand is over it can be talked over, even before the next shake.
    app = { ...app, game: finishHand(app.game!) };
    expect(app.game!.phase === 'hand-over' || app.game!.phase === 'game-over').toBe(true);
    expect(liveHand(app)).toBeNull();
  });

  it('replays, branches, undoes and resets without touching a frozen record', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
      return o;
    };
    const g = deepFreeze(finishHand(newGame(LEGACY_PLUNGE_CONFIG, 'frozen-review')));
    const before = encodeReplay(g);
    const s = handSteps(g)!;
    const e = finalState(s, g);
    let branched = 0;
    for (let at = 0; at < s.length; at++) {
      for (const a of legalActions(s[at]!.state)) {
        const c = play(s, e, { at, branch: [] }, a)!;
        const tip = positionAt(s, e, c)!;
        if (c.branch.length && tip.phase === 'playing') {
          const next = play(s, e, c, legalActions(tip)[0]!)!;
          expect(back(next)).toEqual(c);
          expect(resetBranch(next)).toEqual({ at, branch: [] });
          branched++;
        }
      }
    }
    expect(branched).toBeGreaterThan(20);
    expect(encodeReplay(g)).toBe(before);
  });
});
