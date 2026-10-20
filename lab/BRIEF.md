# Lab brief: Walt beyond 42

Shared brief for the `/lab/` game experiments (one builder per game). Read
`lab/WALT-CARD.md` first — it is the algorithm.

## Goal

For each game: a **minimal playable web version** where a human plays against Walt,
plus a **light head-to-head (h2h)** of Walt against standard algorithms, to test
Walt's strength in that domain cleanly. If a game turns out to be impractical for
Walt (cost, rules fit, or theory), say so plainly in the report — that is a result,
not a failure.

## Layout (one directory pair per game; touch nothing else)

- `public/lab/<game>/` — the deployed page. `index.html` plus plain ES modules (and an
  optional `.wasm`). No build step: Vite copies `public/` verbatim into `dist/`, served
  at `/lab/<game>/`. Use **relative** URLs for every asset. The AI runs in a Web
  Worker so the page never freezes. Mobile friendly (works at phone width).
- `lab/<game>/` — everything not deployed: the h2h harness (Node, importing the SAME
  engine modules from `../../public/lab/<game>/`, so browser and harness share one
  code path), any native/C sources, and `REPORT.md`.
- Do not name any file `*.test.*` or `*.spec.*` (Plunge's vitest would pick it up).
  Do not edit Plunge's `src/`, `package.json`, `vite.config.ts`, or anything outside
  your two directories. Do not `npm install` into Plunge; if you need packages, use a
  scratch directory outside the repo.

## Tooling facts on this machine

- 4 cores shared by six builders running in parallel: run h2h **single-process,
  one at a time**, and keep total h2h CPU modest (aim ≤ ~20–30 min per game).
- Node 22, Python 3.12, clang 18 with a working `wasm32` target (freestanding C →
  wasm, no libc). Rust is native-only (the wasm32 Rust target can't be downloaded).
  Plain JS with typed arrays/bitmasks is the recommended default; reach for C→wasm
  only if JS is too slow.
- Network: npm and PyPI are reachable (e.g. `endplay` on PyPI bundles the DDS
  double-dummy solver). Many other hosts are blocked; don't sink time into them.
- Texas-42 reference: `/home/user/texas-42/walt/` (Rust Walt, the fast core) and
  Plunge's `src/ai/walt/` (the wasm client). Ideas only — don't copy wholesale.

## Walt requirements

- Implement the card's `decide`/`value` faithfully: one action per information set for
  the decider across its sampled deals; modeled seats decide from their **own** chair
  with their own nested sample; bottom rung random legal. Live player = level 1.
- Respect the information rule: a decision reads only the decider's holding, the
  public record, and deal-independent noise. Sampling respects lawful constraints
  (hand sizes, revealed voids, public information like a dummy).
- Exact integer arithmetic for counts/values; no floats in the search's values.
- Where the game's objective is not binary (scores, chips, per-player points),
  generalize `outcome` to an integer payoff summed over deals, and say in the report
  exactly what objective Walt optimizes.
- Budget: **no more than a few seconds per move** in the browser on a phone-class or
  laptop CPU. Use the card's lawful levers (`n`, `n0`, horizon cut-off with random or
  cheap rollout beyond it, early exits, common random numbers). Report the settings
  and measured ms/move.

## H2H requirements

- Baselines: at least one standard algorithm for the domain (e.g. PIMC with an exact
  double-dummy / perfect-information solve per sampled world; flat Monte Carlo; a
  sensible rule-based bot; random as a floor).
- **Duplicate / mirrored** format: the same deals played twice with the sides swapped,
  so card luck cancels. Report counts, the mean difference, and a 95% interval.
  Fixed seeds; record the exact command to reproduce.
- "Light": tens to a few hundred deals, sized to the budget. A small honest sample
  beats a large unfinished one.

## Deliverable: `lab/<game>/REPORT.md`

Opening line `EXPLORATORY tier.` Then: rules variant implemented (and simplifications),
how the game maps onto Walt's seven-function interface, Walt settings, ms/move,
baselines, h2h table with intervals, reproduce commands, caveats, and a verdict
(practical / practical with caveats / impractical, and why).

## Process

- You may use the Agent tool with `model: "fable"` **at most two times** (e.g. for
  optimization help or a rules check). Give it a self-contained prompt.
- **Never end your turn with background work pending.** Run long jobs in the
  foreground (600 s tool timeout; split them) — a backgrounded job's completion is
  not delivered to you once you yield.
- Do **not** commit or push; the orchestrator integrates and commits.
- Verify the page loads and a full game plays end-to-end (Playwright with Chromium is
  preinstalled: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; a static server such as
  `python3 -m http.server` from `public/` works for testing). Report any console errors.
- Final message: a short summary — what was built, h2h headline numbers with
  intervals, ms/move, verdict, and anything left undone.
