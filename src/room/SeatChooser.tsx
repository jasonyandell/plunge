import type { Seat } from '../engine';
import type { RoomSeat } from './protocol';

/** Shared by the family waiting room and its browser-only walkthrough. */
export function SeatChooser({ seats, seat, model, disabled = false, onChoose }: {
  seats: readonly (RoomSeat | null)[]; seat: Seat; model: string; disabled?: boolean; onChoose: (seat: Seat) => void;
}) {
  return <>
    <p class="setting-hint" id="choose-chair">Tap an open chair to move before starting. Chairs in the same row are partners.</p>
    <div class="room-chairs" role="group" aria-label="Choose your seat" aria-describedby="choose-chair">{([0,2,1,3] as const).map(s => {
      const person = seats[s];
      const label = s === seat ? 'You' : s === (seat + 2) % 4 ? 'Your partner' : 'Across the table';
      const contents = <><strong>{person?.name ?? model}</strong><span>{label}{person && !person.connected ? ' · Away' : ''}</span></>;
      return person ? <div key={s}>{contents}</div> : <button key={s} type="button" disabled={disabled}
        aria-label={`Sit here: seat ${s + 1}, ${model}, ${label.toLowerCase()}`} onClick={() => onChoose(s)}>
        {contents}<span class="room-chair-action">Sit here</span></button>;
    })}</div>
  </>;
}
