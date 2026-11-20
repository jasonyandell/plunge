import { useEffect, useState } from 'preact/hooks';
import type { GameState } from '../../engine';
import type { DecorSlotProps } from '../../kernel/mod-api';
import './birdwatch.css';

export const PAUSE_MS = 20_000;

/** Changes with every play, deal and new game, so any move restarts the pause. */
export const pauseKey = (g: GameState): string =>
  `${g.handNumber}:${g.dealt.map(hand => hand.join('.')).join('|')}:${g.tricks.length}:${g.currentTrick.length}:${g.turn}`;
/** Only while a hand is being played and nothing else is on screen. */
export const watching = ({ game, ui }: DecorSlotProps): boolean => game.phase === 'playing'
  && !ui.showingLast && !ui.review && !ui.menuOpen && !ui.historyOpen && !ui.sheetOpen && !ui.proposal && !ui.scenario;

export function Birdwatch(p: DecorSlotProps) {
  return watching(p) ? <Visit key={pauseKey(p.game)} /> : null;
}

/** Decor sees no taps, so any tap or key on the page, or coming back to it, starts a fresh pause. */
export const RESTART_EVENTS = ['pointerdown', 'keydown', 'visibilitychange'] as const;

type Doc = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
/** Calls `visit(true)` after PAUSE_MS of quiet on a visible page; returns the cleanup. */
export function pauseTimer(doc: Doc, visit: (on: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restart = () => {
    clearTimeout(timer);
    visit(false);
    if (!doc.hidden) timer = setTimeout(() => visit(true), PAUSE_MS);
  };
  restart();
  for (const e of RESTART_EVENTS) doc.addEventListener(e, restart, { passive: true });
  return () => {
    clearTimeout(timer);
    for (const e of RESTART_EVENTS) doc.removeEventListener(e, restart);
  };
}

function Visit() {
  const [visiting, setVisiting] = useState(false);
  useEffect(() => pauseTimer(document, setVisiting), []);
  return visiting ? <BirdPicture /> : null;
}

export function BirdPicture() {
  return (
    <div class="birdwatcher" aria-hidden="true">
      <svg class="birdwatcher-bird" viewBox="0 0 100 100" focusable="false">
        <g stroke="#41232c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 94H92" stroke="#b68e64" />
          <path d="M20 41Q13 12 24 8L40 20Q54 12 69 20L84 8Q91 30 80 45" fill="#bf8a69" />
          <ellipse cx="51" cy="58" rx="34" ry="35" fill="#bfcdb9" />
          <ellipse cx="51" cy="66" rx="22" ry="23" fill="#fff7e8" stroke="none" />
          <path d="M22 48Q4 51 16 77Q29 67 22 48M80 48Q97 51 85 77Q72 67 80 48" fill="#916458" />
          <circle cx="34" cy="39" r="21" fill="#fffaf1" />
          <circle cx="70" cy="39" r="21" fill="#fffaf1" />
          <g fill="#41232c" stroke="none">
            <circle cx="39" cy="40" r="10" /><circle cx="73" cy="40" r="10" />
          </g>
          <g fill="white" stroke="none">
            <circle cx="42" cy="36" r="3" /><circle cx="76" cy="36" r="3" />
          </g>
          <path d="M46 48Q52 41 58 48L52 59Z" fill="#f4b638" />
          <path d="M39 67V70M51 70V73M63 67V70" stroke="#916458" stroke-width="3" />
          <path d="M29 92Q30 81 39 88L43 94H29M61 94Q62 82 70 88L75 94Z" fill="#f4b638" />
        </g>
      </svg>
      <svg class="birdwatcher-watcher" viewBox="0 0 110 110" focusable="false">
        <g transform="rotate(-12 80 90)" stroke="#59343c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M51 37Q94 9 104 54L112 105H56Z" fill="#b98068" />
          <path d="M45 110Q43 77 77 79Q108 82 112 110" fill="#f2aaa4" />
          <path d="M66 83L78 100L91 82" fill="#b8d4df" />
          <path d="M42 38Q42 19 71 21Q99 23 98 49L92 68Q78 89 53 71Q35 64 42 38Z" fill="#ffe4cd" />
          <path d="M40 45L36 29Q60 9 89 28L100 47Q76 48 76 34Q62 50 40 45Z" fill="#b98068" />
          <path d="M35 31Q34 4 66 7Q96 7 101 33Q69 20 35 31Z" fill="#c1dfcf" />
          <path d="M35 31Q58 20 82 28L87 35Q56 30 28 39Q20 37 35 31Z" fill="#c1dfcf" />
          <path d="M78 67Q81 70 85 66" fill="none" stroke-width="2" />
          <ellipse cx="85" cy="59" rx="7" ry="4" fill="#f2aaa4" stroke="none" />
          <path d="M53 94L34 70Q31 59 41 61L65 79M88 91L70 66Q65 59 60 67L66 82" fill="#f2aaa4" />
          <path d="M30 53L58 51L63 66L32 69Z" fill="#544452" />
          <ellipse cx="31" cy="61" rx="15" ry="20" fill="#544452" />
          <ellipse cx="61" cy="58" rx="14" ry="19" fill="#544452" />
          <ellipse cx="29" cy="60" rx="10" ry="14" fill="#a9dfe2" stroke-width="2" />
          <ellipse cx="59" cy="57" rx="9" ry="13" fill="#a9dfe2" stroke-width="2" />
          <path d="M24 54L30 50M54 51L59 48" stroke="#fffaf1" stroke-width="3" />
        </g>
      </svg>
    </div>
  );
}
