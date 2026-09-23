/**
 * Home, How-to-play, and About screens.
 */

import type { Difficulty } from '../ai';
import { NATIVE_TABLE, isNative, nativeLabel } from '../ai/native';
import type { AppEvent, AppState } from './store';
import { Domino } from './Domino';
import './home.css';

interface HomeProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
  onQuestions?: () => void;
}

const DIFFS: readonly Difficulty[] = ['native-partner', 'native-l1'];

export function Home({ app, dispatch, onQuestions }: HomeProps) {
  const resumable = app.game !== null && app.game.phase !== 'game-over';
  return (
    <div class="home">
      <div class="home-card">
        <p class="eyebrow">Texas 42</p>
        <div class="home-dominoes" aria-hidden="true">
          <Domino id="64" /><Domino id="55" /><Domino id="42" />
        </div>
        <h1 class="title">Plunge</h1>
        <p class="tagline">Pull up a chair.</p>
        <p class="home-welcome">You and Gran against Earl and Ruby.<br />First to seven marks wins.</p>

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

        {app.settings.nelloCounterexamples && !NATIVE_TABLE && <p class="setting-hint">Nel-O counterexample experiment is on. Change it in Advanced settings.</p>}
        <div class="link-row">
          {onQuestions && <button type="button" class="text-btn" onClick={onQuestions}>Your questions</button>}
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'how' })}>
            How to play
          </button>
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'about' })}>
            About
          </button>
        </div>

        <details class="disclosure home-settings">
          <summary>Advanced settings</summary>
          <div class="setting">
            <span class="setting-label">Computer player</span>
            <p class="setting-hint">Walt plays the three computer seats. Choose which version to use.</p>
            <div class="seg" role="radiogroup" aria-label="Computer player">
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
          <div class="setting">
            <button type="button" role="switch" class="thinking-switch"
              aria-checked={app.settings.thinkDeeper} aria-describedby="thinking-hint"
              onClick={() => dispatch({ type: 'set-think-deeper', enabled: !app.settings.thinkDeeper })}>
              <span>Think deeper</span>
              <span class="switch-track" aria-hidden="true"><span /></span>
            </button>
            <p id="thinking-hint" class="setting-hint">
              A larger sample for every computer move. May take longer. Bidding stays instant.
              {app.settings.difficulty === 'native-partner' && ' Uses deeper analysis in place of the regular partner check.'}
            </p>
          </div>
          {!NATIVE_TABLE && <div class="setting">
            <button type="button" role="switch" class="thinking-switch"
              aria-checked={app.settings.nelloCounterexamples} aria-describedby="counterexample-hint"
              onClick={() => {
                const enabled = !app.settings.nelloCounterexamples;
                const url = new URL(location.href);
                url.searchParams.set('nello', enabled ? 'counterexamples' : 'ordinary');
                history.replaceState(null, '', url);
                dispatch({ type: 'set-nello-counterexamples', enabled });
              }}>
              <span>Nel-O counterexamples</span>
              <span class="switch-track" aria-hidden="true"><span /></span>
            </button>
            <p id="counterexample-hint" class="setting-hint">Experimental defense: look for deals that escape the plan, then try again with those deals included. May take longer; stronger play isn’t established.</p>
          </div>}
          <p class="setting-hint native-intro">
            {NATIVE_TABLE ? 'Walt runs on your Mac.' : 'Walt runs right on your device.'}
            {' '}It uses only its own hand and the public plays. After a hand,
            “See how it went” lets you inspect its estimates and share a move.
          </p>
        </details>
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
          Starting left of the shaker, each player bids once or passes. Bidding starts
          at 30 and each new bid must be higher. Bid 42 (one mark) or more marks to
          promise all seven tricks. If the first three players pass, the shaker
          must bid at least 30. The winner names trump and leads. Walt’s bids are
          ready when it’s time to speak.
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
        <p>
          Quick bidding: Walt uses results from games already played. This edition
          draws from a shuffled collection of 125 deals, with fresh choices during play.
        </p>
        <p class="fine">
          Straight 42 with Walt. One shared player on the Mac and in your browser.
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
