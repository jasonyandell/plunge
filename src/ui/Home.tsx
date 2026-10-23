/**
 * Home, More, How-to-play, and About screens.
 */

import { PlayerPicker } from './PlayerPicker';
import { NewGameButton } from './NewGameButton';
import { ActiveTables } from '../room/ActiveTables';
import { DEEP_WORLDS, NATIVE_TABLE } from '../ai/native';
import { canRestart, canUndo, nelloPaused, type AppEvent, type AppState } from './store';
import { Domino } from './Domino';
import './home.css';
import { useEffect, useState } from 'preact/hooks';
import { ClosedTableError, familyProbe, familyTable, lastRoom, liveTables, ROOMS_ENABLED, roomUrl, savedSeat, saveSeat } from '../room/client';
import { tableNote, tableTitle } from '../room/view';
import type { ListedTable } from '../room/protocol';
import type { ComponentChildren } from 'preact';
import { openScreenIdea } from '../ideas/QuickIdea';

interface HomeProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
  onPriorHands?: () => void;
  /** Who's here, in the card's corner. Passed in so Home stays hook-free. */
  identity?: ComponentChildren;
}

interface MoreProps extends HomeProps {
  onQuestions?: () => void;
  onHistory?: () => void;
}

const openRooms = () => { const url = new URL(location.href); url.searchParams.set('rooms', '1'); location.assign(url.href); };
/** The expanded table list refreshes while it is on screen. */
const LIST_EVERY = 30000;

/** Family entry points: the tables anyone can find (sit down or knock), the standing
 * table for signed-in family, the last table this browser sat at, and invite rooms.
 * Its own component so Home stays hook-free. */
