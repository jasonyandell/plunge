/**
 * <Tally> — marks drawn the traditional way: the word ALL, stroke by stroke.
 * 7 strokes total (A = 3, L = 2, L = 2); n marks shows the first n strokes.
 */

const STROKES: readonly string[] = [
  'M6 24 L13 4', // A left leg
  'M13 4 L20 24', // A right leg
  'M9 16 L17 16', // A crossbar
  'M27 4 L27 24', // first L upright
  'M27 24 L37 24', // first L foot
  'M44 4 L44 24', // second L upright
  'M44 24 L54 24', // second L foot
];

export interface TallyProps {
  marks: number;
  label: string;
}

export function Tally({ marks, label }: TallyProps) {
  const n = Math.max(0, Math.min(STROKES.length, marks));
  return (
    <div class="tally" aria-label={`${label}: ${marks} mark${marks === 1 ? '' : 's'}`}>
      <span class="tally-label" aria-hidden="true">{label}</span>
      <svg viewBox="0 0 60 28" class="tally-svg" aria-hidden="true">
        {STROKES.slice(0, n).map((d, i) => (
          <path key={i} d={d} class="tally-stroke" />
        ))}
      </svg>
      <span class="tally-num" aria-hidden="true">{marks}</span>
    </div>
  );
}
