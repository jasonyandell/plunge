import { type GameState, teamOf } from '../engine';
import { Domino } from './Domino';
import { SEAT_NAMES } from './store';
/** The completed tricks, one row each. Pass onTapPlay to make plays tappable. */
export function TrickHistory({
  g,
  onTapPlay,
  selected,
}: {
  g: GameState;
  onTapPlay?: ((trick: number, play: number) => void) | undefined;
  selected?: { trick: number; play: number } | null | undefined;
}) {
  return (
    <div class="hist-panel" role="region" aria-label="Trick history">
      {g.tricks.map((t, i) => {
        const ledSeat = t.plays[0]?.seat;
        return (
          <div class="hist-row" key={i}>
            <span class="hist-num">{i + 1}</span>
            <div class="hist-plays">
              {t.plays.map((p, j) => {
                const isSel = selected != null && selected.trick === i && selected.play === j;
                const cls = `hist-cell${p.seat === t.winner ? ' hist-won' : ''}${isSel ? ' hist-sel' : ''}`;
                const title = `${SEAT_NAMES[p.seat]}${p.seat === ledSeat ? ' led' : ''}${
                  p.seat === t.winner ? ' — won the trick' : ''
                }`;
                const inner = (
                  <>
                    <span class="hist-who">
                      {SEAT_NAMES[p.seat]?.[0]}
                      {p.seat === ledSeat && (
                        <span class="hist-led-dot" aria-hidden="true">
                          &bull;
                        </span>
                      )}
                    </span>
                    <Domino id={p.domino} orientation="h" className="hist-dom" />
                  </>
                );
                return onTapPlay ? (
                  <button
                    key={p.seat}
                    type="button"
                    class={`${cls} hist-tap`}
                    title={`${title} — ask walt`}
                    onClick={() => onTapPlay(i, j)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={p.seat} class={cls} title={title}>
                    {inner}
                  </div>
                );
              })}
            </div>
            <span class={`hist-pts ${teamOf(t.winner) === 0 ? 'us' : 'them'}`}>+{t.points}</span>
          </div>
        );
      })}
    </div>
  );
}

