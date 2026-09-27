# Plunge data model

**Status: proposal (2026-09-27).** No player data exists in this format yet. It replaces
the on-device format in PR #7 before the first release, which is the point after which
changing it costs a migration.

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
  owner: 'device';            // the server attaches the owner hash; never sent in the body
  app: string;                // BUILD_ID (commit SHA; 'dev' for local builds)
  started: string; ended: string;         // ISO times
  outcome: 'finished' | 'abandoned';
  code: string;               // engine-validated replay code (src/engine/replay-code.ts)
  seats: [Seat0, Seat1, Seat2, Seat3];    // { kind: 'person' } | { kind: 'walt', walt: WaltRef }
  settings: { preset: string; hints: boolean; thinkDeeper: boolean; nello: boolean;
              comfort?: boolean };        // snapshot at the hand's start
  actions: ActionMeta[];      // one per action in the replay code, same order
  assist: AssistEvent[];      // hints displayed during the hand (never read by stats)
}

interface ActionMeta {
  at: number;                 // ms since `started`
  walt?: number;              // index into `profiles` when a computer made this move
  receipt?: string;           // digest of the decision receipt, when one exists
}
```

`HandRecord` also carries `profiles: WaltProfile[]`, the distinct Walt profiles used in
the hand, so each move references a small index rather than repeating the profile.

The existing `marksBefore`/`marksAfter` fields in PR #7 are dropped. They are derived
from the game's hands in order, and storing them creates a second authority.

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

Every Walt output (computer move, hint, review verdict) carries a `WaltRef`:

```ts
interface WaltRef { binary: string; profile: number }   // profile indexes HandRecord.profiles
interface WaltProfile {
  binary: string;             // walt id, below
  worlds: number; inner?: number; budgetMs: number;
  partner?: boolean; counterexamples?: { candidates: number; rounds: number; keep: number };
}
```

**Walt id** is `sha256` of the canonical JSON of the pinned manifest
(`src/ai/phone/manifest.json`). The manifest already includes the `wasm_sha256` of the
exact binary, the source commit and source hash, and the toolchain and build flags. The
id is therefore content-addressed:

- Two different binaries cannot share an id.
- A local or experimental build cannot present itself as a released one without being
  byte-identical to it.
- A released Walt can be rebuilt and checked from its manifest alone.

The deploy workflow registers each released manifest on the server (`walts` table, keyed
by id). A record naming an unregistered id is shown as *unreleased Walt*. It is kept,
never merged with a released one, and never counted on a leaderboard.

This meets the goal without signing keys. A signature would need a private key shipped
inside the app, which any player could extract. Content addressing, plus the server's
registry of released ids, gives the same "cannot be impersonated or confused" property
and has no key to leak. What a device *claims* Walt did remains a claim. A server can
spot-check it by replaying the recorded request against the registered binary. Checks
are exact for decisions that completed within their budget. Budget-cut anytime results
can legitimately differ between devices, so they are only checked for legality.

Native Mac players get ids the same way from their own build manifest, so they can never
be confused with the phone's WASM build.

## Hints: kept, never scored

Hint events are facts and are kept:

```ts
interface AssistEvent {
  at: number;                 // ms since hand start
  before: number;             // index of the action it preceded
  kind: 'move' | 'bid' | 'trump';
  evidence: HintEvidence;     // exactly what was shown (src/questions/hint-evidence.ts)
  walt?: WaltRef;
}
```

The firewall is enforced in the code, not left to convention:

- Stats and leaderboard code receive a `ScoredHand`, which is `HandRecord` without
  `assist` and without `settings.hints`. The projection functions do not accept the full
  record, so a stat cannot read hint use by accident.
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

- IndexedDB `plunge-records` has two stores, `hands` and `notes`, plus a derived store
  `reviews` for Walt's post-hoc play reviews (keyed by hand id and Walt id, safe to drop).
- Every record carries a `synced` flag. The existing notebook flush loop (on load, on a timer, on
  `online` and focus, after each save) uploads unsynced records.
- Hands: `PUT /api/hands/:id`. The server inserts or ignores. Hands never change, so a
  retry, a duplicate, or two tabs racing all yield one row, with no conflict handling.
- Notes: the existing revisioned `PUT` with compare-and-swap.
- Owner: the existing anonymous browser key (`ownerToken()` in
  `src/questions/storage.ts`), sent as a bearer token. The server stores only its hash.
- Sync failure is silent to play. The stats screen shows "n hands not yet backed up" and
  nothing more.

## Server schema

One schema for production and previews, in one D1 database per trust level (below):

```sql
CREATE TABLE hands (
  partition TEXT NOT NULL, id TEXT NOT NULL, owner_hash TEXT NOT NULL,
  schema TEXT NOT NULL, app TEXT NOT NULL, ended TEXT NOT NULL,
  body TEXT NOT NULL, received TEXT NOT NULL,
  PRIMARY KEY (partition, id));
CREATE TABLE notes (…same shape plus revision, answer, answered_at…);
CREATE TABLE walts (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, registered TEXT NOT NULL);
```

`partition` comes from the Worker's own configuration (`prod`, `pr-4`, …), never from the
request. Closing a PR marks its partition closed and deletes nothing.

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

## Changes to PR #7

1. Replace `plunge-hand-v1` with `plunge-hand-v2` above: random ids, seed, per-action
   times, seats with Walt refs, settings, abandoned hands, and hint events.
2. Remove the local `CONFIGS` map in `src/stats/replay.ts` and use `replay-code.ts`'s
   configuration lookup. The local map drops every Nel-O-preview hand after PR #4.
3. Give Nel-O hands defined treatment in each stat: partner sits out, and there are no
   assists or team make rate.
4. Stats projections take `ScoredHand` and add the hint-invariance test.
5. Walt agreement stays on the personal screen only.
6. Ship capture and sync in the Nel-O release. The dashboard can follow, since it is
   computed from the log and covers every hand from the first day.

## Open decisions

- Whether decision receipts (the full per-move Walt response) upload too, or stay on
  the device and upload on demand. The hand record keeps their digests either way.
- Whether an abandoned hand is recorded when the app is simply closed mid-hand and
  never resumed. The saved game is still resumable, so this proposal records only
  explicit abandonment.
- The retention and consent wording shown the first time sync runs.
