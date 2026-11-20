# Mods

Plunge is a small kernel (accounts, rooms, storage, the engine, the mod loader) plus mods.
A mod is a folder that adds something to the game through a small API. Core never
imports a mod; mods never reach into core except through that API.

## Layout

```
src/kernel/mod-api.ts      the only kernel module a mod may import
src/kernel/mods.ts         which mods are on (defaults, device, link)
src/kernel/Slot.tsx        <Slot name=… /> — where core leaves room for mods
src/kernel/advice.ts       the computer players' auction advice and its panels
src/kernel/store.ts        store(modId)
src/mods/index.ts          the list of mods (only src/kernel imports it)
src/mods/<id>/index.tsx    the mod's manifest
src/mods/<id>/…            everything else the mod needs, CSS included
```

To add a mod: make `src/mods/<id>/`, export a manifest from its `index.tsx`, and add it to
`MODS` in `src/mods/index.ts`. The folder name and the manifest's `id` must match.

## Manifest

```ts
export const myMod: ModManifest = {
  id: 'my-mod',            // also the folder name and the ?mods= word
  title: 'My mod',         // shown in More → Mods
  summary: 'One sentence.',// shown in the mod's row, beside its switch
  category: 'looks',       // which group it sits in (below)
  details: 'A paragraph.', // shown when the row is tapped open
  defaultOn: false,        // family mods ship dark; built-in features ship on
  scope: 'device',         // the only scope so far: each device decides
  slots: { 'table-above-hand': MyPart },
};
```

`details` says what the mod changes, anything it leaves alone, and where it came from in plain words
("From Rose's idea on the ideas board (#81)."). The row's details add the scope in words. Search in
More → Mods matches title, summary and details.

`category` is one of `MOD_CATEGORIES` in mod-api, shown in this order, each heading with its gist.
A category with no mods (or none matching the search) doesn't show.

| id | Heading | For |
| --- | --- | --- |
| `help` | Helpers | advice and counting while you play |
| `table` | At the table | how your hand and seats look and behave |
| `family` | Family tables | things that only matter in a shared room |
| `looks` | Looks and fun | art, animation and flourishes |
| `rules` | Rules of the game | variants the whole table plays by, set by whoever opens the table (none yet) |
| `players` | Computer players | how Walt and Zeb bid and play, set per table (none yet) |

## Slots

Component slots (`slots: { 'table-decor': MyPart }`):

| Slot | Where | Props |
| --- | --- | --- |
| `table-above-hand` | just above your hand | `{ game, seat }` |
| `table-decor` | over the felt (`position: relative`); place yourself, use `pointer-events: none` unless you mean to catch taps | `{ game, seat, ui: { menuOpen, historyOpen, sheetOpen, showingLast, review, scenario, proposal } }` |
| `seat-label` | after a seat's name, yours included | `{ game, viewer, seat, name, relation: 'you' \| 'partner' \| 'opponent' }` |
| `hand` | **replaces** your hand while you play (not while you sit out) | `{ game, seat, hand, legal, humanTurn, showHints, onPlay(id) }` |
| `bid-sheet`, `declare-sheet` | under the sheet's title | `{ game, seat, player: 'walt' \| 'zeb', bookSeat, showHints, sessionId, questionGameId, onQuestion(id) }` |
| `vote-heading` | above a shared table's vote text | `{ proposal, seat, mine, yes, more }` |
| `vote-status` | after your vote or the vote buttons | same |
| `gameover-header` | top of the game-over card | `{ game, seat, won }` |

Function slots, asked while core renders:

| Slot | Returns | Rule |
| --- | --- | --- |
| `seat-reveal` | `(SeatSlotProps) => boolean` | any enabled mod saying true shows that seat's hand face up |
| `seat-note` | `(SeatSlotProps) => string \| null` | words under a sitting-out hand; the first non-null wins, else core's |

Props are read-only data plus explicit callbacks. `seat` is the viewer's seat in `game` (always
the bottom of the table). A slot renders nothing when no mod that fills it is on, so a table with
no mods is the table as before. Slots read the enabled set without hooks; put hooks in your own
components. Derive what you need (a new deal, a trick ending, a quiet pause) from props in your own
hooks: there is no event bus.

