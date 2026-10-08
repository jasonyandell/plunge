/** Finished hands for stats tests: real engine play, cheap choices. */
import { applyAction, CASUAL_CONFIG, legalActions, newGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { handRecordOf, type HandRecord } from '../src/history/legacy';

/** Play one hand to its end. The first bidder bids when `bid` is set; otherwise everyone passes (casual rules reshake). */
export function finishedHand(seed: string, bid = true): GameState {
  let g = newGame(bid ? PLUNGE_CONFIG : CASUAL_CONFIG, seed);
  for (let i = 0; i < 200 && g.phase !== 'hand-over' && g.phase !== 'game-over'; i++) {
    const legal = legalActions(g);
    const choice = bid && g.phase === 'bidding' && g.bids.length === 0
      ? legal.find((a) => a.type === 'bid' && a.bid.kind === 'points') ?? legal[0]! : legal[0]!;
    g = applyAction(g, choice);
  }
  if (g.phase !== 'hand-over' && g.phase !== 'game-over') throw new Error('hand never ended');
  return g;
}
export function finishedRecord(seed: string, gameId = `game-${seed}`, bid = true, endedAt = '2026-10-01T12:00:00.000Z'): HandRecord {
  const record = handRecordOf(finishedHand(seed, bid), gameId, 'native-partner');
  if (!record) throw new Error('record not produced');
  return { ...record, endedAt };
}
