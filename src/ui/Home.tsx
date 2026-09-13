/**
 * Home, How-to-play, and About screens.
 */

import type { Difficulty } from '../ai';
import { NATIVE_TABLE, isNative, nativeLabel } from '../ai/native';
import type { AppEvent, AppState, Preset } from './store';
import './home.css';

interface HomeProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
}

const DIFFS: readonly Difficulty[] = NATIVE_TABLE ? ['native-partner', 'native-l1'] : ['easy', 'medium', 'hard', 'onyx', 'walt'];

export function Home({ app, dispatch }: HomeProps) {
  const resumable = app.game !== null && app.game.phase !== 'game-over';
  return (
    <div class="home">
      <div class="home-card">
        <h1 class="title">Plunge</h1>
        <p class="tagline">{NATIVE_TABLE ? 'The sunshine table · on your Mac' : 'Texas 42, the way Gran taught it'}</p>

        {resumable && (
          <button type="button" class="big-btn" onClick={() => dispatch({ type: 'resume' })}>
            Resume your game
          </button>
        )}
        <button
          type="button"
          class={resumable ? 'big-btn secondary' : 'big-btn'}
          onClick={() => dispatch({ type: 'new-game', seed: Date.now().toString(36), sessionId: crypto.randomUUID() })}
        >
          Deal me in
        </button>

        <div class="setting">
          <span class="setting-label">{NATIVE_TABLE ? 'Your partner and opponents' : 'Opponents'}</span>
          <div class="seg" role="radiogroup" aria-label="Difficulty">
            {DIFFS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={app.settings.difficulty === d}
                class={`seg-btn${app.settings.difficulty === d ? ' on' : ''}`}
                onClick={() => dispatch({ type: 'set-difficulty', difficulty: d })}
              >
                {isNative(d) ? nativeLabel(d) : d}
              </button>
            ))}
          </div>
        </div>

        {NATIVE_TABLE ? <p class="setting-hint native-intro">
          Straight 42, a 30 bid every hand. The bidder rotates and chooses trump.
          After a hand, tap a move to save it for the gym—with a note or another play to try.
        </p> : <div class="setting">
          <span class="setting-label">House rules</span>
          <div class="seg" role="radiogroup" aria-label="Rules preset">
            {(['casual', 'tournament'] as const).map((p: Preset) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={app.settings.preset === p}
                class={`seg-btn${app.settings.preset === p ? ' on' : ''}`}
                onClick={() => dispatch({ type: 'set-preset', preset: p })}
              >
                {p === 'casual' ? 'Casual family game' : 'Tournament 42'}
              </button>
            ))}
          </div>
          <p class="setting-hint">
            {app.settings.preset === 'casual'
              ? 'Nel-O, Plunge and Splash allowed — like home.'
              : 'Straight 42 — no special contracts.'}
          </p>
        </div>}

        <div class="link-row">
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'how' })}>
            How to play
          </button>
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'about' })}>
            About
          </button>
        </div>
      </div>
    </div>
  );
}

export function HowTo({ dispatch }: { dispatch: (e: AppEvent) => void }) {
  return (
    <div class="doc">
      <BackBar dispatch={dispatch} title="How to play" />
      <div class="doc-body">
        <h2>The table</h2>
        <p>
          Four players, two teams: you and Gran across the table against Earl and Ruby.
          Everybody draws seven dominoes from the double-six set. There are 42 points
          in every hand — one for each of the seven tricks, plus 35 in <em>count</em>:
          the 5-5 and 6-4 are worth ten apiece, and the 5-0, 4-1 and 3-2 are worth five.
        </p>
        <h2>Bidding</h2>
        <p>
          Starting left of the shaker, each player gets one bid: pass, or a number from
          30 to 41, or 42-and-up in <em>marks</em> (42 is one mark, 84 is two). Your bid
          is a promise: your team will take at least that many points. Bid a mark or
          more and you're promising every last trick.
        </p>
        <h2>Trumps and following</h2>
        <p>
          The winning bidder names trump — blanks through sixes, doubles as their own
          suit, or "follow me" with no trump at all. Every domino with the trump number
          belongs to trump and nothing else. Otherwise a domino led counts as its higher
          end's suit, and you must follow that suit if you can. The double is the boss of
          its suit. Highest trump wins the trick; barring trump, highest of the led suit.
        </p>
        <h2>Counting it up</h2>
        <p>
          Make your bid and your team scores a mark (more on mark bids); get <em>set</em>
          {' '}and the other side takes them instead. Marks are tallied by drawing the word
          {' '}<strong>ALL</strong> stroke by stroke — seven strokes, and first to write it
          out wins the game.
        </p>
        <h2>The specials (casual game)</h2>
        <p>
          <strong>Nel-O</strong> — bid a mark and promise to <em>lose</em> every trick.
          Your partner flips their dominoes face down and sits the hand out, and doubles
          become their own little suit.
        </p>
        <p>
          <strong>Plunge</strong> — holding four or more doubles, you can jump straight
          to four marks. Your partner names trump from their own hand and leads, and
          your team has to sweep all seven tricks.
        </p>
        <p>
          <strong>Splash</strong> — Plunge's little sister: three doubles, two or three
          marks, same deal. Partner calls trump, y'all take them all.
        </p>
      </div>
    </div>
  );
}

export function About({ dispatch }: { dispatch: (e: AppEvent) => void }) {
  return (
    <div class="doc">
      <BackBar dispatch={dispatch} title="About" />
      <div class="doc-body">
        <p>
          42 was invented in 1887 in Garner, Texas, by two boys — William Thomas and
          Walter Earl — who needed a domino stand-in for forbidden card games. Our Earl
          tips his hat to Walter. It's been the official State Domino Game of Texas
          since 2011, with the state championship played every year in Hallettsville.
        </p>
        <p>
          <strong>Plunge</strong> is a free, open-source, single-player game of 42:
          you and Gran against Earl and Ruby. No ads, no accounts, no sound — just
          dominoes and a wood table.
        </p>
        <p class="fine">
          Casual preset: Nel-O (partner sits out, doubles a suit of their own), Plunge
          at four marks, Splash at two or three. Tournament preset: N42PA straight 42.
        </p>
      </div>
    </div>
  );
}

function BackBar({ dispatch, title }: { dispatch: (e: AppEvent) => void; title: string }) {
  return (
    <header class="back-bar">
      <button
        type="button"
        class="text-btn"
        aria-label="Back to home"
        onClick={() => dispatch({ type: 'go', screen: 'home' })}
      >
        &larr; Back
      </button>
      <h1>{title}</h1>
    </header>
  );
}
