# Plunge data model

**Status (2026-09-27): hands, Walt identity, the hint firewall and hand sync are
implemented** (`src/records/`, `migrations/0002_records.sql`, `PUT /api/hands/:id`). Notes,
the shared previews database, logins and the leaderboard are designed here and not yet
built. The authoritative record types are in `src/records/model.ts`; the sketches below
summarize them.

## Goals

1. **Lose nothing that cannot be recomputed.** Every hand a person plays, every question
   or note they leave, and what Walt showed them are kept, on the device first and on the
   server when a connection allows.
2. **Stats, leaderboards and reviews are views.** They are computed from the kept
   records, versioned, and recomputed over the whole history whenever their formulas
   change.
3. **Hints are kept but never scored.** No stat, leaderboard or badge reads whether,
   when or how often a hint was used (see [Hints](#hints-kept-never-scored)).
4. **Walt is identified exactly.** Every computer move, hint and review names the Walt
   that produced it, in a way that cannot be confused with or claimed by another build.
5. **One data model everywhere.** Production and every PR preview use the same schema;
   a preview is a partition, not a separate database.

## Facts versus views

| Kept (facts) | Computed (views) |
|---|---|
| Deal, game seed, every action in order | Scores, marks, who won |
| When each action happened | Time per decision |
| Who sat where: the person, or which Walt | Partner assists, sets, sweeps |
| Settings in force during the hand | Bid make rates, trump splits |
| Hints displayed and their evidence | Walt's post-hoc review of each play |
| Notes and questions | Leaderboards |
| App build and Walt identity | Anything invented later |

A view never writes into a fact. A fact is never recomputed.

## Records

Two record kinds cover play and feedback. Both carry random, globally unique ids, so
records from several devices can be merged under one login without collisions.

### Hand: written once, never changed

Written when a hand finishes, or when it is abandoned (a new game started, a resumed
save discarded). The replay code already encodes an unfinished hand.

```ts
interface HandRecord {
  schema: 'plunge-hand-v2';
  id: string;                 // random 128-bit hex
  game: { id: string;         // random per game, shared by its hands
          seed: string;       // the game's RNG seed; deals derive from it
          hand: number };     // hand number within the game
  app: string;                // BUILD_ID (commit SHA; 'dev' for local builds)
  started: string; ended: string;         // ISO times
  outcome: 'finished' | 'abandoned';
  marksBefore: [number, number];          // game score when the hand began
  code: string;               // engine-validated replay code (src/engine/replay-code.ts)
  seats: SeatRecord[4];       // { kind: 'person' } | { kind: 'computer', player, walt }
  settings: SettingsEntry[];  // settings from `at` ms onward; the first entry is at 0
  profiles: WaltProfile[];    // distinct computer profiles used in the hand
  actions: ActionMeta[];      // one per action in the replay code, same order
  assist: AssistEvent[];      // hints displayed during the hand (never read by stats)
}

interface ActionMeta {
  at: number | null;          // ms since `started`; null for actions before recording began
  by: 'person' | 'computer';  // checked against the seat whose turn it was
  profile?: number;           // index into `profiles` for a computer move
  receipt?: string;           // digest of the Walt decision receipt, when one exists
}
```

The owner is never in the body: the server attaches the hash of the uploading browser's
key. `marksAfter` and "game over" are derived from `marksBefore` and the replay's result.
`marksBefore` itself stays a stored fact, because it cannot be derived when earlier hands
of the game went unrecorded (a game saved before this release, say).

A game saved before recording existed is adopted when play resumes: its earlier actions
are kept with `at: null` rather than dropped. If a journal ever disagrees with the
replay's length, the hand is still kept, with every timing marked unknown rather than
misaligned. An abandoned hand with no actions is only a deal and is not recorded.

### Note: revisioned

The question notebook generalized. It keeps the notebook's revision/compare-and-swap
rule: original evidence is fixed, and later fields (note text, attached finished hand,
answer) can be added.

```ts
interface NoteRecord {
  schema: 'plunge-note-v1';
  id: string;
  anchor: { hand?: string; ply?: number; screen: string };
  kind: 'move' | 'hint' | 'idea' | 'bug' | 'other';
  body: string;               // may be empty: a one-tap flag is a note too
  evidence?: unknown;         // today's question payloads fit here unchanged
  app: string; created: string;
}
```

The pervasive feedback affordance writes one of these from any screen. It fills
`anchor` and `app` itself and makes the text optional. Existing `plunge-question-v1/v2`
records remain readable and are presented as notes. They are not rewritten.

## Walt identity

Every computer seat names its Walt build, and every computer move names the profile it
was decided with:

```ts
interface WaltProfile {
  source: 'play' | 'auction' | 'heuristic';
  player: string;             // e.g. 'l1-default', 'walt-auction', 'bid-book:<id>:<profile>'
  walt: string | null;        // walt id, below; null when unidentified
  worlds: number | null; budgetMs: number | null; mode: string | null;
  counterexamples: boolean;   // the Nel-O counterexample pass ran
}
```

Profiles are read from the decision itself (the receipt's response), so Think deeper,
counterexample defense and budget cuts show up as they actually ran.

A move hint's saved evidence already carries its decision's implementation manifest.
Walt's post-hoc reviews are cached under a profile that includes the Walt id, so a new
build re-reviews history rather than mixing verdicts from two builds.

**Walt id** is `sha256` of the canonical JSON of the pinned manifest
(`src/ai/phone/manifest.json`). The manifest already includes the `wasm_sha256` of the
exact binary, the source commit and source hash, and the toolchain and build flags. The
id is therefore content-addressed:

- Two different binaries cannot share an id.
- A local or experimental build cannot present itself as a released one without being
  byte-identical to it.
- A released Walt can be rebuilt and checked from its manifest alone.

Each deployment registers the Walt it serves: the Worker hashes its bundled manifest the
same way and records it in `walts` under its own partition. A Walt present in the `prod`
partition was released. A record naming any other id is shown as *unreleased Walt*. It
is kept, never merged with a released one, and never counted on a leaderboard.

This meets the goal without signing keys. A signature would need a private key shipped
inside the app, which any player could extract. Content addressing, plus the server's
registry of released ids, gives the same "cannot be impersonated or confused" property
and has no key to leak. What a device *claims* Walt did remains a claim. A server can
spot-check it by replaying the recorded request against the registered binary. Checks
are exact for decisions that completed within their budget. Budget-cut anytime results
can legitimately differ between devices, so they are only checked for legality.

The Mac research table runs a separately built native player that has no manifest of
its own yet. Its seats are recorded with `walt: null` (unidentified), never with the
phone build's id. Giving the native build its own manifest, hashed the same way, is the
follow-up that identifies it.

## Hints: kept, never scored

Hint events are facts and are kept:

```ts
interface AssistEvent {
  at: number;                 // ms since hand start
  before: number;             // index of the action it preceded
  evidence: HintEvidence;     // exactly what was shown (src/questions/hint-evidence.ts)
}
```

The firewall is enforced in the code, not left to convention:

- Stats and leaderboard code receive a `ScoredHand`: an allowlist of `id`, `game`
  (without the seed), `ended`, `outcome`, `marksBefore`, `code` and `seats`. It has no
  hint events, no settings (which include the hints switch) and no timings. A field added
  to `HandRecord` stays out until it is deliberately listed. The projection functions
  do not accept the full record, so a stat cannot read hint use by accident.
- A test runs every stats projection on the same hands with and without hint events and
  with hints on and off. The outputs must be byte-identical.
- Research and training exports read the full record. They are a separate code path and
  never render in the app's stats or leaderboard screens.

A subtler leak: someone who plays with hints on will agree with Walt more often.
**Walt-agreement numbers are therefore personal-only.** They appear on your own stats
screen and never on a shared leaderboard or anywhere two people's numbers sit side by
side. Leaderboards use outcomes only (below).

Hints can also be recomputed in the background at any time from the replay. The
recorded evidence is what was *actually shown*, which is the fact worth keeping. A
recomputation is a view with its own Walt id.

## Device storage and sync

- IndexedDB `plunge-records` has a `hands` store and a derived `reviews` store for
  Walt's post-hoc play reviews (versioned by analysis profile, safe to drop). Notes will
  join it; today they are still the question notebook's own store.
- The open hand's journal and any closed records not yet in IndexedDB are saved with
  the game, so a reload or crash between closing a hand and writing it loses nothing.
- Every record carries a `synced` flag. The existing notebook flush loop (on load, on a timer, on
  `online` and focus, after each save) uploads unsynced records.
- Hands: `PUT /api/hands/:id`. The server inserts or ignores. Hands never change, so a
  retry, a duplicate, or two tabs racing all yield one row, with no conflict handling.
- Notes: the existing revisioned `PUT` with compare-and-swap.
- Owner: the existing anonymous browser key (`ownerToken()` in
  `src/questions/storage.ts`), sent as a bearer token. The server stores only its hash.
- Sync failure is silent to play. A record the server rejects stays on the device,
  unsynced. It never blocks the others.

## Server schema

One schema for production and previews, in one D1 database per trust level (below):

```sql
-- migrations/0002_records.sql (built)
CREATE TABLE hands (partition, id, owner_hash, schema, app, game_id, hand_number,
  outcome, started, ended, body, received, PRIMARY KEY (partition, id));
CREATE TABLE walts (partition, id, manifest, registered, PRIMARY KEY (partition, id));
-- later
CREATE TABLE notes (…hands' shape plus revision, answer, answered_at…);
```

The server validates every hand with the same `validHand` the app uses: the replay must
decode and re-simulate, there must be one action entry per replay action, and each
entry's `by` must match the seat whose turn it was.

`partition` comes from the Worker's own configuration, never from the request:
`PARTITION = "prod"` in `wrangler.toml`, and `pr-N` in each generated preview
configuration. Today each preview still has its own database, deleted when its PR
closes. Once previews share one database (below), closing a PR marks its partition
closed and deletes nothing.

Production and previews use two databases rather than one: preview code is untrusted
branch code, so it must not hold a binding to production data. Every preview shares the
previews database, partitioned by PR. Migrations are additive only (add columns and
tables, never rename or drop), because every open preview shares the schema.

Existing `questions` rows migrate into `notes` once, with `partition = 'prod'`.

## Logins (later)

`accounts(id, name)` and `account_owners(owner_hash, account_id)`. Signing in links the
current browser key to an account, and linking a second device adds a second row.
Nothing is copied or rewritten. Random record ids make the union collision-free.
Signing out unlinks and deletes nothing.

## Leaderboard (later)

A server-side view over `hands` in the `prod` partition, grouped by account:

- The Worker replays each `code` with the shared engine (already bundled there for
  question evidence). A hand the engine rejects does not count.
- Only hands against registered Walt ids count, and only person-versus-Walt seatings
  the leaderboard defines (for example, one person with three Walts of the same id).
- Metrics are outcomes only: games won, marks per hand, contracts made. Nothing reads
  `assist`, `settings.hints` or Walt agreement.
- The formula is versioned. Changing it recomputes the whole board from history.
- Optionally, deals are checked against the game seed so a person cannot cherry-pick
  deals. Recording the seed now keeps that option open.

## Implementation status

Built on top of PR #7's dashboard:

1. `plunge-hand-v2` records with random ids, seed, per-action timing, seats and
   profiles stamped with the Walt id, settings history, abandoned hands, and hint events.
   They are written through a journal in the table's reducer (`src/records/journal.ts`,
   `recordTransition` in `src/ui/store.ts`), on an injectable clock.
2. Replays use each hand's own rules (`src/stats/replay.ts`), which fixes the dropped
   Nel-O hands.
3. Nel-O hands count for marks and bidding, but not for count, sweeps or partner play.
   The sample slate plays the straight house game.
4. Stats read `ScoredHand` only, and a test holds every stat identical with hints added,
   removed or switched off.
5. Walt agreement stays on the personal stats screen.
6. Hands upload to `PUT /api/hands/:id`, partitioned and write-once.

Next: notes (the feedback button), the shared previews database, logins, the leaderboard.

## Open decisions

- Whether decision receipts (the full per-move Walt response) upload too, or stay on
  the device and upload on demand. The hand record keeps their digests either way.
- Whether an abandoned hand is recorded when the app is simply closed mid-hand and
  never resumed. The saved game is still resumable, so this proposal records only
  explicit abandonment.
- The retention and consent wording shown the first time sync runs.
