# Plan: a small kernel and mods for everything else

Written 2026-10-31 from the whole-project review, the rules-config survey and the
idea-PR survey in this folder. Each step is one green PR; main stays shippable.

## Destination

**Kernel** (about 5–6k lines): engine, table session (reducer, rollback, one turn
driver), the computer-player contract, room comms, auth, storage, config, routes,
the mod loader. **Mods**: everything a person sees beyond the felt and the bid and
trump controls. Built-ins are default-on mods with no private privileges.

Three mod scopes:

- **device** — only this phone changes (helpers, looks, hand layout).
- **table** — the whole table plays by it; set by whoever opens the table, carried
  in room state, changed only by a vote that ends the current game. Rules of the
  game and computer-player variants live here.
- **built-in** — default on, extracted from core through the same API.

## Order

0. **Preview job split** (S, half a day). PR code runs in the job that later deploys
   with the Cloudflare token. Build and test in one job, deploy from a trusted
   checkout in another. Do this before anything else and before any more previews.
1. **Delete dead weight** (S, a day, about −3,500 lines). Unreachable AI
   (easy/medium/hard/evaluate/onyx/table/harness, the old Walt worker and wasm),
   `ui/Review.tsx`, the onyx model and dependency, the `'ai'` event and `Preset`,
   `PLUNGE_ROOMS`, the dead tests. Park MCP by making `worker/index.ts` the main entry.
   Turn test-file parallelism back on. Decisions for Jason: the Mac research
   transport (`NATIVE_TABLE`), the account and ideas walkthrough demos.
2. **Kernel config and cycle breaks** (S/M). `kernel/config.ts` for build id, mode
   and origin; seat math into `engine/view.ts`; one `worker/http.ts`; extend the
   boundary test to forbid `src → worker` and `ai → ui` edges.
3. **Table scope and gameplay mods** (M). Add `scope: 'table'`: the enabled set rides
   in `RoomState`, the server builds the config itself from base preset plus rule
   mods, a new vote kind changes it. Players declare capabilities per rule option and
   the table refuses an unsupported combination *before* the deal. A record header
   that encodes the rule set so saves, replay codes and stats keep working off the
   four presets. One `adjustComputerAction` hook for computer-player mods. Then:
   - `cheapest-last-bid` (Justin, #79) as the first computer-player mod;
   - `nello` becomes a rules mod (it is already `nello: 'open'` in config);
   - plunge, splash, sevens, forced-bid and doubles variants follow as the engine
     already implements them. Fix the no-trump doubles bug on the way (Walt and Zeb
     ignore `noTrumpDoubles` other than `high`).
4. **One turn driver and the player contract** (L). `kernel/players.ts` and
   `kernel/turns.ts`; solo, rooms and practice all call the same loop. Walt and Zeb
   register as players.
5. **Split `store.ts`** (M). Reducer, rollback and persistence apart; seat names as
   data; one undo; one history recorder.
6. **Redact at shared tables** (M). First cheap: mods get a `game` with other hands
   emptied when a room is active. Then per-socket room state on the server.
7. **Test harness swap** (S). `preact-render-to-string`; drop the no-hooks rule for
   slots; add the rooms browser script to CI.
8. **Routes, screens, home entries** (M) and **lazy mods** (S/M). One route table;
   `screen`, `home.entry`, `more.section`, `menu-item` slots; mods load with
   `import()` only when on, so a dark mod is truly inert.
9. **Extract the built-ins** in this order, each M: move-hint, question notebook,
   review, solo history, stats, family-table UI, account page, ideas board. After
   this `Table.tsx` is under 250 lines and `App.tsx` under 120.
10. **Kernel storage** (M): namespaced localStorage and IndexedDB with a registry;
    old names stay registered as-is, no migration.
11. **Auth owns family** (M): `family_members` in accounts; ideas joins accounts.
12. **Builder emits mod folders** (S once 8 lands): new fence, "blocked: needs slot X",
    merge dark plus a `?mods=` link; previews only for kernel PRs.

## Not mods

Sit in any seat and vote to reshuffle (room rules, full-fork lane). Send a hand to
another player, avatars, deal policy, the ideas-page cards (infrastructure). The
#62 tour harness.

## Known gaps to say out loud

- The mod boundary checks imports only. Mods share the realm: they can fetch, read
  any storage key and see the full game. Family trust is the fence until step 6.
- Family mods are merged dark but still load; step 8 makes them inert.
