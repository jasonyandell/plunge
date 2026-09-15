# Bidding preparation: September 15 checks

Four workers, earlier calculation, and reusable completed surveys are implemented.
The bidding threshold remains 75%; no early-pass rule was enabled. The shared Rust
WASM asset and its playing/bidding math were not changed.

## Scheduling and conformance

- 194 tests passed, including preparation identity, preemption, deadlines, failures,
  changed targets, and the existing game/receipt suite. Production build passed.
- A 390-pixel browser flow with instrumented workers prepared all three computer
  seats while the human decided, never exceeded four live workers, retained normal
  bid pacing, completed an all-pass auction, and released every worker.
- Foreground declaration work began about 35 ms after the human passed in that
  scheduling check, overlapping the existing 550–790 ms minimum pause. The workers
  in this UI check were fakes, so this is scheduling evidence, not solver speed.
- Actual WASM: a fresh 12-world survey and continuation from a completed 4-world
  survey produced identical prices, declaration and eligibility. Rust rejected
  reuse after changing the target bid.

## Two versus four workers

Mac Chrome, three existing synthetic fixtures, 12 worlds per declaration, one run
per configuration. Order alternated 2/4 and 4/2. These runs followed the screening
study and had no other study jobs running. Startup is included.

| Fixture | Two workers | Four workers |
| --- | ---: | ---: |
| A | 1.36 s | 0.96 s |
| B | 2.82 s | 1.69 s |
| C | 2.77 s | 1.99 s |
| Mean | 2.32 s | 1.55 s |

Four workers reduced wall time by about 33% in this small check. Exact prices and
selected declarations agreed in every pair. This is Mac timing, not a Pixel or
iPhone measurement, and does not establish sustained-use performance.

## Early-pass study

Specification: synthetic games `auction-study/<seed>` for seeds 420930–420953;
initial bidder's own hand; cheapest opening bid 30; all nine declarations; four
workers; 20-second budget; completed 4/12/40/160-world checkpoints. The seed controls
both the generated deal and the existing public-seed mapping. Each completed seed
is saved independently by `scripts/auction-study.html` and can be resumed.

The 24 hands took 469.4 seconds of measured survey wall time in total. Nineteen
retained 40 worlds; five completed 160. Some early rows ran alongside validation
work, so completion rates and these timings are not an isolated performance trial.

The following exploratory early-pass rules were compared with each hand's deepest
completed survey:

| Rule: all declarations at or below | Comparable hands | Early passes | Missed deeper bids |
| --- | ---: | ---: | ---: |
| 1/3 at 12 worlds | 24 | 0 | 0 |
| 1/2 at 12 worlds | 24 | 0 | 0 |
| 1/2 at 40 worlds | 5 | 0 | 0 |
| 3/5 at 40 worlds | 5 | 0 | 0 |

All 24 deepest surveys recommended bidding. Their best declaration estimates ranged
from 84.375% to 100%. These are sampled model estimates, not measured success in
played games. A zero-miss result with zero triggers supplies no evidence that a
screen is safe: none saved time or affected a decision. This batch offers no reason
to enable conservative early-pass screening at bid 30. Higher bids, weaker samples
and a larger corpus remain possible follow-up experiments.

## Raw evidence

- [Worker timings](benchmark.json)
- [Screening surveys and checkpoints](study.json)
- [UI scheduling checks](ui-qa.json)
- [Fresh/resumed WASM comparison](continuation-qa.json)

The reusable worker conformance harness is `scripts/auction-pool.html`. The early-pass
study harness is development-only and does not ship as a game screen.
