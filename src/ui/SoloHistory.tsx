import { useEffect, useState } from 'preact/hooks';
import { listHistory, retryHistory } from '../history/recorder';
import { soloHandsFromHistory } from '../history/review';
import { HandHistory } from '../room/RoomHistory';
import type { RoomHand } from '../room/protocol';
import { SOLO_SEAT_NAMES, type AppState } from './store';

export function SoloHistory({ app, onClose }: { app: AppState; onClose: () => void }) {
  const [saved, setSaved] = useState<RoomHand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    // Flush already-staged local records before reading, including the hand
    // just left. This uses the existing recorder's recovery, never the solver.
    void retryHistory().then(listHistory).then(events => {
      if (active) setSaved(soloHandsFromHistory(events));
    }).catch(() => {
      if (active) setError('Saved hands could not be loaded. Your current game is still here.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [app.sessionId, app.game?.handNumber, app.game?.phase, retry]);

  // Live state takes precedence, so an undone result cannot appear as final.
  const hands = saved.filter(hand => hand.sessionId !== app.sessionId || hand.game.handNumber !== app.game?.handNumber);
  if (app.game && (app.game.phase === 'hand-over' || app.game.phase === 'game-over')) {
    hands.push({ sessionId: app.sessionId, game: app.game, names: [...SOLO_SEAT_NAMES],
      practice: app.practiceHands.includes(app.game.handNumber) });
  }
  return <HandHistory hands={hands} current={app.screen === 'table' ? app.game : null} sessionId={app.sessionId} seat={0} solo
    loading={loading} error={error} onRetry={() => setRetry(value => value + 1)} onClose={onClose} />;
}
