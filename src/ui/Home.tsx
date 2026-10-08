/**
 * Home, More, How-to-play, and About screens.
 */

import type { Difficulty } from '../ai';
import { DEEP_WORLDS, NATIVE_TABLE, isNative, nativeLabel } from '../ai/native';
import { canRestart, canUndo, nelloAvailable, nelloPaused, type AppEvent, type AppState } from './store';
import { Domino } from './Domino';
import './home.css';
import { useEffect, useState } from 'preact/hooks';
import { ClosedTableError, familyProbe, familyTable, lastRoom, liveTables, ROOMS_ENABLED, roomUrl, savedSeat, saveSeat } from '../room/client';
import { tableNote, tableTitle } from '../room/view';
import type { ListedTable } from '../room/protocol';

interface HomeProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
}

interface MoreProps extends HomeProps {
  onQuestions?: () => void;
  onHistory?: () => void;
}

const DIFFS: readonly Difficulty[] = ['native-partner', 'native-l1'];

const openRooms = () => { const url = new URL(location.href); url.searchParams.set('rooms', '1'); location.assign(url.href); };
/** The home screen asks who is playing this often while it is on screen. */
const LIST_EVERY = 30000;

/** Family entry points: the tables anyone can find (sit down or knock), the standing
 * table for signed-in family, the last table this browser sat at, and invite rooms.
 * Its own component so Home stays hook-free. */
