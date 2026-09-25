import { applyAction, legalActions, legalDominoes, newDealtGame, newGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { encodeReplay } from '../src/engine/replay-code';
import { BID_BOOK } from '../src/ai/bid-book';
import { getBiddingHint } from '../src/ai/bidding-hint';
import { requestOf } from '../src/ai/native';
import { tileOfId } from '../src/ai/walt/requests';
import type { HintEvidence, MoveHintEvidence } from '../src/questions/hint-evidence';
import { allPlays, validQuestion, type Question } from '../src/questions/model';
export const session = 'hint-question-test';
export function auctionFixture(declaring = false): GameState {
  const seed = BID_BOOK.seeds[0]!;
  let g = newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, seed).dealt, 3);
  if (declaring) {
    g = applyAction(g, { type: 'bid', bid: { kind: 'points', value: 36 } });
    for (let i=0;i<3;i++) g = applyAction(g, { type: 'bid', bid: { kind: 'pass' } });
  }
  return g;
}
export function moveFixture(): GameState {
  return applyAction(auctionFixture(true), { type: 'declare', decl: { type: 'pip', pip: 5 } });
}
export function moveEvidence(g = moveFixture(), worlds: 40 | 160 | 500 = 40): MoveHintEvidence {
  const legal = legalDominoes(g).map(tileOfId), request = requestOf(g, 0, session);
  const choice = legal[worlds === 40 ? 0 : 1] ?? legal[0]!;
  return { kind: 'move', requested_worlds: worlds, choice, forced: legal.length === 1,
    explanation: `Original ${worlds}-deal explanation.`, context: 'You are choosing the lead.',
    estimate: legal.length === 1 ? null : {
      schema: 'plunge-estimate-v1', id: (worlds === 40 ? 'd' : 'e').repeat(64), created: '2026-09-21T00:00:00Z',
      identity: { request, player: { n: worlds }, implementation: { test: true } },
      response: { ...(request.contract ? {contract:request.contract,inactive:g.sittingOut!} : {}), choice, legal, leader: g.leader!, points: [...g.points], route: 'baseline', elapsed_us: 100,
        phases: [{ name: 'baseline', status: 'completed' }], evaluation: { outer_worlds: worlds,
          options: legal.map(t => [t, (t === choice) === (request.seat%2 === request.bidder%2) ? '3' : '1', '4']) } },
    } };
}
export function bookEvidence(g = auctionFixture()): HintEvidence {
  const advice = getBiddingHint(g); if (advice.kind !== 'book') throw new Error('Missing fixture book hand');
  return { kind: g.phase === 'bidding' ? 'bid' : 'trump', advice, book_id: BID_BOOK.source_book, profile: BID_BOOK.profile,
    policy_bid: 30, threshold: [4,5], explored_target: 37, comparison_open: true,
    heading: 'The original recommendation', explanation: 'The original explanation.' };
}
export function hintQuestion(g = moveFixture(), evidence: HintEvidence = moveEvidence(g)): Question {
  const replay = encodeReplay(g)!;
  return validQuestion({ schema: 'plunge-question-v2', id: '6'.repeat(32), created: '2026-09-21T00:00:00Z',
    game_id: session, hand_number: 1, ply: allPlays(g).length, seed: requestOf(moveFixture(), 0, session).seed,
    snapshot: replay, replay, note: 'Why this hint?', alternative: null, receipt_id: null, receipt: null, build: 'test',
    hint_id: '7'.repeat(64), hint: evidence });
}
export function finish(g: GameState): GameState {
  while (!['hand-over','game-over'].includes(g.phase)) g = applyAction(g, legalActions(g)[0]!);
  return g;
}
