# Mods

Plunge is a small kernel (accounts, rooms, storage, the engine, the mod loader) plus mods.
A mod is a folder that adds something to the game through a small API. Core never
imports a mod; mods never reach into core except through that API.

## Layout

```
src/kernel/mod-api.ts      the only kernel module a mod may import
src/kernel/mods.ts         which mods are on (defaults, device, link)
src/kernel/Slot.tsx        <Slot name=… /> — where core leaves room for mods
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
  summary: 'One sentence.',// shown under the switch
  defaultOn: false,        // family mods ship dark
  scope: 'device',         // the only scope so far: each device decides
  slots: { 'table-above-hand': MyPart },
};
```

## Slots

| Slot | Where | Props |
| --- | --- | --- |
| `table-above-hand` | the table, just above your hand | `{ game: GameState, seat: Seat }` |

Props are read-only. `seat` is the viewer's seat in `game` (always the bottom of the table).
A slot renders nothing when no mod that fills it is on, so a table with no mods is the table as before.

## store(modId)

`store('my-mod')` gives `get(key)`, `set(key, value)` and `remove(key)` over JSON in this device's
localStorage, under `plunge:mod:my-mod:`. It never throws: private browsing and blocked or full storage
read as empty, and `set` returns false when nothing was saved.

## Turning mods on

1. Each manifest's `defaultOn`.
2. This device's choices: the switches in More → Mods.
3. The link, for this visit: `?mods=my-mod` turns it on, `?mods=-my-mod` off, `?mods=a,-b` both.
   Unknown ids are ignored. "Keep it" in More → Mods saves the link's choice on the device.

To share a mod, send `https://<plunge host>/?mods=my-mod`.

## Growing the API

Anything two mods need moves into the kernel and is exported from `src/kernel/mod-api.ts`.
Anything one mod uses stays in that mod's folder. Add a slot only when a mod needs it.

## The boundary test

`tests/mod-boundary.test.ts` fails when:

- a file outside `src/mods/` imports a mod folder, or anything but `src/kernel` imports `src/mods/index.ts`;
- a mod imports anything besides `preact`, `src/engine`, `src/kernel/mod-api.ts` and its own folder;
- a mod folder and the `MODS` list disagree.

Its message says what to do: move a shared need into the kernel, or keep a private one in the mod.
