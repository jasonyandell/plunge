# Declaration pool

The mobile auction runs two independent Web Workers, or one when the browser
reports one logical processor. Each worker loads the shared Rust WASM once per
auction and takes the next declaration when it finishes. No shared memory,
threaded WASM toolchain, or new playing policy is involved.

The coordinator sends the same own-hand request, public seed and sample size to
every declaration job. Rust still creates the sample and prices the declaration.
Rust also merges all nine receipts, checking identity and sample size, rejecting
missing/duplicate declarations and applying the existing exact seeded tie.
Worker order cannot change the answer at a fixed completed sample size.

Each auction has one 20-second wall budget, including worker startup.
It completes all nine declarations at 4 worlds before starting 12, then 40 and 160.
Only a completed Rust merge replaces the saved survey. Timeout retains that
survey; leaving the position cancels every worker and discards the decision.
Infrastructure failures get one retry per job inside the same deadline. All
worker heaps are released at the end of the request. Ordinary play remains on
one worker. A quicker auction can finish more worlds and choose differently.

## Browser measurements

Mac embedded Chromium, three fixed hands, one run per hand/pool size, including
startup. The development harness uses the actual production coordinator and
worker. Each compared survey completed 4 then 12 worlds, with eight inner worlds.

| Workers | Hand A | Hand B | Hand C | Mean |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2.54 s | 4.91 s | 5.09 s | 4.18 s |
| 2 | 1.37 s | 2.82 s | 2.78 s | 2.32 s |
| 3 | 1.20 s | 1.84 s | 2.15 s | 1.73 s |
| 4 | 0.96 s | 1.68 s | 1.99 s | 1.54 s |

Every exact price, selected declaration and eligibility decision agreed. Two
workers were about 1.8x faster here. A preliminary 40-world Hand A survey took
13.23 / 7.16 / 5.18 / 4.32 seconds with 1 / 2 / 3 / 4 workers, also identical.
Hand B exceeded the 14-second test cap with one worker, retaining 12 worlds;
the comparison was then bounded at 12 worlds for all three hands.

These are small Mac timing checks, not Pixel measurements or strength evidence.
The conservative phone default remains two workers pending on-device timing,
memory and sustained-use observations. The same harness checks the bounded
production budget, a short deadline, cancellation and subsequent ordinary play.
Its fixtures and raw JSON output are at `/scripts/auction-pool.html` under the
development server. That page does not read saved games or ship in the app.

Local raw receipts: `/Users/jason/data/texas-42/auction-pool/browser.json` and
`browser-first.json`. Native/WASM/job/merge conformance and invalid receipt tests
are in the source repository's `walt/walt-player/auction-check.mjs`; host lifetime
and scheduling tests are in `tests/auction-pool.test.ts`.
