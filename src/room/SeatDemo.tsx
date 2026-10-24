import { useState } from 'preact/hooks';
import type { Seat } from '../engine';
import { ROOMS_ENABLED } from './client';
import { SeatChooser } from './SeatChooser';
import '../ui/app.css';
import '../ui/home.css';
import '../ui/sheets.css';
import './room.css';

/** No room connection or saved-game writes: moving chairs stays in this demo. */
export function SeatDemo() {
  const [seat, setSeat] = useState<Seat>(2);
  const seats = ([0,1,2,3] as const).map(s => s === seat ? { name: 'You', connected: true, away: false }
    : s === 0 ? { name: 'Demo Rose', connected: true, away: false } : null);
  const partner = seats[(seat + 2) % 4]?.name ?? 'Walt';
  return <main class="rooms">
    <div class="room-bar"><span>Family table · Seat demo</span><a class="room-bar-link" href="?play=1">Back to game</a></div>
    <div class="room-wait"><div class="home-card">
      <p class="eyebrow">Try choosing your seat</p><h1 class="sheet-title">Pull up a chair</h1>
      <p>This is a sample table. Tap “Sit here” to move next to a different partner. Demo Rose’s chair stays reserved.</p>
      <SeatChooser seats={seats} seat={seat} model="Walt" onChoose={next => { if (!seats[next]) setSeat(next); }} />
      <p class="room-notice" role="status" aria-live="polite">You’re in seat {seat + 1}. Your partner is {partner}.</p>
      <button type="button" class="big-btn secondary" onClick={() => setSeat(2)}>Reset demo</button>
      {ROOMS_ENABLED && <a class="big-btn room-demo-link" href="?rooms=1">Open a real family table</a>}
      <p class="setting-hint">No sign-in needed. This demo doesn’t join a live table or change your saved games.</p>
    </div></div>
  </main>;
}
