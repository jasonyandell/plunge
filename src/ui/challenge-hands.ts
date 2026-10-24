import {
  ALL_DOMINO_IDS, PLUNGE_CONFIG, applyAction, legalActions, mulberry32, newDealtGame,
  type DominoId, type GameState,
} from '../engine';
import { mediumAction } from '../ai/medium';
import { observe } from '../ai/observation';

interface Challenge {
  readonly title: string;
  readonly hands: readonly (readonly DominoId[])[];
  readonly hint: string;
}

/** Fixed teaching deals, separate from match dealing and its measured catalogue.
 * Seat 0 owns the highest trumps and only doubles outside trump. Every other
 * seat has at most as many trumps, so drawing trump before cashing doubles forces a sweep,
 * regardless of how the other three seats respond. Tests check that certificate.
 */
function deal(you: DominoId[], left: DominoId[], partnerTrumps: DominoId[]): readonly DominoId[][] {
  const used = new Set([...you, ...left, ...partnerTrumps]);
  const rest = ALL_DOMINO_IDS.filter(id => !used.has(id));
  const partner = [...partnerTrumps, ...rest.filter(id => !id.includes('6')).slice(0, 7 - partnerTrumps.length)];
  return [you, left, partner, rest.filter(id => !partner.includes(id))];
}

export const CHALLENGES: readonly Challenge[] = [
  {
    title: 'Four trumps',
    hands: deal(['66', '65', '64', '63', '55', '44', '33'],
      ['62', '00', '10', '11', '20', '21', '22'], ['61']),
    hint: 'Your doubles can be trumped. Lead a high six first, and count the sixes that come out before leading your doubles.',
  },
  {
    title: 'Three trumps',
    hands: deal(['66', '65', '64', '55', '44', '33', '22'],
      ['63', '62', '00', '10', '11', '20', '21'], []),
    hint: 'One round of trump may not be enough. There are seven sixes in the set. Keep drawing until all four outside your hand have been played.',
  },
  {
    title: 'Two trumps',
    hands: deal(['66', '65', '55', '44', '33', '22', '11'],
      ['64', '63', '00', '10', '20', '21', '30'], ['62']),
    hint: 'Your two sixes are the highest trumps. In this deal, nobody else holds more than two. Lead both before cashing your doubles.',
  },
];

export function startChallenge(index: number): GameState {
  const challenge = CHALLENGES[index];
  if (!challenge) throw new Error('Unknown challenge');
  let game = newDealtGame(PLUNGE_CONFIG, challenge.hands, 3);
  game = applyAction(game, { type: 'bid', bid: { kind: 'marks', value: 1 } });
  for (let i = 0; i < 3; i++) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
  return applyAction(game, { type: 'declare', decl: { type: 'pip', pip: 6 } });
}

/** These practice opponents use the existing local heuristic player and only
 * their own information. No model requests, receipts, or match stats are made.
 */
export function challengeReply(game: GameState): GameState {
  if (game.phase !== 'playing' || game.turn === null || game.turn === 0) return game;
  const ply = game.tricks.length * 4 + game.currentTrick.length;
  return applyAction(game, mediumAction(observe(game, game.turn), legalActions(game), mulberry32(ply + 1)));
}

export interface ChallengeAttempt {
  readonly game: GameState;
  readonly checkpoints: readonly GameState[];
  readonly hold: boolean;
}

export type ChallengeEvent =
  | { type: 'play'; domino: DominoId; game: GameState }
  | { type: 'reply'; game: GameState }
  | { type: 'continue'; game: GameState }
  | { type: 'undo' }
  | { type: 'restart'; index: number };

export function challengeAttempt(index: number): ChallengeAttempt {
  return { game: startChallenge(index), checkpoints: [], hold: false };
}

export function challengeReducer(state: ChallengeAttempt, event: ChallengeEvent): ChallengeAttempt {
  if (event.type === 'restart') return challengeAttempt(event.index);
  if (event.type === 'undo') {
    const game = state.checkpoints.at(-1);
    return game ? { game, checkpoints: state.checkpoints.slice(0, -1), hold: false } : state;
  }
  // Ignore a second tap or a timer captured before undo/restart.
  if (event.game !== state.game) return state;
  if (event.type === 'continue') return { ...state, hold: false };
  if (state.hold || state.game.phase !== 'playing') return state;
  if (event.type === 'play' && state.game.turn !== 0) return state;
  try {
    const game = event.type === 'reply' ? challengeReply(state.game)
      : applyAction(state.game, { type: 'play', domino: event.domino });
    return { game, hold: game.tricks.length > state.game.tricks.length,
      checkpoints: event.type === 'play' ? [...state.checkpoints, state.game] : state.checkpoints };
  } catch { return state; }
}
