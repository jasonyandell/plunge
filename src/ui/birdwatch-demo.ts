import { applyAction, newGame, TOURNAMENT_CONFIG } from '../engine';
import { initialApp, type AppState } from './store';

export function opensBirdwatchDemo({ hostname, search, hash }: Pick<Location, 'hostname' | 'search' | 'hash'>): boolean {
  const params = new URLSearchParams(search);
  // Preserve room and shared-hand links. Only this idea's preview auto-opens.
  if (params.has('rooms') || hash) return false;
  return params.get('demo') === 'birdwatch' ||
    params.get('idea') === 'a39f76591b9e45b8a92c55d04360f7be' ||
    hostname === 'plunge-pr-55.texas42.workers.dev';
}

/** A disposable legal hand. Never reads or writes the player's saved game. */
export function birdwatchDemoApp(): AppState {
  let game = newGame(TOURNAMENT_CONFIG, 'birdwatch-demo');
  while (game.turn !== 0) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
  game = applyAction(game, { type: 'bid', bid: { kind: 'points', value: 30 } });
  while (game.phase === 'bidding') game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
  game = applyAction(game, { type: 'declare', decl: { type: 'pip', pip: 6 } });
  const app = initialApp(null);
  return { ...app, screen: 'table', game, sessionId: 'birdwatch-demo',
    settings: { ...app.settings, difficulty: 'easy', showHints: true } };
}