`onPlay` already says "You must follow suit" for an illegal tile and plays a legal one; `onQuestion`
opens a saved question. `bookSeat` is the viewer's unrotated seat for Walt's bidding book.

**Precedence.** Adding slots render every enabled mod in `MODS` order (src/mods/index.ts).
Replacing slots (`REPLACING_SLOTS`: just `hand`) go to the first enabled mod in that order; the others
say in More → Mods that their part is not shown and which mod replaces it.

**Seat reveal is never asked at a shared table, or for your own seat.** Solo play holds every hand, so a
mod may show one (Nel-O sit-out). A shared table is a trusted family prototype: the room sends every hand
to every member today, but they are not the viewer's to see, so the kernel never reveals them there,
whatever a mod says. The predicate only chooses face up or down for tiles core already draws; it cannot
add tiles. Mods still receive the full `game`; don't read other seats' `hands` (the domino counter
counts public plays only).

## Stylesheets and theme

Import CSS from inside your folder. It is bundled whether or not your mod is on, so every selector must
start with your own class (`.my-mod…`) or be scoped under the attribute the kernel keeps on `<html>`:
`data-mods="bidding-hint my-mod"`, the enabled ids.

```css
:root[data-mods~="my-mod"] { --page-background-color: #6b1f1f; --page-background-image: none; }
:root[data-mods~="my-mod"] .vote-door .vote-yes { animation: my-mod-pulse 1s 2; }
```

`tests/mods.test.ts` fails on a selector that could leak. Prefix `@keyframes` names with your id too.

Theme variables on `:root`: `--page-background-color`, `--page-background-image` (the body),
`--felt-background` (the play area, `none` by default), plus the palette (`--cream`, `--butterscotch`,
`--teal`, …). Stable hooks: `.vote-bar` with `vote-<mode>` and `data-kind="<proposal kind>"`, `.vote-door`
for a knock, `.vote-yes`/`.vote-no`, `.seat-tag-partner`, `.seat-top`/`.seat-left`/`.seat-right`,
`.you-label`, `.felt`, `.hand`, `.card-win`/`.card-loss`.

## Built-in mods

Features core ships can be mods too, on by default (`defaultOn: true`) and using only this API.
`bidding-hint` fills `bid-sheet` and `declare-sheet` with Help me bid, from `waltAuctionAdvice`,
`zebAuctionAdvice`, `BookDetails` and `ForecastDetails` in mod-api. Its Show hints switch stays a
core setting, passed in as `showHints`.

## store(modId)

`store('my-mod')` gives `get(key)`, `set(key, value)` and `remove(key)` over JSON in this device's
localStorage, under `plunge:mod:my-mod:`. It never throws: private browsing and blocked or full storage
read as empty, and `set` returns false when nothing was saved.

## Turning mods on

1. Each manifest's `defaultOn`.
2. This device's choices: the switches in More → Mods.
3. The link, for this visit: `?mods=my-mod` turns it on, `?mods=-my-mod` off, `?mods=a,-b` both.
   Unknown ids are ignored. More → Mods says so at the top and in each linked row: "Keep it" at the top
   saves all the link's choices on the device, and in a row just that one.

To share a mod, send `https://<plunge host>/?mods=my-mod`.

## Growing the API

Anything two mods need moves into the kernel and is exported from `src/kernel/mod-api.ts`.
Anything one mod uses stays in that mod's folder. Add a slot only when a mod needs it.
docs-mods-coupling.md lists what is still tangled in core.

## The boundary test

`tests/mod-boundary.test.ts` fails when:

- a file outside `src/mods/` imports a mod folder, or anything but `src/kernel` imports `src/mods/index.ts`;
- a mod imports anything besides `preact`, `src/engine`, `src/kernel/mod-api.ts` and its own folder;
- a mod folder and the `MODS` list disagree.

Its message says what to do: move a shared need into the kernel, or keep a private one in the mod.