function FamilyEntry({ compact = false }: { compact?: boolean }) {
  const [family, setFamily] = useState(false);
  const [tables, setTables] = useState<ListedTable[]>([]);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const remembered = (() => { try { return lastRoom(localStorage); } catch { return null; } })();
  /** This browser already holds a chair there: no knocking, whatever the door says. */
  const seated = (roomId: string) => { try { return savedSeat(roomId, localStorage) !== null; } catch { return false; } };
  useEffect(() => { let live = true; void familyProbe().then(value => { if (live) setFamily(value.family); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (compact) return;
    let live = true;
    const refresh = () => { if (document.visibilityState !== 'hidden') void liveTables().then(list => { if (live) setTables(list); }).catch(() => { /* The list is a convenience. */ }); };
    refresh();
    const timer = setInterval(refresh, LIST_EVERY);
    document.addEventListener('visibilitychange', refresh);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [compact]);
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
  const hasTable = shown.length > 0 || family || Boolean(remembered);
  if (compact) return <>
    <ActiveTables family={family} onJoin={table => table.standing && family ? void openFamilyTable() : location.assign(roomUrl(table.roomId))} />
    <button type="button" class="text-btn home-family" disabled={opening}
      aria-label={!family && !remembered ? 'Play with family · Experimental' : undefined}
      onClick={() => family ? void openFamilyTable() : remembered ? location.assign(roomUrl(remembered)) : openRooms()}>
      {opening ? 'Opening the table…' : family ? 'Family table' : remembered ? 'Back to your family table' : 'Play with family'}
      <small class="preview-badge">Experimental</small>
    </button>
    {familyError && <p class="setting-hint" role="alert">{familyError}</p>}
    {familyError && <button type="button" class="big-btn" onClick={openRooms}>Start another table</button>}
  </>;
  return <section class="more-section" aria-labelledby="home-together-title">
    <h2 id="home-together-title">Family tables <small class="preview-badge">Experimental</small></h2>
    <p class="setting-hint">{family ? 'Your family’s table is a tap away.' : 'Join a table, or invite someone to yours.'}</p>
    {shown.length > 0 && <ul class="home-tables" aria-label="Tables">
      {shown.map(table => <li key={table.roomId}><button type="button" class="home-table" disabled={opening}
        onClick={() => table.standing && family ? void openFamilyTable() : location.assign(roomUrl(table.roomId))}>
        <strong>{tableTitle(table)}</strong><span>{tableNote(table)}</span>
        <em>{seated(table.roomId) ? 'Rejoin' : table.open || (table.standing && family) ? 'Sit down' : 'Knock'}</em>
      </button></li>)}
    </ul>}
    {family && !standingListed && (
      <button type="button" class="big-btn" disabled={opening} onClick={() => void openFamilyTable()}>
        {opening ? 'Finding the family table…' : 'Family table'}
      </button>
    )}
    {familyError && <p class="setting-hint" role="alert">{familyError}</p>}
    {familyError && <button type="button" class="big-btn" onClick={openRooms}>Start another table</button>}
    {!family && remembered && !shown.some(table => table.roomId === remembered) && (
      <button type="button" class="big-btn" onClick={() => location.assign(roomUrl(remembered))}>
        Back to your family table
      </button>
    )}
    <button type="button" class={hasTable ? 'text-btn home-family' : 'big-btn'}
      aria-label={hasTable ? undefined : 'Play with family · Experimental'} onClick={openRooms}>
      {hasTable ? 'Other tables & invites' : 'Play with family'}
    </button>
  </section>;
}

/** Keep the original welcome and one immediate choice to play. */
export function Home({ app, dispatch, identity }: HomeProps) {
  const paused = nelloPaused(app);
  // A finished game stays resumable while its last hand can still be undone or
  // replayed, so a reload doesn't strand those choices on the result card.
  const resumable = app.game !== null && (app.game.phase !== 'game-over' || app.showTrick || canUndo(app) || canRestart(app));
  return (
    <div class="home">
      <div class="home-card">
        {identity}
        <p class="eyebrow">Texas 42</p>
        <div class="home-dominoes" aria-hidden="true">
          <Domino id="64" /><Domino id="55" /><Domino id="42" />
        </div>
        <h1 class="title">Plunge</h1>
        <p class="tagline">Pull up a chair.</p>
        <p class="home-welcome">{paused ? <>Your Nel-O hand is saved.<br />{NATIVE_TABLE ? 'Resume Nel-O in your browser.' : 'Enable Nel-O in Settings to resume.'}</> : <>You and Gran against Earl and Ruby.<br />First to seven marks wins.</>}</p>

        {resumable ? (
          <button type="button" class="big-btn" disabled={paused} onClick={() => dispatch({ type: 'resume' })}>
            Resume your game
          </button>
        ) : (
          <button
            type="button"
            class="big-btn"
            onClick={() => dispatch({ type: 'new-game', seed: Date.now().toString(36), sessionId: crypto.randomUUID() })}
          >
            Deal me in
          </button>
        )}

        {resumable && <NewGameButton app={app} dispatch={dispatch} />}

        <a class="text-btn home-stats-link" href="?stats=1">
          Stats · Play again <small class="preview-badge">Preview</small>
        </a>
        {ROOMS_ENABLED && <FamilyEntry compact />}

        <div class="link-row home-links">
          <button type="button" class="text-btn" onClick={openScreenIdea}>Share an idea</button>
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'how' })}>
            How to play
          </button>
          <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'more' })}>
            Settings & more
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings, your saved things, and the rest of Plunge. */
export function More({ app, dispatch, onQuestions, onHistory, onPriorHands }: MoreProps) {
  return (
    <div class="home">
      <div class="home-card more-card">
        <button type="button" class="text-btn more-back" onClick={() => dispatch({ type: 'go', screen: 'home' })}>
          &larr; Back
        </button>
        <h1 class="more-title">More</h1>

        {app.game && <section class="more-section" aria-labelledby="more-game">
          <h2 id="more-game">Your game</h2>
          <NewGameButton app={app} dispatch={dispatch} className="more-row" />
          {onPriorHands && <button type="button" class="more-row" aria-haspopup="dialog" onClick={onPriorHands}>Prior hands</button>}
        </section>}
        {ROOMS_ENABLED && <FamilyEntry />}

        <section class="more-section" aria-labelledby="more-settings">
          <h2 id="more-settings">Settings</h2>
          <HintsSwitch app={app} dispatch={dispatch} />
          <div class="setting">
            <span class="setting-label">Computer player</span>
            <p class="setting-hint">Changing players ends any game in progress. You’ll confirm before switching.</p>
            <PlayerPicker selected={app.settings.difficulty} game={app.game} sessionId={app.sessionId}
              onChoose={(difficulty, confirmed) => dispatch({ type: 'set-difficulty', difficulty, confirmed, sessionId: app.sessionId })} />
          </div>
          <div class="setting">
            <button type="button" role="switch" class="thinking-switch"
              aria-checked={app.settings.thinkDeeper} aria-describedby="thinking-hint"
              onClick={() => dispatch({ type: 'set-think-deeper', enabled: !app.settings.thinkDeeper })}>
              <span>Think deeper</span>
              <span class="switch-track" aria-hidden="true"><span /></span>
            </button>
            <p id="thinking-hint" class="setting-hint">
              {app.settings.difficulty === 'zeb' ? 'Zeb uses 512 sampled deals per move instead of 160. May take longer.' : `${DEEP_WORLDS} sampled deals for every computer move. May take longer. Bidding stays instant.`}
              {app.settings.difficulty === 'native-partner' && ' Uses deeper analysis in place of the regular partner check.'}
            </p>
          </div>
          {!NATIVE_TABLE && <div class="setting">
            <button type="button" role="switch" class="thinking-switch"
              aria-checked={app.settings.nelloEnabled} aria-describedby="nello-hint"
              onClick={() => {
                const enabled = !app.settings.nelloEnabled;
                const url = new URL(location.href);
                url.searchParams.set('nello', enabled ? 'on' : 'off');
                history.replaceState(null, '', url);
                dispatch({ type: 'set-nello-enabled', enabled });
              }}>
              <span>Nel-O</span>
              <span class="switch-track" aria-hidden="true"><span /></span>
            </button>
            <p id="nello-hint" class="setting-hint">Win a bid of one mark or more, then choose Nel-O to try taking no tricks. Your partner sits out. Turn off for straight 42 only.</p>
          </div>}
          <p class="setting-hint native-intro">
            {app.settings.difficulty === 'zeb' ? 'Zeb runs right on your device.' : NATIVE_TABLE ? 'Walt runs on your Mac.' : 'Walt runs right on your device.'}
            {' '}It uses only its own hand and the public plays. After a hand,
            “See how it went” lets you inspect its estimates and share a move.
          </p>
        </section>

        <section class="more-section" aria-labelledby="more-yours">
          <h2 id="more-yours">Yours</h2>
          {onQuestions && <button type="button" class="more-row" onClick={onQuestions}>Your questions</button>}
          <a class="more-row" href="?stats=1">Stats · play again</a>
          {onHistory && <button type="button" class="more-row" onClick={onHistory}>Export history</button>}
          <p class="setting-hint">Game history and computer decisions stay on this device. Export a backup before clearing browser data. Finished-hand stats connect to your account when you sign in.</p>
          <a class="more-row" href="?account=1">Your account · optional</a>
        </section>

        <section class="more-section" aria-labelledby="more-plunge">
          <h2 id="more-plunge">Plunge</h2>
          <a class="more-row" href="?ideas=1">Ideas for Plunge</a>
          <button type="button" class="more-row" onClick={openScreenIdea}>Share an idea about this screen</button>
          <p class="setting-hint">You can also long-press the screen, mark what you mean, and add a note.</p>
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
          must bid at least 30. The winner names trump and leads.
        </p>
        <h2>Trumps and following</h2>
        <p>
          The winning bidder names trump — blanks through sixes, doubles as their own
          suit, or "follow me" with no trump at all. Every domino with the trump number
          belongs to trump and nothing else. Otherwise a domino led counts as its higher
          end's suit, and you must follow that suit if you can. The double is the boss of
          its suit. Highest trump wins the trick; barring trump, highest of the led suit.
        </p>
        <h2>Nel-O</h2>
        <p>
          Win a bid of one mark or more, then choose Nel-O to try taking no tricks.
          Your partner sits out and you lead. Doubles form their own suit, with 6-6
          highest. Taking even one trick sets you immediately. Nel-O is on by default;
          turn it off in More → Settings for straight 42 only.
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
          <strong>Plunge</strong> is a free, open-source game of 42. Play solo with
          Gran, Earl and Ruby, or invite people to a family table. Accounts are optional.
        </p>
        <p>
          Choose Walt or Zeb for the computer seats. Walt bids from recorded games in
          the prepared deal catalogue. Zeb forecasts bids from your hand and uses fresh shuffles.
        </p>
        <p class="fine">
          Both players use their own hand and public plays. Your saved decisions keep the model and version that made them.
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
