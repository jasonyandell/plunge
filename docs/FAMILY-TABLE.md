# The family table

Drop in, drop out, and decide things together without anyone hosting. This note
records the design behind `worker/rooms.ts`, `worker/room-votes.ts` and
`src/room/`. The rules of 42 are unchanged; see [RULES.md](RULES.md).

## One table

The shared table is the ordinary app, not a second screen. The store keeps the
coordinator's game rotated so you are seat 0 (`rotateGame`), so every screen
that reads a game state and the settings keeps working: hints, legal-domino
highlighting, questions, trick history, review, the Menu. `useRoom` owns what
differs: the socket, who runs Walt, routing your decisions (moves, next hand,
undo, start) to the room instead of the reducer, the chrome around the felt,
and recording history with canonical seats. The seat names every screen reads
are a live binding (`SEAT_NAMES`) that the room sets while it is open. The solo
save underneath is never written while a table is open; only the hints choice
travels home.

## Nobody hosts

The old room had a host: seat 0 ran Walt in their browser, only they could
start, shake or undo, and the table paused whenever any seated person was
disconnected. All three jobs are now derived from who is present, and nothing
about the host is stored.

- **Walt runner.** The lowest-numbered seated person who is connected runs Walt
  for every chair without a present person. Every client computes the same
  answer from the snapshot, and the coordinator enforces it on the `thinking`
  and on-behalf `action` commands, so no election protocol exists. If the
  runner drops mid-think, the next runner restarts that move.
- **Presence tiers.** A seat is *connected*, *rejoining* (disconnected for less
  than the twenty-second grace, the table waits), or *away* (Walt plays it until
  the person returns). Absence is measured from the seat's last known contact,
  which the coordinator keeps on the saved seat; the alarm fires when a grace
  expires so the runner's browser sees the flip.
- **Sitting down any time.** Joining mid-hand hands the newcomer the seat's
  dominoes. The first free chair in the order partner, left, right, seat 0 is
  taken. Leaving vacates the chair and retires its key; the chair becomes Walt's
  and anyone can sit there next.
- **Undo** still means the last *human* move. A move Walt made for an away
  person is not human, because the command came from the runner, not the seat.

## One vote at a time

Every change to the table is a proposal. The room holds at most one, settles it
as a pure function of the proposal, the people present and the clock, and then
applies the same effect code a direct command used to run. Walt never votes and
absent people never block; the target of a kick does not vote on it.

| Kind | Mode | Window | Needs |
|---|---|---|---|
| start, restart, undo, open, close | veto | 5 s | nobody says no |
| next hand | allow | 90 s | a second person (alone with Walt, just you) |
| kick | allow | 10 s | most of the table |

A knock is not on this list: see Doors.

- **Veto** proposals pass at the deadline unless someone says no, and pass early
  when everyone present has said yes. Alone with Walt, the proposer's own yes
  settles it at once, so solo play never waits.
- **Allow** proposals fail at the deadline unless enough yes votes arrive, and
  fail early on any no. The next hand is one of these on purpose: one person
  shaking must not take the result card away from people still reading it, so
  tapping **Shake the next hand** after someone else did counts as the second
  yes, and the ask quietly expires if nobody joins it.
- Votes are keyed to the proposal id rather than the table revision.
  The revision guard protects game moves against stale state; a vote's
  precondition is the proposal's identity, and two votes cast at the same
  revision must both count.
- Settling happens at the top of every command, on every presence change, and
  from the alarm at the deadline. Each settlement is one revision and leaves a
  `lastVote` on the snapshot so every screen can show what just happened.

The table is tuned in `VOTE_RULES` and nowhere else.

## Doors

An open table seats anyone with the link, as before. A closed table refuses the
join with `closed: true`; the browser then opens a visitor socket (no seat, no
key) and sends `knock`.

A knock is a doorbell, not a vote. It used to be an `admit` proposal, which
meant a knock during any other vote (most often the 90-second next hand) was
turned away, and a waiting knock held up the table's own votes. Now knocks sit
in their own list on the snapshot (`knocks`), next to whatever the table is
deciding. Anyone seated answers with `door` (**Let them in** / **Not now**);
the first answer decides, since one yes was all a knock ever needed. A yes
records an admission for that visitor for five minutes and the browser joins
again with its knock id.

A knock stands while its visitor's socket is open: there is no timer to beat,
and closing the app takes the knock away. If the knock goes missing (a dropped
connection) the browser rings again; while all four chairs are taken it waits
and rings when one opens. An answer stays on the list for five minutes so the
visitor can read it; **Knock again** after a "not now" rings fresh. Visitors
see snapshots while they wait.
A kicked or departed key reconnects to a socket that is closed with code 4003
and the reason on its first ping, so the browser can forget the seat instead of
reconnecting forever.

## Finding the table

Invite rooms are still random ids that expire after a day idle. Signed-in
accounts with family access (see [optional accounts](OPTIONAL-ACCOUNTS.md)) also
get the family's one standing table: `POST /api/rooms/family` finds its room id
in the `family_table` D1 row, opening a fresh room when none exists or the old
one expired, and seats the account. A standing table lives thirty days past its
last activity. Seats there are keyed to the account, so the same person on a
second device gets the same chair and key back; a browser cannot claim a chair
by naming an account, because the entry worker sets the identity header only
after checking the session and strips any copy a client sent. The header says
whether the account is family: a family member always has a chair at the standing
table, open or closed; any other signed-in account gets its own name, its own chair
back and its hands recorded, but meets the door like anyone else. The home screen
asks `GET /api/rooms/family` whether the person is family and what name they sit
under; anyone signed in skips the name prompt everywhere and sits under their
account name. Someone who sat down by name and signs in later keeps their chair:
the next socket connection carries the session, and the seat takes the account
and its name (`claimSeat`) unless that account already holds another chair.

**The list.** Anyone opening the app sees the tables that are live, and can sit
down at an open one or knock at a closed one, account or not: 42 is a social
game and a knock costs nothing. Which tables appear is the privacy rule. A table
is listed only when a signed-in family member opened it: the standing table, and
any invite room a member creates while signed in. A room opened without signing
in is private to its link, as before, so no stranger's game is shown to the
family and no family game is shown unless a member chose to open it. Because a
listed table is findable by anyone, it starts **closed**; the table votes it open
when it wants walk-ins (`open`, a five-second veto). The existing standing table
keeps whatever door state it had.

The index is a D1 row per listed table (`listed_tables`: room id, who opened it,
when), written by the entry worker on create. `GET /api/rooms/live` reads the
newest dozen rows and asks each room's coordinator for a `peek` (names, who is
connected, open, started, last activity), a request only the worker can make.
Rows expire on read, with no background job: a room the coordinator no longer
has answers 404 and its row is deleted in the same request, and one `DELETE` in
the same batch sweeps rows older than the longest room lifetime. The list shows
the standing table always (the home screen hides it from non-family while it is
empty), and other tables while someone is connected or for an hour after the
last activity. The home screen refreshes it every thirty seconds while visible.

## Not yet

- **Spectating.** Visitors receive snapshots but the screen only shows who is
  at the table while they knock.
- **Runner choice.** The lowest present seat may be the slowest phone. Walt's
  decisions are identical everywhere; only the wait differs.
- **Stats.** The room records every hand attempt itself the moment it ends,
  and the branch a takeback leaves, with each human seat's name and account
  (`roomHandEntry`, `docs/OPTIONAL-ACCOUNTS.md` → Stats). Each waits under its
  own storage key until the stats database takes it, so a failed write is
  retried on later activity. Database-free builds record nothing.
