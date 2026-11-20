import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../../engine';
import type { DecorSlotProps } from '../../kernel/mod-api';
import './shuffle.css';

export const FLOURISH_MS = 2800;

/** Same tiles in the same seats is the same deal: replays and undos into bidding don't count. */
export const dealKey = (g: GameState): string => `${g.handNumber}:${g.dealt.map(hand => hand.join('.')).join('|')}`;
/** A table opened on an untouched deal counts as a new one; one already bid on does not. */
export const firstSeen = (g: GameState): string | null => g.phase === 'bidding' && g.bids.length === 0 ? null : dealKey(g);
export const shuffleShown = ({ game, ui }: DecorSlotProps): boolean => game.phase === 'bidding' && !ui.scenario && !ui.review;
/** Start the flourish: a deal this table has not seen yet, while it may show. */
export const startsFlourish = (seen: string | null, p: DecorSlotProps): boolean => shuffleShown(p) && dealKey(p.game) !== seen;

/** Presentation only: never holds up a deal or a bid. */
export function Flourish(p: DecorSlotProps) {
  const deal = dealKey(p.game), eligible = shuffleShown(p);
  const seen = useRef(firstSeen(p.game));
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const start = startsFlourish(seen.current, p);
    seen.current = deal;
    if (start) setActive(deal);
    else if (!eligible) setActive(null);
  }, [deal, eligible]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(null), FLOURISH_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return eligible && active === deal ? <ShufflePicture key={deal} /> : null;
}

/** Original vector characters inspired by the family's cheerful tandem couple. */
export function ShufflePicture() {
  return <div class="shuffle-flourish" aria-hidden="true">
    <svg viewBox="0 0 240 120" focusable="false">
      <ellipse cx="120" cy="76" rx="83" ry="29" fill="none" stroke="#b8d884" stroke-opacity=".35" stroke-dasharray="3 6" />
      <g class="shuffle-flourish-pile" fill="#fff5db" stroke="#765637" stroke-width="1.5">
        {[[97, 62, -26], [117, 56, 18], [131, 70, 40], [110, 78, -12], [93, 79, 23]].map(([x, y, angle], i) =>
          <g key={i} transform={`translate(${x} ${y}) rotate(${angle})`}>
            <g class="shuffle-flourish-tile" style={{ animationDelay: `${i * -120}ms` }}>
              <rect x="-8" y="-15" width="16" height="30" rx="3" />
              <path d="M-6 0H6" />
              <circle cy="-7" r="1.5" fill="#765637" />
              <circle cx="-3" cy="5" r="1.5" fill="#765637" />
              <circle cx="3" cy="10" r="1.5" fill="#765637" />
            </g>
          </g>)}
      </g>
      <g class="shuffle-flourish-bike">
        <g stroke="#513c30" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <g fill="#fff5db">
            <circle cx="-34" cy="0" r="12" /><circle cx="36" cy="0" r="12" />
          </g>
          <g class="shuffle-flourish-spokes" fill="none" stroke="#a68b65" stroke-width="1">
            <path d="M-46 0H-22M-34-12V12M24 0H48M36-12V12" />
          </g>
          <path d="M-34 0L-21-23L-6 0H36L21-26L8 0L-7-23H-21M-21-23L21-26M-34 0H-6M36 0L20-34H27" fill="none" stroke="#efc746" stroke-width="3" />
          <path d="M-27-25H-17M-12-25H-2" fill="none" />
          <path d="M-26-36L-30-22L-16-14L-20-3" fill="none" stroke="#f0a34c" stroke-width="8" />
          <path d="M3-37L-1-23L13-15L8-3" fill="none" stroke="#a79aab" stroke-width="8" />
          <path d="M-30-51L-20-49L-14-29L-32-29Z" fill="#f28da8" />
          <path d="M0-50L10-48L15-29L-3-29Z" fill="#79d3df" />
          <path d="M-22-43L-10-35H-4M8-43L20-35H25" fill="none" stroke="#ffd9bb" stroke-width="5" />
          <g fill="#ffdec3">
            <circle cx="-25" cy="-61" r="15" /><circle cx="7" cy="-61" r="15" />
          </g>
          <path d="M-40-60Q-46-68-38-73Q-39-83-30-79Q-23-86-18-78Q-7-79-9-68Q-22-66-25-72Q-30-63-40-60Z" fill="#fffaf0" />
          <path d="M-7-66Q-14-70-10-58M21-66Q28-70 23-57" fill="none" stroke="#fffaf0" stroke-width="6" />
          <g fill="none" stroke-width="1.5">
            <circle cx="-31" cy="-61" r="5" /><circle cx="-18" cy="-61" r="5" /><path d="M-26-61H-23" />
          </g>
          <path d="M-4-65H5V-57H-4ZM10-65H19V-57H10ZM5-62H10" fill="none" stroke="#b84d47" />
          <g fill="#513c30" stroke="none">
            <circle cx="-30" cy="-60" r="1.6" /><circle cx="-17" cy="-60" r="1.6" />
            <circle cx="1" cy="-61" r="1.6" /><circle cx="15" cy="-61" r="1.6" />
          </g>
          <path d="M-29-52Q-24-46-19-52" fill="#bf5c64" />
          <path d="M1-52Q7-59 14-52Q7-48 1-52Z" fill="#fffaf0" stroke-width="1" />
        </g>
      </g>
    </svg>
  </div>;
}
