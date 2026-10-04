/**
 * Talk it over: replay recorded hands on the phone, step to any decision,
 * branch with a different legal move, and compare two kinds of answer that
 * are kept visibly apart:
 *   - Hindsight: one continuation on the real hands (realized, not proof).
 *   - What they knew: an estimate over guessed hidden hands, built only from
 *     what that seat could see at the time.
 * The location hash holds the hand, step and branch, so back and reload land
 * in the same place. Reading history here never writes or deletes anything.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Action, type GameState, type Seat, legalActions, teamOf } from '../engine';
import {
  type Cursor, type HandStep, type ReviewLocation, START, back, finalState, forward, handSteps,
  parseReviewHash, play, positionAt, resetBranch, reviewHash, sameAction,
} from '../review/steps';
import { type Library, type ReviewHand, collectHands, deviceSources, failingSources, loadLibrary } from '../review/library';
import { exampleRecords } from '../review/fixtures';
import {
  CONTINUATION_NAME, DEFAULT_SAMPLES, type Estimate, compareOptions, estimateOptions, finishHand, hindsight,
  optionFor, outcomeOf,
} from '../review/whatif';
import {
  actionLabel, comparisonSentence, contractSentence, moveSentence, netSentence, outcomeSentence, seatName,
  stageOf, talkPrompt, teamName, timeline,
} from '../review/describe';
import { Domino } from './Domino';
import './review.css';

const UNAVAILABLE_COPY: Record<string, string> = {
  history: 'game history', stats: 'stats log', records: 'older hand journal', pending: 'unsaved moves', example: 'examples',
};

function currentLocation(): ReviewLocation {
  return parseReviewHash(location.hash) ?? { hand: null, cursor: START };
}

export function HistoryReview({ onClose, onExport }: { onClose: () => void; onExport?: () => void }) {
  const [loc, setLoc] = useState<ReviewLocation>(currentLocation);
  const [library, setLibrary] = useState<Library | 'loading'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [showExamples, setShowExamples] = useState(false);
  const examples = useMemo(() => collectHands(exampleRecords()), []);

  useEffect(() => {
    const sync = () => {
      const next = parseReviewHash(location.hash);
      if (next) setLoc(next); else onClose();
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLibrary('loading');
    void (loc.qa === 'storage-failure' ? Promise.resolve(failingSources()) : deviceSources())
      .then(loadLibrary)
      .catch((): Library => ({ hands: [], unreadable: [], unavailable: ['history', 'stats', 'records', 'pending'] }))
      .then(lib => { if (alive) setLibrary(lib); });
    return () => { alive = false; };
  }, [attempt, loc.qa]);

  // Opening a hand pushes one history entry, so the phone's back gesture
  // returns to the list; stepping and branching replace it (reload-safe).
  const pushed = useRef(false);
  const go = (next: ReviewLocation, push: boolean) => {
    const hash = reviewHash(next);
    if (push) history.pushState(null, '', hash); else history.replaceState(null, '', hash);
    pushed.current = push || (pushed.current && next.hand !== null);
    setLoc(next);
  };
  const toList = () => {
    if (pushed.current) { pushed.current = false; history.back(); return; }
    go({ hand: null, cursor: START, ...(loc.qa ? { qa: loc.qa } : {}) }, false);
  };
  const close = () => {
    history.replaceState(null, '', location.pathname + location.search);
    onClose();
  };

  const hands = library === 'loading' ? [] : library.hands;
  const hand = loc.hand === null ? null
    : hands.find(h => h.key === loc.hand) ?? examples.hands.find(h => h.key === loc.hand) ?? null;

  return (
    <div class="review-screen" role="dialog" aria-modal="true" aria-label="Review past hands">
      <header class="review-header">
        {loc.hand !== null
          ? <button type="button" class="review-nav" onClick={toList}>‹ Hands</button>
          : <span class="review-nav-spacer" />}
        <h2>{loc.hand === null ? 'Talk it over' : 'Hand review'}</h2>
        <button type="button" class="review-close" aria-label="Close review" onClick={close}>×</button>
      </header>
      <div class="review-body">
        {library === 'loading' && <p class="review-muted">Reading this device’s history…</p>}
        {library !== 'loading' && library.unavailable.length > 0 && (
          <div class="review-alert" role="alert">
            <p>
              Couldn’t read the {library.unavailable.map(s => UNAVAILABLE_COPY[s] ?? s).join(', ')} right now.
              Nothing was changed or deleted — your records stay where they are.
            </p>
            <div class="review-row">
              <button type="button" class="review-btn" onClick={() => setAttempt(n => n + 1)}>Try again</button>
              {onExport && <button type="button" class="review-btn" onClick={onExport}>Export history</button>}
            </div>
          </div>
        )}
        {loc.hand === null && library !== 'loading' && (
          <HandList
            library={library}
            examples={showExamples || hands.length === 0 ? examples.hands : []}
            showingExamples={showExamples || hands.length === 0}
            onExamples={() => setShowExamples(s => !s)}
            onOpen={h => go({ hand: h.key, cursor: START, ...(loc.qa ? { qa: loc.qa } : {}) }, true)}
          />
        )}
        {loc.hand !== null && library !== 'loading' && !hand && (
          <p class="review-muted">That hand isn’t in this device’s history. It may have been recorded in another browser.</p>
        )}
        {hand && (
          <HandReview
            key={hand.key}
            hand={hand}
            cursor={loc.cursor}
            onCursor={cursor => go({ ...loc, cursor }, false)}
          />
        )}
      </div>
    </div>
  );
}

function handTitle(h: ReviewHand): string {
  if (h.key.startsWith('example-')) return `Example: ${h.key.slice(8).replace(/:.*$/, '').replace(/-/g, ' ')}`;
  return `Hand${h.handNumber ? ` ${h.handNumber}` : ''}`;
}

function HandList({ library, examples, showingExamples, onExamples, onOpen }: {
  library: Library; examples: readonly ReviewHand[]; showingExamples: boolean;
  onExamples: () => void; onOpen: (h: ReviewHand) => void;
}) {
  const unreadable = library.unreadable.reduce((n, u) => n + u.count, 0);
  return (
    <>
      <p class="review-intro">
        Step through a hand, stop at any decision, and try something else. Read from this device only;
        nothing is changed or uploaded.
      </p>
      {library.hands.length === 0 && <p class="review-muted">No recorded hands on this device yet. Play a hand, or try an example below.</p>}
      <div class="review-list">
        {library.hands.map(h => <HandItem key={h.key} hand={h} onOpen={onOpen} />)}
      </div>
      {unreadable > 0 && (
        <p class="review-muted">
          {unreadable} saved record{unreadable === 1 ? '' : 's'} can’t be shown by this version. They are kept untouched and
          included in Export history.
        </p>
      )}
      {library.hands.length > 0 && (
        <button type="button" class="review-link" onClick={onExamples}>{showingExamples ? 'Hide example hands' : 'Show example hands'}</button>
      )}
      {showingExamples && (
        <>
          <h3 class="review-subhead">Example hands <span>(not yours — for trying the review)</span></h3>
          <div class="review-list">{examples.map(h => <HandItem key={h.key} hand={h} onOpen={onOpen} />)}</div>
        </>
      )}
    </>
  );
}

function HandItem({ hand, onOpen }: { hand: ReviewHand; onOpen: (h: ReviewHand) => void }) {
  const g = hand.game;
  const when = hand.recordedAt ? new Date(hand.recordedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <button type="button" class="review-item" onClick={() => onOpen(hand)}>
      <span class="review-item-main">
        <strong>{handTitle(hand)}</strong>
        <span>{contractSentence(g)}</span>
        <small>{hand.finished ? outcomeSentence(outcomeOf(g)) : 'Unfinished — the record stops partway.'}</small>
      </span>
      <small class="review-item-when">{when}</small>
    </button>
  );
}

// ---------------------------------------------------------------------------

function HandReview({ hand, cursor, onCursor }: { hand: ReviewHand; cursor: Cursor; onCursor: (c: Cursor) => void }) {
  const steps = useMemo(() => handSteps(hand.game) ?? [], [hand]);
  const end = useMemo(() => finalState(steps, hand.game), [steps, hand]);
  const pos = positionAt(steps, end, cursor);
  useEffect(() => { if (!pos) onCursor(START); }, [pos === null]);
  if (!pos) return <p class="review-muted">That position no longer replays. Starting from the beginning.</p>;

  const decision: HandStep | null = cursor.at < steps.length ? steps[cursor.at]! : null;
  const branching = cursor.branch.length > 0;
  const recordedNext = !branching && decision ? decision.action : null;
  const hinted = !branching && hand.hintsBefore.includes(cursor.at);

  return (
    <div class="hand-review">
      <p class="review-contract">{contractSentence(hand.game)} {hand.finished ? outcomeSentence(outcomeOf(hand.game)) : 'Unfinished record.'}</p>

      <div class={`review-where${branching ? ' is-branch' : ''}`}>
        <span>{branching ? 'What if… (not what happened)' : `Replay · move ${Math.min(cursor.at + 1, steps.length)} of ${steps.length}`}</span>
        <span>{stageOf(pos)}</span>
      </div>

      <Board g={pos} />

      {pos.turn !== null && pos.phase !== 'hand-over' && pos.phase !== 'game-over' ? (
        <Choices g={pos} recorded={recordedNext} onChoose={a => { const c = play(steps, end, cursor, a); if (c) onCursor(c); }} />
      ) : (
        <p class="review-muted">{branching ? 'This branch is finished.' : hand.finished ? 'End of the hand.' : 'The record stops here.'}</p>
      )}
      {hinted && <p class="review-hinted">A hint was showing before this move.</p>}

      <div class="review-controls">
        <button type="button" class="review-btn" disabled={cursor.at === 0 && !branching} onClick={() => onCursor(back(cursor))}>
          ‹ {branching ? 'Undo' : 'Back'}
        </button>
        {branching
          ? <button type="button" class="review-btn" onClick={() => onCursor(resetBranch(cursor))}>Back to what happened</button>
          : <button type="button" class="review-btn" disabled={cursor.at >= steps.length} onClick={() => onCursor(forward(steps, cursor))}>Next ›</button>}
      </div>

      {decision && <WhatIf hand={hand} at={cursor.at} decision={decision} branch={cursor.branch} tip={pos} />}

      <p class="review-talk"><strong>Talk it over:</strong> {talkPrompt(decision?.state ?? pos)}</p>

      <Timeline steps={steps} at={branching ? -1 : cursor.at} divergence={branching ? cursor.at : -1}
        hints={hand.hintsBefore} onJump={i => onCursor({ at: i, branch: [] })} />
    </div>
  );
}

/** Public table plus one seat's view; all hands only behind a hindsight toggle. */
function Board({ g }: { g: GameState }) {
  const [reveal, setReveal] = useState(false);
  const viewer: Seat = g.turn ?? 0;
  const trick = g.currentTrick.length ? g.currentTrick : g.tricks[g.tricks.length - 1]?.plays ?? [];
  const trickLabel = g.currentTrick.length ? 'This trick so far' : g.tricks.length ? `Trick ${g.tricks.length} (done)` : '';
  return (
    <div class="review-board">
      <p class="review-score">
        {contractSentence(g)}<br />
        Points this hand: {teamName(0)} {g.points[0]} · {teamName(1)} {g.points[1]}
        {g.bids.length > 0 && <><br />Bids: {g.bids.map(b => `${seatName(b.seat)} ${actionLabel({ type: 'bid', bid: b.bid })}`).join(', ')}</>}
      </p>
      {trickLabel && (
        <div class="review-trick" aria-label={trickLabel}>
          <small>{trickLabel}</small>
          <div>{trick.map(p => <span key={p.seat}><Domino id={p.domino} /><small>{seatName(p.seat)}</small></span>)}</div>
        </div>
      )}
      {!reveal && (
        <div class="review-seat">
          <small>What {viewer === 0 ? 'you' : seatName(viewer)} could see: {viewer === 0 ? 'your' : 'their'} hand</small>
          <div class="review-hand">{g.hands[viewer]!.map(id => <Domino key={id} id={id} />)}</div>
        </div>
      )}
      {reveal && (
        <div class="review-hindsight">
          <small>Hindsight — nobody at the table could see all of these.</small>
          {([0, 1, 2, 3] as Seat[]).map(s => (
            <div key={s} class="review-seat">
              <small>{seatName(s)}{s === g.sittingOut ? ' (sitting out)' : ''}</small>
              <div class="review-hand">{g.hands[s]!.map(id => <Domino key={id} id={id} />)}</div>
            </div>
          ))}
        </div>
      )}
      <button type="button" class="review-link" aria-pressed={reveal} onClick={() => setReveal(r => !r)}>
        {reveal ? 'Hide other hands' : 'Show all hands (hindsight)'}
      </button>
    </div>
  );
}

