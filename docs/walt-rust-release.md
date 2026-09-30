# Shared Rust Walt release candidate

This release replaces the live player with `walt-table-v3` from the existing
Rust `walt-player` crate. The [core PR](https://github.com/jasonyandell/texas-42/pull/98)
contains the native/WASM implementation and its mathematical boundaries.
There is no C++ toolchain or extra Plunge engine choice.

The existing settings select Walt L2 (`[24,160]`, default) or Walt L1 (`[160]`).
Counts are inner to outer; delta is 1. Think deeper raises the outer count to
350. Straight 42 and Nel-O use the same Rust ladder. Nel-O keeps three active
seats, four physical hands, and its existing defender counterexample review.
The empirical bidding book is unchanged.

Only completed comparisons replace checkpoints. A 20-second decision budget
tries L1(8), L1 at the requested outer count, and then L2 when selected. Receipts
record requested and completed profiles, so an interrupted L2 request can retain
an explicitly identified L1 result. Cancellation discards the worker.

## Source and validation

The guarded importer rebuilt committed source
`fd5ce00f9371b5c2d43a0554e9c9e06555f8e4cf` with Rust 1.95.0 for
`wasm32-unknown-unknown`. The 6,397,446-byte artifact has SHA-256
`77345fed54159f03bcc17932b33a3a2886e78c5b681d0a348f34ca5b2a00174a`.
The [manifest](../src/ai/phone/manifest.json) records all build settings.

- Core: 11 Rust tests, scoped clippy, 58 native/WASM cases, and 20 bridge tests.
  The new Linux CI job also passes. The broad workspace gate is blocked by
  pre-existing formatting differences, as documented in the core PR.
- Plunge: 241 tests pass, including 957 public positions across 80 hands checked
  against the independent game engine, all declarations, bidder seats and bid
  extremes. The production build and Wrangler deployment dry run pass.
- Actual Chromium and WebKit workers complete straight and Nel-O L2 decisions,
  preserve expected choices, and cancel correctly. Home has no horizontal
  overflow at 320 or 390 CSS pixels. This is desktop browser testing.

On the M5 Max, the three complete L2 benchmark hands took 1.73, 1.78 and 3.03
seconds while the other tests ran. All finished within the 30-second whole-hand
limit. These are small portability measurements; they establish neither new
playing strength nor physical-phone throughput. WebGPU execution and real-device
timing remain future work.

The [retained evidence](walt-rust-release.json) includes the benchmark seeds,
browser versions, complete own-view requests, responses and timings. Reproduce:

```sh
PORTABLE_BENCH_OUTPUT=/tmp/walt-bench.json npx vitest run tests/portable.test.ts
npm run dev -- --port 5187
# In another terminal, with Playwright installed separately:
PLAYWRIGHT_MODULE=file:///path/to/playwright/index.mjs \
  WALT_SMOKE_OUTPUT=/tmp/walt-browser.json node scripts/smoke-walt-browser.mjs
# To test a built preview, also set WALT_SMOKE_URL=https://the-preview/
```

The smoke script discovers the deployed worker/WASM, verifies the WASM hash,
and exercises both contracts without adding a debug endpoint to the app.
