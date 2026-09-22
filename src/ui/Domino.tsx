/**
 * <Domino> — a single crisp SVG domino tile.
 * Face up or down, vertical (hand) or horizontal (trick), real pip layouts,
 * divider bar, rounded corners. Count dominoes get a gold accent.
 * Sized entirely by CSS (the wrapper has an aspect-ratio), so the same
 * component serves 46px hand tiles and 20px opponent minis.
 */

import type { DominoId } from '../engine';
import { countValue, fromId } from '../engine';
import './domino.css';

const PIP_WORDS = ['blank', 'one', 'two', 'three', 'four', 'five', 'six'] as const;

/** Pip centers for a 100×100 half, vertical orientation. */
function pipCenters(n: number): readonly (readonly [number, number])[] {
  const L = 26;
  const C = 50;
  const R = 74;
  switch (n) {
    case 1: return [[C, C]];
    case 2: return [[L, L], [R, R]];
    case 3: return [[L, L], [C, C], [R, R]];
    case 4: return [[L, L], [R, L], [L, R], [R, R]];
    case 5: return [[L, L], [R, L], [C, C], [L, R], [R, R]];
    case 6: return [[L, L], [L, C], [L, R], [R, L], [R, C], [R, R]];
    default: return [];
  }
}

export function dominoAriaLabel(id: DominoId): string {
  const d = fromId(id);
  const name =
    d.high === d.low
      ? `double ${PIP_WORDS[d.high]}`
      : `${PIP_WORDS[d.high]}-${PIP_WORDS[d.low]}`;
  const count = countValue(d);
  return count > 0 ? `${name}, worth ${count}` : name;
}

interface HalfProps {
  n: number;
  dx: number;
  dy: number;
  transpose: boolean;
}

function Half({ n, dx, dy, transpose }: HalfProps) {
  return (
    <g transform={`translate(${dx} ${dy})`}>
      {pipCenters(n).map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={transpose ? y : x}
          cy={transpose ? x : y}
          r={10}
          class="dom-pip"
        />
      ))}
    </g>
  );
}

export interface DominoProps {
  id?: DominoId | undefined;
  faceDown?: boolean | undefined;
  orientation?: 'v' | 'h' | undefined;
  /** legal: lifted + tappable; illegal: dimmed + inert; idle: plain. */
  state?: 'idle' | 'legal' | 'illegal' | undefined;
  selected?: boolean | undefined;
  onTap?: (() => void) | undefined;
  className?: string | undefined;
}

export function Domino({ id, faceDown, orientation = 'v', state = 'idle', onTap, className, selected }: DominoProps) {
  const horiz = orientation === 'h';
  const w = horiz ? 200 : 100;
  const h = horiz ? 100 : 200;
  const d = !faceDown && id ? fromId(id) : null;
  const isCount = d !== null && countValue(d) > 0;

  const face = faceDown ? (
    <svg viewBox={`0 0 ${w} ${h}`} class="dom-svg" aria-hidden="true">
      <rect x={3} y={3} width={w - 6} height={h - 6} rx={14} class="dom-back" />
      <rect x={12} y={12} width={w - 24} height={h - 24} rx={9} class="dom-back-inner" />
      <circle cx={w / 2} cy={h / 2} r={8} class="dom-back-dot" />
    </svg>
  ) : d ? (
    <svg viewBox={`0 0 ${w} ${h}`} class="dom-svg" aria-hidden="true">
      <rect x={3} y={3} width={w - 6} height={h - 6} rx={14} class="dom-face" />
      {isCount && (
        <rect x={6.5} y={6.5} width={w - 13} height={h - 13} rx={11} class="dom-count-ring" />
      )}
      {horiz ? (
        <line x1={100} y1={14} x2={100} y2={86} class={isCount ? 'dom-bar gold' : 'dom-bar'} />
      ) : (
        <line x1={14} y1={100} x2={86} y2={100} class={isCount ? 'dom-bar gold' : 'dom-bar'} />
      )}
      <Half n={d.high} dx={0} dy={0} transpose={horiz} />
      <Half n={d.low} dx={horiz ? 100 : 0} dy={horiz ? 0 : 100} transpose={horiz} />
    </svg>
  ) : null;

  const cls = [
    'dom',
    horiz ? 'dom-h' : 'dom-v',
    `dom-${state}`,
    faceDown ? 'dom-down' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (onTap && state === 'legal') {
    return (
      <button type="button" class={cls} aria-pressed={selected} aria-label={id ? dominoAriaLabel(id) : 'domino'} onClick={onTap}>
        {face}
      </button>
    );
  }
  return (
    <div
      class={cls}
      role="img"
      aria-label={faceDown ? 'face-down domino' : id ? dominoAriaLabel(id) : 'domino'}
    >
      {face}
    </div>
  );
}