function Choices({ g, recorded, onChoose }: { g: GameState; recorded: Action | null; onChoose: (a: Action) => void }) {
  const seat = g.turn!;
  const options = legalActions(g);
  const who = seat === 0 ? 'You' : seatName(seat);
  const verb = g.phase === 'bidding' ? 'bid' : g.phase === 'declaring' ? 'call trump' : 'play';
  return (
    <div class="review-choices">
      <p>
        {who} to {verb}. {recorded ? <>Recorded: <strong>{actionLabel(recorded)}</strong>. Tap it to replay, or tap another legal move to branch.</> : 'Choose a legal move to continue the branch.'}
      </p>
      <div class={`review-options ${g.phase === 'playing' ? 'is-dominoes' : ''}`}>
        {options.map(a => {
          const isRecorded = recorded !== null && sameAction(a, recorded);
          return a.type === 'play' ? (
            <button type="button" key={a.domino} class={`review-option-dom${isRecorded ? ' is-recorded' : ''}`}
              aria-label={`${actionLabel(a)}${isRecorded ? ' (recorded)' : ''}`} onClick={() => onChoose(a)}>
              <Domino id={a.domino} />
            </button>
          ) : (
            <button type="button" key={actionLabel(a)} class={`review-chip${isRecorded ? ' is-recorded' : ''}`} onClick={() => onChoose(a)}>
              {actionLabel(a)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type EstimateState = Estimate | 'loading' | 'error';
const estimateCache = new Map<string, Estimate>();

function WhatIf({ hand, at, decision, branch, tip }: {
  hand: ReviewHand; at: number; decision: HandStep; branch: readonly Action[]; tip: GameState;
}) {
  const seat = decision.state.turn!;
  const team = teamOf(seat);
  const who = seat === 0 ? 'you' : seatName(seat);
  const recorded = decision.action;
  const alt = branch[0] ?? null;
  const real = useMemo(() => hindsight(decision.state, recorded), [decision]);
  const branchEnd = useMemo(() => branch.length ? outcomeOf(finishHand(tip)) : null, [tip, branch.length]);

  const cacheKey = `${hand.key}|${at}`;
  const [estimate, setEstimate] = useState<EstimateState | null>(estimateCache.get(cacheKey) ?? null);
  const abort = useRef<AbortController>();
  useEffect(() => { setEstimate(estimateCache.get(cacheKey) ?? null); return () => abort.current?.abort(); }, [cacheKey]);
  const run = () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setEstimate('loading');
    void estimateOptions(decision.state, DEFAULT_SAMPLES, `${hand.code}|${at}`, () => new Promise(r => setTimeout(r, 0)), controller.signal)
      .then(e => { estimateCache.set(cacheKey, e); if (!controller.signal.aborted) setEstimate(e); },
        () => { if (!controller.signal.aborted) setEstimate('error'); });
  };

  const recordedOpt = estimate && typeof estimate === 'object' ? optionFor(estimate, recorded) : undefined;
  const altOpt = estimate && typeof estimate === 'object' && alt ? optionFor(estimate, alt) : undefined;

  return (
    <section class="review-whatif" aria-label="Would something else have done better?">
      <h3>Would something else have done better?</h3>

      <div class="review-card is-actual">
        <h4>What actually happened</h4>
        <p>{moveSentence(seat, recorded)}. {hand.finished ? outcomeSentence(outcomeOf(hand.game)) : 'The record stops before the hand ended.'}</p>
      </div>

      <div class="review-card is-hindsight">
        <h4>Hindsight: the real hands, one finish</h4>
        <p class="review-fine">
          Every hand face up to us, not to the players. From this move on, {CONTINUATION_NAME} plays all four seats once.
          One continuation shows what <em>could</em> happen — it doesn’t prove which move is best.
        </p>
        <p>After {actionLabel(recorded)}: {netSentence(real, team)}. {outcomeSentence(real)}</p>
        {alt && branchEnd && (
          <p>
            After your branch ({branch.map(actionLabel).join(' → ')}): {netSentence(branchEnd, team)}. {outcomeSentence(branchEnd)}
          </p>
        )}
        {!alt && <p class="review-fine">Tap a different legal move above to compare a branch.</p>}
      </div>

      <div class="review-card is-knowledge">
        <h4>What {who} knew: an estimate</h4>
        <p class="review-fine">
          Uses only {seat === 0 ? 'your' : `${seatName(seat)}’s`} own hand and what was played or bid in the open.
          The other hands are guessed {DEFAULT_SAMPLES} times, and {CONTINUATION_NAME} finishes each guess.
          It doesn’t use what the bids hinted at.
        </p>
        {estimate === null && <button type="button" class="review-btn" onClick={run}>Estimate from what {who} could see</button>}
        {estimate === 'loading' && <p class="review-muted">Guessing hidden hands…</p>}
        {estimate === 'error' && <p class="review-muted">The estimate didn’t finish. <button type="button" class="review-link" onClick={run}>Try again</button></p>}
        {estimate && typeof estimate === 'object' && (
          <>
            <table class="review-table">
              <thead><tr><th>Move</th><th>Ahead</th><th>Behind</th><th>Avg marks</th></tr></thead>
              <tbody>
                {estimate.options.map(o => {
                  const isRec = sameAction(o.action, recorded), isAlt = alt !== null && sameAction(o.action, alt);
                  return (
                    <tr key={actionLabel(o.action)} class={isRec ? 'is-recorded' : isAlt ? 'is-alt' : ''}>
                      <td>{actionLabel(o.action)}{isRec ? ' (played)' : isAlt ? ' (branch)' : ''}</td>
                      <td>{o.ahead}/{o.samples}</td>
                      <td>{o.behind}/{o.samples}</td>
                      <td>{o.averageNet >= 0 ? '+' : '−'}{Math.abs(o.averageNet).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p class="review-fine">
              Ahead/behind: guessed deals where {teamName(team)} won or lost marks. With {estimate.samples} guesses,
              a difference of a few deals is noise.
            </p>
            {recordedOpt && altOpt && (
              <p><strong>{comparisonSentence(compareOptions(altOpt, recordedOpt), actionLabel(altOpt.action), actionLabel(recordedOpt.action))}</strong></p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Timeline({ steps, at, divergence, hints, onJump }: {
  steps: readonly HandStep[]; at: number; divergence: number; hints: readonly number[]; onJump: (i: number) => void;
}) {
  return (
    <nav class="review-timeline" aria-label="Decisions in this hand">
      {timeline(steps).map(row => (
        <div class="review-timeline-row" key={row.label}>
          <span>{row.label}</span>
          <div>
            {row.indices.map(i => {
              const s = steps[i]!, seat = s.state.turn!;
              const cls = ['review-step', seat === 0 ? 'is-you' : '', i === at ? 'is-here' : '', i === divergence ? 'is-diverged' : ''].filter(Boolean).join(' ');
              return (
                <button type="button" key={i} class={cls} aria-current={i === at ? 'step' : undefined} onClick={() => onJump(i)}
                  title={moveSentence(seat, s.action)}>
                  <small>{seatName(seat)[0]}</small>{actionLabel(s.action).replace(' as trump', '')}
                  {hints.includes(i) && <span aria-label="hint shown"> •</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
