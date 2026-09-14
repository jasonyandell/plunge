# Sunshine on the phone and Mac

The default hosted app is the shared Rust Walt player in a Web Worker: fixed
L1 40/8, optionally followed by the existing partner count-offer check. Pixel 9
with Chrome is the first target. Native and browser use the same decision
procedure; no server or account is needed to play the phone version.

Each hand assigns a 30 bid and rotates the bidder. Original move scores are
stored on the device. After a hand, tap a play for its scores or a 40/160-world
recheck. **Copy observation link** carries the finished hand, selected move,
public seed, note, alternative and original receipt when available. Open it on
another device to inspect the same position. To import on the Mac gym, keep the
fragment and replace the origin with the local table address, then save it.
The link does not overwrite an ongoing game.

The live player has a 14-second compute budget and emits completed checkpoints.
A host timeout retains the last completed decision; leaving a position cancels
its worker. A load failure asks for Retry. No other AI is substituted. A larger
inspection that times out labels any smaller fallback sample honestly.

## Release another Walt

1. Commit the shared source in the Texas 42 repository.
2. Run `python3 scripts/update-walt.py /path/to/texas-42` here. This bounds the
   Rust build with the experiment watchdog and imports a wasm plus provenance
   manifest. The source must have the `wasm32-unknown-unknown` target installed.
3. Run the shared native/browser conformance check described in
   `walt/walt-player/README.md`, then Plunge's `npm test` and `npm run build`.
4. Commit the imported asset, manifest and UI changes together; publish main.
   The existing Cloudflare workflow checks/tests/builds and deploys the matched
   site and hashed wasm. The app offers Reload when a new build is available.

`prebuild` checks the wasm SHA-256 and restricts its imports to the host clock
and checkpoint callback. The production output contains only the new Walt
artifact; older AI sources remain solely for historical tests/reference.

The previous app's non-practice save may be replaced. Current sunshine saves
remain usable. A phone receipt is device-local unless included in a copied
observation link; full live logging and exhaustive gym comparisons remain on
Mac. For now computer declaration uses the existing own-information heuristic.

Validation: 157 UI tests, native/wasm exact L1 option vectors for all nine
straight declarations plus a late-game fixture, a matching full 64-world paired
partner prefix, and forced clock interruption. Browser play/review smoke testing
completed a hand on the Mac, restored original scores after reload, and ran a
160-world recheck. Device-storage failure keeps play and session scores available.
Pixel performance and thermal behavior await real-device play.

---

# The local Mac research table

This worktree connects Plunge to the native Texas 42 player and its gym.
Start it with:

```sh
python3 /Users/jason/code/texas-42-partnership-launch/experiments/partnership/play_plunge.py
```

Open <http://127.0.0.1:4244>. Choose L1 or L1 + partner check, then deal.
Every hand has an assigned 30 bid and a rotating bidder. You choose trump on
your bids; computer bidders use Plunge's existing hard declaration selection.
The three computer players use the selected native preset for every play.
This is a Mac practice mode; ordinary `npm run dev` retains Plunge's original
player menu. The launcher enables practice with `VITE_NATIVE_TABLE=1`.

After a hand: **See how it went → tap a play → Save this move for the gym**.
History and move stats sit side by side on the Mac. Each selected play shows
the actor's remaining hand, legal moves, trump and led suit, and make/set
perspective. Computer plays show the original saved option scores; forced
moves explain that there was only one legal choice. L1 scores remain labeled
as preceding the partner check when that check changed the move.

**Look closer · 160 worlds** adds a separate native L1 recheck underneath the
original scores. Human moves and old shared hands offer **Ask Walt · 40 worlds**.
These requests use only the actor's own original hand and the public prefix.
Completed primary estimates are cached separately from playing receipts;
inspection never changes the played move. A 14-second deadline bounds each
inspection, and a fallback displays its actual smaller sample size. A timeout
can be retried. Inspection uses a separate worker, so it doesn't queue behind
live play. The current recheck uses the current L1 default, even when an old
receipt was made by a different implementation.

You can attach a note and an alternative legal move, copy a local replay link,
and compare every legal choice under named continuation players. The original
native response stays attached to the move. Full comparisons have an explicit
400-hand limit and can be paused/resumed. Scores are model-relative make/set
frequencies, with no count tie-breaker.

Ctrl-C stops the launcher. Restart it to resume. Browser game saves and native
records survive; a failed native request waits for Retry. The local table does
not use the offline service worker, so updated source and analysis status are
not replayed from an old cache. Reload after restarting with changed source.

The full operating and evidence guide is
`/Users/jason/code/texas-42-partnership-launch/experiments/partnership/PLUNGE.md`.
Records live at `/Users/jason/data/texas-42/plunge-sunshine/` by default.
`src/ai/native.ts` owns the strict transport; `NativeReview.tsx` and
`NativeStats.tsx` own finished-hand inspection. Live requests expose only the actor's own original hand and public
history. Finished-hand examiner data uses a separate endpoint.

Validation: native transport and reducer tests, independent Python agreement
across nine declarations, a real browser-played hand, original-receipt replay,
and native gym pause/resume. Existing engine, share-code, and UI tests remain
part of the regression check. This branch is local; no deployment is implied.
