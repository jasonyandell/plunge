import { useState } from 'preact/hooks';
import { Table } from './Table';
import { reducer, type AppEvent } from './store';
import { birdwatchDemoApp } from './birdwatch-demo';

export function BirdwatchDemo({ onClose }: { onClose: () => void }) {
  const [app, setApp] = useState(birdwatchDemoApp);
  const [visit, setVisit] = useState(0);
  const played = (app.game?.currentTrick.length ?? 0) > 0;
  const dispatch = (event: AppEvent) => {
    if (event.type === 'go') { onClose(); return; }
    // This sample stops after the first tile. No AI, persistence or history effects.
    if (event.type === 'human' || event.type === 'set-show-hints') {
      setApp(current => reducer(current, event));
    }
  };
  return <section class="birdwatch-demo" aria-label="Birdwatching demonstration">
    <header class="birdwatch-demo-bar">
      <strong>Birdwatching · Demo</strong>
      <p role="status">{played
        ? 'Off they go! Replay the visit to see them again.'
        : 'We skipped the 20-second wait. Watch the edges, then tap a domino.'}</p>
      <div>
        <button type="button" onClick={() => { setApp(birdwatchDemoApp()); setVisit(n => n + 1); }}>Replay visit</button>
        <button type="button" onClick={onClose}>Back to game</button>
      </div>
      <small>This sample leaves your saved game untouched.</small>
    </header>
    <div class="birdwatch-demo-table">
      <Table key={visit} app={app} dispatch={dispatch} onQuestion={() => {}} birdwatchDemo />
    </div>
  </section>;
}
