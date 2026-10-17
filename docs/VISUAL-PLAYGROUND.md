# Visual playground

Open `/?demo=scifigoofy` for the combined family preview. The five steps cover
cherry blossoms, tandem shuffling, pause-time birdwatching, congratulations for
either winning team, and a proposed Bram mascot. The mascot is a labeled concept,
not an approved likeness or a decoration added to normal play.

Each step has a public permalink (`step=blossoms|shuffle|birdwatch|victory|bram`).
Sharing constructs a fresh URL from the origin, without copying incoming query
parameters, invite fragments, or account data. Native sharing falls back to a
copyable link. Feedback goes to the existing canonical family card; reading the
tour needs no account, while posting still uses normal production family access.
Each feature and the sample hand have a browser-local note, saved under
`plunge:scifigoofy-feedback:v1`. Nothing is uploaded automatically. Copy all
feedback collects the notes into one board-sized reply; a visible text fallback
works if clipboard access is unavailable. Storage failures explicitly ask the
reviewer to keep the page open and copy the notes. No cross-device sync is claimed.

The tour mounts a separate component before GameApp. It uses an actual legal
engine hand and a local reducer, without saves, history, stats uploads, room
connections or evidence capture. Visitors can play a sample hand, replay an
effect, pause the shuffle, compare blossoms and switch the winning team. Browser
Back and direct links select the named step. The normal game includes the four
implemented decorations together, with the existing reduced-motion behavior.

The original idea conversations and screenshots remain private. Consolidation
links them into one conversation rather than deleting their evidence.

Validation: full application suite, typecheck/build and hosted CI; browser checks
of each step, real tile play, replay, pause, both winning teams, deep links and
phone layout. This is browser validation, not physical-phone testing.
