/** Replayable decisions of one hand, shared by solo and family takebacks. */
import { applyAction } from './game';
import { nextSeat, type GameState, type Seat, type Action } from './types';

/** The current hand as dealt: same dominoes, shaker, RNG and pre-hand marks. */
export function handStartOf(g: GameState): GameState {
  const marks: [number, number] = [g.marks[0], g.marks[1]];
  if (g.handResult) marks[g.handResult.team] -= g.handResult.marks;
  return {
    ...g, marks, phase: 'bidding',
    hands: g.dealt.map((h) => [...h]),
    bids: [], turn: nextSeat(g.shaker), declarer: null, contract: null, declaration: null, rules: null,
    sittingOut: null, forcedBid: false, leader: null, currentTrick: [], tricks: [], points: [0, 0],
    thrownIn: false, handResult: null, winner: null,
  };
}

export interface HandStep { readonly seat: Seat; readonly action: Action }

/** Every decision taken this hand, in order, with who took it. */
export function handSteps(g: GameState): HandStep[] {
  const steps: HandStep[] = g.bids.map((b) => ({ seat: b.seat, action: { type: 'bid', bid: b.bid } }));
  if (g.declaration) {
    // A forced Nel-O fixes its declaration with the bid; only a called trump is a step.
    let sim = handStartOf(g);
    for (const s of steps) sim = applyAction(sim, s.action);
    if (sim.phase === 'declaring' && sim.turn !== null) steps.push({ seat: sim.turn, action: { type: 'declare', decl: g.declaration } });
  }
  for (const p of [...g.tricks.flatMap((t) => t.plays), ...g.currentTrick]) steps.push({ seat: p.seat, action: { type: 'play', domino: p.domino } });
  return steps;
}
