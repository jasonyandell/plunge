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
`src/ai/native.ts` owns the strict transport; `NativeReview.tsx` owns finished-hand
inspection. Live requests expose only the actor's own original hand and public
history. Finished-hand examiner data uses a separate endpoint.

Validation: native transport and reducer tests, independent Python agreement
across nine declarations, a real browser-played hand, original-receipt replay,
and native gym pause/resume. Existing engine, share-code, and UI tests remain
part of the regression check. This branch is local; no deployment is implied.
