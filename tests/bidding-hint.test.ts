import { afterAll, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { applyAction, legalActions, newDealtGame, newGame, PLUNGE_CONFIG, type GameState, type Seat } from '../src/engine';
import { BID_BOOK, bestPanel, type PlayedHand } from '../src/ai/bid-book';
import { getBiddingHint, bookCeiling } from '../src/ai/bidding-hint';
import { auctionMove } from '../src/ai/auction';
import { initialApp, toSaved } from '../src/ui/store';
vi.mock('../src/ai/phone/client', () => ({ runAuction: vi.fn(), runPlayer: vi.fn() }));
import { runAuction } from '../src/ai/phone/client';

const pass = { type: 'bid', bid: { kind: 'pass' } } as const;
const hands = BID_BOOK.hands.filter(h => h.seat === 0);
const strong = hands.find(h => (bookCeiling(h.panels) ?? 0) >= 33 && bookCeiling(h.panels)! < 41)!;
const weak = hands.find(h => bookCeiling(h.panels) === null)!;
const gameFor = (h: PlayedHand, shaker: Seat = 3): GameState =>
  newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, h.seed).dealt, shaker);
const forced = (h: PlayedHand) => [1, 2, 3].reduce(g => applyAction(g, pass), gameFor(h, 0));
const declaring = (h: PlayedHand, bid: number) => {
  let g = applyAction(gameFor(h), { type: 'bid', bid: bid === 42 ? { kind: 'marks', value: 1 } : { kind: 'points', value: bid } });
  for (let i = 0; i < 3; i++) g = applyAction(g, pass);
  return g;
};
const partner = () => applyAction(applyAction(gameFor(strong, 1), { type: 'bid', bid: { kind: 'points', value: 30 } }), pass);
const raised = () => applyAction(gameFor(strong, 2), { type: 'bid', bid: { kind: 'points', value: 41 } });
const bookHint = (g: GameState) => {
  const h = getBiddingHint(g); if (h.kind !== 'book') throw new Error('Expected book hint.'); return h;
};

describe('recorded-game bidding hints', () => {
  it('matches the actual bidder for every human catalogue hand, including forced auctions', async () => {
    for (const h of hands) for (const g of [gameFor(h), forced(h)]) {
      const before = structuredClone(g), hint = bookHint(g);
      expect(hint.action).toEqual((await auctionMove(g, 0, 'hint-parity')).action);
      expect(legalActions(g)).toContainEqual(hint.action);
      expect(hint.panel).toEqual(bestPanel(h.panels, hint.target));
      expect(g).toEqual(before);
    }
    expect(runAuction).not.toHaveBeenCalled();
  });
  it('separates a weak pass, a forced bid, a partner pass and an unavailable lower bid', async () => {
    expect(bookHint(gameFor(weak))).toMatchObject({ reason: 'pass', ceiling: null, target: 30, action: pass });
    expect(bookHint(forced(weak))).toMatchObject({ reason: 'forced', ceiling: null, target: 30, action: { type: 'bid', bid: { kind: 'points', value: 30 } } });
    const support = bookHint(partner());
    expect(support.reason).toBe('partner'); expect(support.action).toEqual(pass);
    expect(support.ceiling).toBeGreaterThanOrEqual(33);
    expect(support.panels).toHaveLength(9);
    expect((await auctionMove(partner(), 0, 'partner')).action).toEqual(support.action);
    const raise = bookHint(raised());
    expect(raise).toMatchObject({ reason: 'pass', target: 42, action: pass, minimum: { kind: 'marks', value: 1 } });
    expect(raise.ceiling).toBeLessThan(42);
  });
  it('chooses trump for the actual contract, even above the usual cutoff', async () => {
    for (const target of [30, 36, 42]) {
      const g = declaring(weak, target), hint = bookHint(g);
      expect(hint).toMatchObject({ reason: 'declare', target, ceiling: null });
      expect(hint.action).toEqual((await auctionMove(g, 0, 'declare-hint')).action);
      expect(hint.panel).toEqual(bestPanel(weak.panels, target));
      expect(hint.panel.tails[target - 30]).toBeLessThan(hint.panel.games * 0.8);
    }
  });
  it('uses no actual hidden hand or deal seed, does not mutate the table, and runs no worker', () => {
    const g = gameFor(strong), original = bookHint(g);
    const hidden = new Proxy(g.hands, { get(target, key, receiver) {
      if (['1', '2', '3'].includes(String(key))) throw new Error('Read a hidden hand');
      return Reflect.get(target, key, receiver);
    } });
    const changed = { ...g, hands: hidden, dealt: [] as unknown as GameState['dealt'], rngState: 123456, handNumber: 99 };
    expect(getBiddingHint(changed)).toEqual(original);
    expect(runAuction).not.toHaveBeenCalled();
  });
  it('does not fabricate book evidence for old hands, special contracts or different no-trump rules', () => {
    const old = newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, 'not-in-book').dealt, 3);
    expect(getBiddingHint(old)).toEqual({ kind: 'unavailable', reason: 'missing-hand' });
    const g = gameFor(strong);
    expect(getBiddingHint({ ...g, config: { ...g.config, noTrumpDoubles: 'low' } })).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(getBiddingHint({ ...declaring(weak, 30), contract: { kind: 'plunge', value: 4 } })).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(() => getBiddingHint({ ...g, turn: 1 })).toThrow(/your auction turn/);
    expect(() => getBiddingHint({ ...g, phase: 'playing' })).toThrow(/your auction turn/);
    expect(runAuction).not.toHaveBeenCalled();
  });
  // Opt-in fixtures for browser verification, built with the same real engine.
  afterAll(() => {
    if (!process.env.BIDDING_HINT_FIXTURES) return;
    const states = { strong: gameFor(strong), weak: gameFor(weak), forced: forced(weak), partner: partner(), raised: raised(),
      declare: declaring(weak, 36), marks: declaring(strong, 42),
      missing: newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, 'not-in-book').dealt, 3) };
    const fixtures = Object.fromEntries(Object.entries(states).map(([name, game]) => [name, {
      save: toSaved({ ...initialApp(), game, sessionId: 'bidding-hints', screen: 'table' }), hint: getBiddingHint(game),
    }]));
    writeFileSync(process.env.BIDDING_HINT_FIXTURES, JSON.stringify(fixtures));
  });
});
