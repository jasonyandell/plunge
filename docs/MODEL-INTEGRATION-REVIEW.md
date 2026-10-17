# Player integration and recent PR review

Reviewed 2026-10-17 against `main` at `10b5dd3210602bf348fb673de9fa79bd19bdf002`
(merged Zeb PR #60). Scope: open PRs updated since approximately 2026-10-16
10:00 UTC, the preceding 36 hours. GitHub mergeability and checks are observations
at review time, not permanent guarantees. No other PR was merged or modified.

## Issues addressed by this integration

- Solo had Zeb selection, but family tables still ran Walt. The room now owns
  a voted, versioned selection; takeover and reconnect retain it. Stale package
  versions cannot submit decisions as the selected release.
- Move hints always ran Walt, Zeb forecast hints could not be saved, and question
  validation expected Walt-specific score phases. Advice now follows the player
  and saves the original evidence. A later Walt recheck is labeled separately.
- Hand history attached Walt's manifest even to Zeb hands. Executed action events
  now carry the actual character, policy, package and version, including passes,
  switches and Nel-O cover. Undo trims the current attempt without rewriting
  earlier evidence. Stats group exact recorded implementations; old versions
  remain unknown rather than being assigned today's version.
- Family receipts were ids into the runner's local database. Original receipts
  now travel with the room; other phones store their own correctly rotated view
  under a new id linked to the original. This supports original-score review and
  saved questions on all four seat orientations.
- Walt's family hints looked up the rotated seat instead of the catalogue seat.
  They now preserve the original lookup seat while presenting advice in the
  viewer's coordinates.
- Home, settings, table chairs, votes, errors, leave/rejoin messages, hints,
  review, hand summaries and account counts identify the relevant player.

## Open PR compatibility

| PR | Observed state | Integration finding / next action |
|---|---|---|
| [#62 visual showcase](https://github.com/jasonyandell/plunge/pull/62) | Conflicting; prior CI and preview passed | Highest overlap: `App`, `Table`, end sheets and CSS. Its `BidSheet`/`DeclareSheet` call sites predate Zeb and omit the player prop. Resolve onto current code, preserving player dispatch, family seat lookup, model badges and summary props. It already combines the visual ideas in #52–#55; avoid applying those changes twice. Retest both players in solo and family rooms. |
| [#56 screen idea capture](https://github.com/jasonyandell/plunge/pull/56) | Conflicting; prior checks passed | Its pause guards modify the old AI effects. Preserve Zeb's exclusion from Walt auction prewarming, the shared `computerAuction` dispatch, abort cleanup and generation checks when adding the overlay pause. Exercise opening/closing capture during a Zeb forecast and move. |
| [#58 idea dashboard](https://github.com/jasonyandell/plunge/pull/58) | Conflicting; prior checks passed | Crosses ideas, account navigation and preview access. Rebase over merged #59's recovery/deep-link work and #61's companion account entry. Preserve the model stats section when resolving Account. Preview grants need their own workflow verification; this is not needed to enable Zeb. |
| [#51 idea links](https://github.com/jasonyandell/plunge/pull/51) | Conflicting; prior checks passed | Overlaps #57 and merged #59. Compare the remaining behavior before resolving duplicate implementations. Preserve account return-to-idea navigation. |
| [#57 share/demo links](https://github.com/jasonyandell/plunge/pull/57) | Mergeable; checks passed | `IdeaLink.tsx` is identical to current main and its call sites already exist there. This is substantial overlap with merged work, not evidence that all remaining changes are needed. Its older Account tree lacks current idea-return and companion navigation. An ordinary merge may preserve these; replacing files with the branch version would regress them. Audit any residual delta before merging. |
| [#63 scoped KV provisioning](https://github.com/jasonyandell/plunge/pull/63) | Mergeable; checks passed | No player runtime overlap. Keep the current core/companions deployment-profile behavior introduced by #64. This is infrastructure work, independently reviewable from model integration. |
| [#50 red background](https://github.com/jasonyandell/plunge/pull/50) | Mergeable; checks passed | No model logic conflict found. Recheck badge/text contrast at phone widths if selected. |
| [#52 cherry blossoms](https://github.com/jasonyandell/plunge/pull/52), [#53 shuffle](https://github.com/jasonyandell/plunge/pull/53), [#54 victory art](https://github.com/jasonyandell/plunge/pull/54), [#55 birdwatch](https://github.com/jasonyandell/plunge/pull/55) | Mergeable; checks passed | Included in #62. Choose the combined route or individual changes deliberately. Preserve current Table/App/end-sheet props; animations must not obscure model labels, hints or voting controls. |
| [#48 Walt Bridge Deeper Probe](https://github.com/jasonyandell/plunge/pull/48) | Head `main`, base `walt-bridge-deep` | Updated because main moved. This is not an incoming model-selection change to main and should not be merged as one. |

These are integration findings, not full security or correctness reviews of each
unmerged feature. Passing checks on the old heads do not test their resolutions
against today's combined app. #49 and older untouched PRs fall outside this
time window.

## Boundary for the future cast

The registry separates a stable character from a versioned implementation.
Selections remain one player for all computer chairs. Adding profiles or assigning
different characters to each chair can use that boundary later without changing
old receipts. New packages still need a small adapter for their real API and
evidence format; version updates using the same API inherit the common UI,
history, stats and room wiring. See [ZEB.md](ZEB.md) for the integration checklist.

Chat companions from #61 remain identity-only, as their permission model says.
This work does not advertise them as playable opponents or grant game access.
