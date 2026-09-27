/**
 * Walt's post-hoc reviews of your plays: a derived cache keyed by hand id and
 * versioned by analysis profile, stored beside the hand log
 * (src/records/storage.ts) and safe to recompute at any time.
 */
/** Walt's verdict on one of your play decisions (walt tile ids, 0–27). */
export interface PlyVerdict {
  /** Index into the hand's plays for this decision. */
  readonly ply: number;
  readonly played: number;
  readonly suggested: number | null;
  readonly forced: boolean;
  readonly playedChance: number | null;
  readonly bestChance: number | null;
  /** True when your play tied Walt's best estimate. */
  readonly playedBest: boolean;
}

export interface HandAnalysis {
  readonly schema: 'plunge-hand-analysis-v1';
  /** Matches the hand record's id. */
  readonly id: string;
  readonly profile: string;
  readonly plies: readonly PlyVerdict[];
  /** The contract is out of Walt's scope — nothing to score. */
  readonly unsupported: boolean;
}
