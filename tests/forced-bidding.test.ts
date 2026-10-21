import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { applyAction, legalActions, newDealtGame, newGame, PLUNGE_CONFIG, TOURNAMENT_CONFIG, type GameState, type Seat } from '../src/engine';
import { encodeReplay, decodeReplay } from '../src/engine/replay-code';
import { initialApp, reducer, toSaved } from '../src/ui/store';

const pass = { type: 'bid', bid: { kind: 'pass' } } as const;
const thirty = { type: 'bid', bid: { kind: 'points', value: 30 } } as const;
const finish = (g: GameState): GameState => {
  while (g.phase === 'playing' || g.phase === 'declaring') g = applyAction(g, legalActions(g)[0]!);
  return g;
};

describe('Plunge forced last bid', () => {
  it.each(['force-30', 'force-30-or-nello'] as const)('offers only 30 points under %s while keeping marks available', allPass => {
    let g = newGame({ ...PLUNGE_CONFIG, allPass }, 'forced-options');
    const openingMarks = legalActions(g).filter(a => a.type === 'bid' && a.bid.kind === 'marks');
    for (let i = 0; i < 3; i++) g = applyAction(g, pass);
    const actions = legalActions(g);
    expect(actions.filter(a => a.type === 'bid' && a.bid.kind === 'points')).toEqual([thirty]);
    for (const action of openingMarks) {
      // Plain marks are independent of the bidder's hand.
      if (action.type === 'bid' && action.bid.kind === 'marks' && !action.bid.special) {
        expect(actions).toContainEqual(action);
        expect(applyAction(g, action).contract).toEqual({ kind: 'marks', value: action.bid.value });
      }
    }
    if (allPass === 'force-30-or-nello') {
      expect(actions).toContainEqual({ type: 'bid', bid: { kind: 'marks', value: 1, special: 'nello' } });
    }
  });

  it('keeps the full points ladder before a forced turn and under reshake rules', () => {
    for (const config of [PLUNGE_CONFIG, TOURNAMENT_CONFIG]) {
      let g = newGame(config, 'ordinary-bidding');
      expect(legalActions(g).filter(a => a.type === 'bid' && a.bid.kind === 'points')).toHaveLength(12);
      if (config.allPass === 'reshake') {
        for (let i = 0; i < 3; i++) g = applyAction(g, pass);
        expect(legalActions(g)).toContainEqual(pass);
        expect(legalActions(g).filter(a => a.type === 'bid' && a.bid.kind === 'points')).toHaveLength(12);
      }
    }
  });

  it('forces each shaker after three passes and preserves the rule in replay links', () => {
    const fixtures = ([0,1,2,3] as Seat[]).map(shaker => {
      let g = newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, 420600).dealt, shaker);
      for (let i=0;i<3;i++) {
        expect(legalActions(g)).toContainEqual(pass);
        g = applyAction(g, pass);
      }
      expect(g.turn).toBe(shaker);
      expect(legalActions(g)).not.toContainEqual(pass);
      expect(() => applyAction(g, pass)).toThrow();
      expect(legalActions(g)).toContainEqual(thirty);
      expect(legalActions(g).filter(a => a.type === 'bid' && a.bid.kind === 'points')).toEqual([thirty]);
      for (let value = 31; value <= 41; value++) {
        expect(() => applyAction(g, { type: 'bid', bid: { kind: 'points', value } })).toThrow();
      }
      const start=toSaved({...initialApp(),game:g,seed:'forced-browser',sessionId:'forced-browser'});
      g = applyAction(g, thirty);
      expect(g.forcedBid).toBe(true);
      expect(g.declarer).toBe(shaker);
      g = finish(g);
      const code = encodeReplay(g)!;
      expect(code.startsWith('v1l')).toBe(true);
      const replay = decodeReplay(code)!;
      expect(replay.config).toEqual(g.config);
      expect(replay.forcedBid).toBe(true);
      expect(replay.tricks).toEqual(g.tricks);
      expect(replay.points).toEqual(g.points);
      expect(decodeReplay(code.slice(0,61)+'PPPP')).toBeNull();
      return {code, points:g.points, bidder:shaker, start};
    });
    if(process.env.FORCED_BID_AUDIT_OUTPUT) writeFileSync(process.env.FORCED_BID_AUDIT_OUTPUT,JSON.stringify(fixtures));
  });

  it('still permits the last player to pass when somebody already bid', () => {
    let g = newGame(PLUNGE_CONFIG, 'not-forced');
    g = applyAction(g, thirty);
    g = applyAction(applyAction(g, pass), pass);
    expect(legalActions(g)).toContainEqual(pass);
    expect(legalActions(g)).toContainEqual({ type: 'bid', bid: { kind: 'points', value: 31 } });
    expect(legalActions(g)).toContainEqual({ type: 'bid', bid: { kind: 'points', value: 41 } });
    g = applyAction(g, pass);
    expect(g.forcedBid).toBe(false);
  });

  it('updates an existing saved auction without losing its bids or deal', () => {
    let old = newGame(TOURNAMENT_CONFIG, 'old-auction');
    old = applyAction(applyAction(applyAction(old,pass),pass),pass);
    const app = {...initialApp(),game:old};
    const resumed = initialApp(toSaved(app));
    expect(resumed.game!.bids).toEqual(old.bids);
    expect(resumed.game!.dealt).toEqual(old.dealt);
    expect(legalActions(resumed.game!)).not.toContainEqual(pass);
    expect(legalActions(resumed.game!).filter(a => a.type === 'bid' && a.bid.kind === 'points')).toEqual([thirty]);
    expect(resumed.game!.config).toEqual(PLUNGE_CONFIG);
  });

  it('preserves old played-hand rules, then uses forced bidding on the next hand', () => {
    let old = newGame(TOURNAMENT_CONFIG, 'old-play');
    old = applyAction(old,thirty);
    for(let i=0;i<3;i++) old = applyAction(old,pass);
    old = applyAction(old,legalActions(old)[0]!);
    const restored = initialApp(toSaved({...initialApp(),game:old}));
    expect(restored.game).toEqual(old);
    const completed=finish(old), code=encodeReplay(completed)!;
    expect(code.startsWith('v1t')).toBe(true);
    expect(decodeReplay(code)!.config.allPass).toBe('reshake');
    const app={...restored,game:completed};
    const next=reducer(app,{type:'human',action:{type:'next-hand'}});
    expect(next.game!.config).toEqual(PLUNGE_CONFIG);
    expect(next.game!.marks).toEqual(completed.marks);
    expect(next.game!.handNumber).toBe(completed.handNumber+1);
  });
});
