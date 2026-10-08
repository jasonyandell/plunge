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
| start, restart, next hand, undo, open, close | veto | 5 s | nobody says no |
| kick | allow | 10 s | most of the table |
| admit a knock | allow | 60 s | one yes |

- **Veto** proposals pass at the deadline unless someone says no, and pass early
  when everyone present has said yes. Alone with Walt, the proposer's own yes
  settles it at once, so solo play never waits.
- **Allow** proposals fail at the deadline unless enough yes votes arrive, and
  fail early on any no.
- Votes and knocks are keyed to the proposal id rather than the table revision.
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
key) and sends `knock`. The knock is an `admit` proposal; when it passes, the
coordinator records an admission for that visitor for five minutes and the
browser joins again with its knock id. Visitors see snapshots while they wait.
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
after checking the session and strips any copy a client sent. A closed family
table still asks: the home screen sends the signed-in person to the room, where
they knock like anyone else. The home screen asks `GET /api/rooms/family`
whether to show **Family table**, and otherwise remembers the last table this
browser sat at.

## Not yet

- **Spectating.** Visitors receive snapshots but the screen only shows who is
  at the table while they knock.
- **Runner choice.** The lowest present seat may be the slowest phone. Walt's
  decisions are identical everywhere; only the wait differs.
