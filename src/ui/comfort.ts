/** Optional touch preferences. Missing fields migrate without losing a saved game. */
export interface ComfortSettings {
  readonly enabled: boolean;
  readonly repeatTapMs: 0 | 300 | 600;
  readonly pauseAfterTrick: boolean;
  readonly reduceMotion: boolean;
}

export const DEFAULT_COMFORT: ComfortSettings = {
  enabled: false, repeatTapMs: 300, pauseAfterTrick: true, reduceMotion: true,
};

export function comfortSettings(value: unknown): ComfortSettings {
  const p = value && typeof value === 'object' ? value as Partial<ComfortSettings> : {};
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_COMFORT.enabled,
    repeatTapMs: p.repeatTapMs === 0 || p.repeatTapMs === 300 || p.repeatTapMs === 600
      ? p.repeatTapMs : DEFAULT_COMFORT.repeatTapMs,
    pauseAfterTrick: typeof p.pauseAfterTrick === 'boolean' ? p.pauseAfterTrick : DEFAULT_COMFORT.pauseAfterTrick,
    reduceMotion: typeof p.reduceMotion === 'boolean' ? p.reduceMotion : DEFAULT_COMFORT.reduceMotion,
  };
}

/** Ignore quick additional pointer clicks, including clicks on newly revealed controls.
 * Keyboard/assistive activations have detail=0 and are never delayed. No hold required.
 * Measure from the last accepted tap so a stream of tremor taps cannot lock the UI.
 */
export class RepeatTapGuard {
  private lastAccepted = -Infinity;
  accept(now: number, detail: number, delayMs: number): boolean {
    if (detail === 0) return true;
    if (now - this.lastAccepted < delayMs) return false;
    this.lastAccepted = now;
    return true;
  }
}
