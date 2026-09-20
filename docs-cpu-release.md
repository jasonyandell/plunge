# Portable CPU speedup release — 2026-09-20

This ships the existing Walt player with the validated CPU implementation enabled
in the single-threaded browser build. The shared Rust source is
`1dfd0e22f5fe2a2ee266f166493442547ad33834` in `jasonyandell/texas-42`.
The matching WASM SHA-256 is
`b3016e18e0b119a3967d42a901e51655e28176d3fce500f159501748de5a6fd4`.

The empirical bid book, 160-world opening/inspection, 40-world ordinary play,
partner-review allowance, and overall deadlines retain their previous settings.
Faster execution can complete more work before an existing deadline; that is
separate from equivalence of completed fixed comparisons. This is engineering
conformance evidence, not a new strength or bid-calibration result.

The importer uses a fresh target directory, locked dependencies and explicit
portable features (`--no-default-features --features cpu-speedups`). It clears
inherited native compiler flags, verifies committed sources before and after the
build, checks WASM host imports/exports, and records the compiler and profile.
The `walt-player-source-v2` digest also covers the embedded Scheme files that the
old importer's source-directory list missed. Exact build provenance is retained
with the watchdog receipt. CI checks the importer guards and the asset manifest.

Local release validation passed:

- Exact live-wrapper output comparisons at all 112 positions of four complete
  reference game histories: multiple seats, pip/doubles/no-trump, targets 30/36/42,
  160-world openings, 40-world later play, and completed partner reviews.
- Optimized and reference Rust suites, player contracts, and the exhaustive
  5,531,904-byte trick lookup validation.
- Native/WASM play and auction conformance, malformed input rejection, forced
  deadlines, retained completed checkpoints, and auction receipt validation.
- 201 app tests, four importer guard tests, typecheck/build and deploy dry-run.
- Mac Chrome at mobile viewport: complete hand, original decision receipts,
  Think Deeper, offline question saving, reload and next hand, with no JavaScript
  errors. Original 160-world opening wall time was 263 ms in that run; recheck
  completed in 315 ms. These are Mac measurements, not Pixel measurements.
- Renderer CPU throttling at 4x: 160-world comparison completed, forced timeout
  retained a legal checkpoint, terminated worker produced no later messages,
  and a pre-bid-book shared link opened and re-evaluated correctly. Peak WASM
  linear memory in that one deeper comparison was about 22 MB; this is not whole
  browser process memory.

The asset is 6,265,946 raw bytes (about 403 KB with local gzip). The compact binary
includes the validated completed-trick lookup and excludes standard-library debug
information. Production serving/caching and offline play are verified after
hosting; the research release record holds the final live evidence.

Rollback: revert this focused Plunge release commit through the same deployment
pipeline, restoring its matched prior manifest and WASM. The previous release was
`c7a1215d4d1ece0e24e13fef693ed17f55475112`; its recorded bid book remains intact.