function FamilyEntry() {
  const [family, setFamily] = useState(false);
  const [tables, setTables] = useState<ListedTable[]>([]);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const remembered = (() => { try { return lastRoom(localStorage); } catch { return null; } })();
  /** This browser already holds a chair there: no knocking, whatever the door says. */
  const seated = (roomId: string) => { try { return savedSeat(roomId, localStorage) !== null; } catch { return false; } };
  useEffect(() => { let live = true; void familyProbe().then(value => { if (live) setFamily(value.family); }); return () => { live = false; }; }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => { if (document.visibilityState !== 'hidden') void liveTables().then(list => { if (live) setTables(list); }).catch(() => { /* The list is a convenience. */ }); };
    refresh();
    const timer = setInterval(refresh, LIST_EVERY);
    document.addEventListener('visibilitychange', refresh);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const openFamilyTable = async () => {
    if (opening) return;
    setOpening(true); setFamilyError(null);
    try {
      const seat = await familyTable();
      try { saveSeat(seat, localStorage); } catch { /* The room page can still open the seat it was given. */ }
      location.assign(roomUrl(seat.roomId));
    } catch (e) {
      if (e instanceof ClosedTableError && e.roomId) { location.assign(roomUrl(e.roomId)); return; }
      setFamilyError(String(e instanceof Error ? e.message : e));
    } finally { setOpening(false); }
  };
  // An empty standing table is only worth showing to the family who can sit at it.
  const shown = tables.filter(table => !table.standing || family || table.seats.some(seat => seat?.connected));
  const standingListed = shown.some(table => table.standing);
  return <>
    {shown.length > 0 && <div class="home-tables" role="list" aria-label="Tables">
      {shown.map(table => <button key={table.roomId} type="button" role="listitem" class="home-table" disabled={opening}
        onClick={() => table.standing && family ? void openFamilyTable() : location.assign(roomUrl(table.roomId))}>
        <strong>{tableTitle(table)}</strong><span>{tableNote(table)}</span>
        <em>{seated(table.roomId) ? 'Rejoin' : table.open || (table.standing && family) ? 'Sit down' : 'Knock'}</em>
      </button>)}
    </div>}
    {family && !standingListed && (
      <button type="button" class="big-btn secondary" disabled={opening} onClick={() => void openFamilyTable()}>
        {opening ? 'Finding the family table…' : 'Family table'}
      </button>
    )}
    {familyError && <p class="setting-hint" role="alert">{familyError}</p>}
    {!family && remembered && !shown.some(table => table.roomId === remembered) && (
      <button type="button" class="text-btn home-family" onClick={() => location.assign(roomUrl(remembered))}>
        Back to your family table
      </button>
    )}
    <button type="button" class="text-btn home-family" aria-label="Play with family · Experimental" onClick={openRooms}>
      Play with family <small class="preview-badge">Experimental</small>
    </button>
  </>;
}

/** The front door: one decision, everything else behind More. */
export function Home({ app, dispatch }: HomeProps) {
  const paused = nelloPaused(app);
  // A finished game stays resumable while its last hand can still be undone or
  // replayed, so a reload doesn't strand those choices on the result card.
  const resumable = app.game !== null && (app.game.phase !== 'game-over' || app.showTrick || canUndo(app) || canRestart(app));
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
          <button type="button" class="big-btn" disabled={paused} onClick={() => dispatch({ type: 'resume' })}>
            Resume your game
          </button>
        )}
        {paused && <p class="setting-hint">Your Nel-O hand is saved. {NATIVE_TABLE ? 'Resume it in the browser with Nel-O Preview enabled.' : 'Turn on Nel-O Preview under More to resume.'}</p>}
        <button
          type="button"
          class={resumable ? 'big-btn secondary' : 'big-btn'}
          onClick={() => dispatch({ type: 'new-game', seed: Date.now().toString(36), sessionId: crypto.randomUUID() })}
        >
          Deal me in
        </button>
        {ROOMS_ENABLED && <FamilyEntry />}

        <div class="link-row home-links">
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'how' })}>
            How to play
          </button>
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'more' })}>
            More{nelloAvailable(app.settings) && <small class="preview-badge">Nel-O</small>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings, your saved things, and the rest of Plunge. */
export function More({ app, dispatch, onQuestions, onHistory }: MoreProps) {
  return (
    <div class="home">
      <div class="home-card more-card">
        <button type="button" class="text-btn more-back" onClick={() => dispatch({ type: 'go', screen: 'home' })}>
          &larr; Back
        </button>
        <h1 class="more-title">More</h1>

        <section class="more-section" aria-labelledby="more-settings">
          <h2 id="more-settings">Settings</h2>
          <HintsSwitch app={app} dispatch={dispatch} />
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
              {DEEP_WORLDS} sampled deals for every computer move. May take longer. Bidding stays instant.
              {app.settings.difficulty === 'native-partner' && ' Uses deeper analysis in place of the regular partner check.'}
            </p>
          </div>
          {!NATIVE_TABLE && <div class="setting">
            <button type="button" role="switch" class="thinking-switch"
              aria-checked={app.settings.nelloPreview} aria-describedby="nello-preview-hint"
              onClick={() => {
                const enabled = !app.settings.nelloPreview;
                const url = new URL(location.href);
                url.searchParams.set('nello', enabled ? 'preview' : 'off');
                history.replaceState(null, '', url);
                dispatch({ type: 'set-nello-preview', enabled });
              }}>
              <span>Nel-O <small class="preview-badge">Preview</small></span>
              <span class="switch-track" aria-hidden="true"><span /></span>
            </button>
            <p id="nello-preview-hint" class="setting-hint">Enable experimental Nel-O, including Walt’s counterexample defense. May take longer. Off removes Nel-O from the available declarations.</p>
          </div>}
          <p class="setting-hint native-intro">
            {NATIVE_TABLE ? 'Walt runs on your Mac.' : 'Walt runs right on your device.'}
            {' '}It uses only its own hand and the public plays. After a hand,
            “See how it went” lets you inspect its estimates and share a move.
          </p>
        </section>

        <section class="more-section" aria-labelledby="more-yours">
          <h2 id="more-yours">Yours</h2>
          {onQuestions && <button type="button" class="more-row" onClick={onQuestions}>Your questions</button>}
          {onHistory && <button type="button" class="more-row" onClick={onHistory}>Export history</button>}
          <p class="setting-hint">Game history and Walt results stay on this device. Export a backup before clearing browser data.</p>
          <a class="more-row" href="?account=1">Your account · optional</a>
        </section>

        <section class="more-section" aria-labelledby="more-plunge">
          <h2 id="more-plunge">Plunge</h2>
          <a class="more-row" href="?ideas=1">Ideas for Plunge</a>
          <button type="button" class="more-row" onClick={() => dispatch({ type: 'go', screen: 'about' })}>About</button>
        </section>
      </div>
    </div>
  );
}

/** Show hints, shared by More and the in-game menu. */
export function HintsSwitch({ app, dispatch }: HomeProps) {
  return (
    <div class="setting">
      <button type="button" role="switch" class="thinking-switch"
        aria-checked={app.settings.showHints} aria-describedby="show-hints-description"
        onClick={() => dispatch({ type: 'set-show-hints', enabled: !app.settings.showHints })}>
        <span>Show hints</span>
        <span class="switch-track" aria-hidden="true"><span /></span>
      </button>
      <p id="show-hints-description" class="setting-hint">
        Bidding, trump and move advice, plus legal-domino highlighting. Saved on this device.
      </p>
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
      <BackBar dispatch={dispatch} title="About" back="more" />
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

function BackBar({ dispatch, title, back = 'home' }: { dispatch: (e: AppEvent) => void; title: string; back?: 'home' | 'more' }) {
  return (
    <header class="back-bar">
      <button
        type="button"
        class="text-btn"
        aria-label={back === 'home' ? 'Back to home' : 'Back to More'}
        onClick={() => dispatch({ type: 'go', screen: back })}
      >
        &larr; Back
      </button>
      <h1>{title}</h1>
    </header>
  );
}
