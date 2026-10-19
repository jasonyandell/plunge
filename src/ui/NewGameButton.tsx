import type { AppEvent, AppState } from './store';

/** Starting over is explicit; cancelling leaves the current game resumable. */
export function NewGameButton({ app, dispatch, className = 'big-btn secondary', onStarted }: {
  app: AppState;
  dispatch: (event: AppEvent) => void;
  className?: string;
  onStarted?: () => void;
}) {
  if (app.room) return null;
  return (
    <button type="button" class={className} onClick={() => {
      if (app.game && app.game.phase !== 'game-over' && !window.confirm(
        'Start a new game? This ends your current game, and you won’t be able to resume it. Your saved history stays available. Cancel to keep your game.',
      )) return;
      dispatch({ type: 'new-game', seed: Date.now().toString(36), sessionId: crypto.randomUUID() });
      onStarted?.();
    }}>
      Start a new game
    </button>
  );
}
