/**
 * Post-hand review: the trick-by-trick history, plus walt as the table
 * coach. Tap any play to see what walt priced every option at from that
 * seat's information state at the time (own hand + public record only — no
 * hindsight peeking at hidden hands); "How'd I do?" grades your own plays
 * the same way. Numbers are walt's model-relative estimates on n sampled
 * worlds — a read, not a receipt — and "Look closer" re-prices a decision
 * on 4× the worlds for when the sample feels like the reason.
 *
 * Analysis needs a straight points-and-marks hand (walt's scope); anything
 * else still gets the plain history.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState, Seat } from '../engine';
import { teamOf } from '../engine';
import {
  EXPLAIN_N_CLOSER,
  type Explanation,
  explainMove,
  explainScope,
  goodnessOf,
} from '../ai/walt/explain';
import { Domino } from './Domino';
import { HUMAN_SEAT, SEAT_NAMES, contractLabel, declLabel } from './store';
import { shareUrl } from './share';

const pips = (id: string): string => `${id[0]}-${id[1]}`;

type ExpState = Explanation | 'loading' | 'error';

// ---------------------------------------------------------------------------

export { TrickHistory } from './TrickHistory';
import { TrickHistory } from './TrickHistory';

// ---------------------------------------------------------------------------

const keyOf = (t: number, p: number, n?: number): string => `${t}:${p}${n ? `@${n}` : ''}`;

/** The finished hand, trick by trick — reachable from the end-of-hand card. */
export function ReviewSheet({ g, onBack }: { g: GameState; onBack: () => void }) {
  const inScope = explainScope(g);
  const [sel, setSel] = useState<{ trick: number; play: number } | null>(null);
  const [exps, setExps] = useState<Record<string, ExpState>>({});
  const [grading, setGrading] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const started = useRef(new Set<string>());
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const fetchExp = (t: number, p: number, n?: number): void => {
    const key = keyOf(t, p, n);
    if (started.current.has(key)) return;
    started.current.add(key);
    setExps((e) => ({ ...e, [key]: 'loading' }));
    void explainMove(g, t, p, n).then(
      (exp) => {
        if (alive.current) setExps((e) => ({ ...e, [key]: exp ?? 'error' }));
      },
      () => {
        if (alive.current) setExps((e) => ({ ...e, [key]: 'error' }));
      },
    );
  };

  const tap = inScope
    ? (t: number, p: number) => {
        setSel({ trick: t, play: p });
        fetchExp(t, p);
      }
    : undefined;

  // Grade every one of the human's plays, one at a time (each is a full
  // walt evaluation — sequential keeps the worker responsive for taps).
  const humanPlays: { trick: number; play: number }[] = [];
  g.tricks.forEach((t, i) =>
    t.plays.forEach((p, j) => {
      if (p.seat === HUMAN_SEAT) humanPlays.push({ trick: i, play: j });
    }),
  );
  const gradeAll = async (): Promise<void> => {
    setGrading(true);
    for (const { trick, play } of humanPlays) {
      const key = keyOf(trick, play);
      if (started.current.has(key)) continue;
      started.current.add(key);
      setExps((e) => ({ ...e, [key]: 'loading' }));
      const exp = await explainMove(g, trick, play).catch(() => null);
      if (!alive.current) return;
      setExps((e) => ({ ...e, [key]: exp ?? 'error' }));
    }
  };

  const share = (): void => {
    const url = shareUrl(g);
    if (!url) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(
        () => setCopied(true),
        () => window.prompt('Copy this link', url),
      );
    } else {
      window.prompt('Copy this link', url);
    }
  };

  const who = g.declarer === null ? '' : g.declarer === HUMAN_SEAT ? 'You' : SEAT_NAMES[g.declarer];
  return (
    <div class="overlay">
      <div class="card review-card" role="dialog" aria-label="Hand review">
        <h2 class="card-title">How it went</h2>
        <p class="card-detail">
          {g.contract !== null && who !== '' && (
            <>
              {who} bid {contractLabel(g.contract)}
              {g.declaration ? `, ${declLabel(g.declaration)}` : ''}.{' '}
            </>
          )}
          Us {g.points[0] ?? 0} &middot; Them {g.points[1] ?? 0}.
        </p>
        {inScope && !grading && humanPlays.length > 0 && (
          <button type="button" class="text-btn" onClick={() => void gradeAll()}>
            How&rsquo;d I do? Ask walt
          </button>
        )}
        {grading && <GradeList g={g} humanPlays={humanPlays} exps={exps} />}
        {inScope && (
          <p class="review-hint">Tap a play and walt will price the options that seat had.</p>
        )}
        {!inScope && (
          <p class="review-hint">walt only studies straight-42 hands — no analysis for this one.</p>
        )}
        {sel !== null && <ExplainPanel g={g} sel={sel} exps={exps} onCloser={fetchExp} />}
        <div class="review-scroll">
          <TrickHistory g={g} onTapPlay={tap} selected={sel} />
        </div>
        <div class="review-footer">
          <button type="button" class="text-btn" onClick={share}>
            {copied ? 'Link copied!' : 'Share this hand'}
          </button>
          <button type="button" class="big-btn" onClick={onBack}>
            Back to the result
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function pct(bp: number, declaringTeam: boolean): string {
  return `${Math.round(goodnessOf(bp, declaringTeam) / 100)}%`;
}

function seatName(seat: Seat): string {
  return seat === HUMAN_SEAT ? 'You' : (SEAT_NAMES[seat] ?? '');
}

/** One line per human play: how the played tile priced vs walt's pick. */
function GradeList({
  g,
  humanPlays,
  exps,
}: {
  g: GameState;
  humanPlays: readonly { trick: number; play: number }[];
  exps: Record<string, ExpState>;
}) {
  return (
    <div class="grade-list" role="region" aria-label="Your plays, graded">
      {humanPlays.map(({ trick, play }) => {
        const domino = g.tricks[trick]!.plays[play]!.domino;
        const exp = exps[keyOf(trick, play)];
        let verdict;
        if (exp === undefined || exp === 'loading') {
          verdict = <span class="grade-wait">walt is studying&hellip;</span>;
        } else if (exp === 'error') {
          verdict = <span class="grade-wait">no read</span>;
        } else if (exp.forced) {
          verdict = <span class="grade-ok">forced</span>;
        } else {
          const played = exp.options.find((o) => o.played);
          const best = exp.options[0];
          if (!played || !best) {
            verdict = <span class="grade-wait">no read</span>;
          } else if (played.best) {
            verdict = <span class="grade-ok">&#10003; walt agrees ({pct(played.bp, exp.declaringTeam)})</span>;
          } else {
            verdict = (
              <span class="grade-diff">
                {pct(played.bp, exp.declaringTeam)} &middot; walt likes {pips(best.domino)} (
                {pct(best.bp, exp.declaringTeam)})
              </span>
            );
          }
        }
        return (
          <div class="grade-row" key={`${trick}:${play}`}>
            <span class="grade-play">
              T{trick + 1} &middot; {pips(domino)}
            </span>
            {verdict}
          </div>
        );
      })}
    </div>
  );
}

/** walt's pricing of every option the tapped seat had at that decision. */
function ExplainPanel({
  g,
  sel,
  exps,
  onCloser,
}: {
  g: GameState;
  sel: { trick: number; play: number };
  exps: Record<string, ExpState>;
  onCloser: (t: number, p: number, n: number) => void;
}) {
  const p = g.tricks[sel.trick]!.plays[sel.play]!;
  const base = exps[keyOf(sel.trick, sel.play)];
  const closer = exps[keyOf(sel.trick, sel.play, EXPLAIN_N_CLOSER)];
  const exp: ExpState | undefined =
    closer !== undefined && closer !== 'loading' && closer !== 'error' ? closer : base;
  const closerPending = closer === 'loading';

  let body;
  if (exp === undefined || exp === 'loading') {
    body = <p class="exp-note">walt is studying&hellip;</p>;
  } else if (exp === 'error') {
    body = <p class="exp-note">walt couldn&rsquo;t price this one.</p>;
  } else if (exp.forced) {
    body = <p class="exp-note">That was the only legal play.</p>;
  } else {
    body = (
      <>
        <p class="exp-note">
          {exp.declaringTeam ? 'chance to make the bid' : 'chance to set the bid'} on {exp.n}{' '}
          sampled worlds
        </p>
        <div class="exp-rows">
          {exp.options.map((o) => (
            <div class={`exp-row${o.played ? ' exp-played' : ''}`} key={o.domino}>
              <Domino id={o.domino} orientation="h" className="exp-dom" />
              <span class="exp-pct">{pct(o.bp, exp.declaringTeam)}</span>
              <span class="exp-tags">
                {o.best && <span class="exp-tag best">walt&rsquo;s pick</span>}
                {o.played && <span class="exp-tag">played</span>}
              </span>
            </div>
          ))}
        </div>
        {closer === undefined && exp.n !== EXPLAIN_N_CLOSER && (
          <button
            type="button"
            class="text-btn"
            onClick={() => onCloser(sel.trick, sel.play, EXPLAIN_N_CLOSER)}
          >
            Look closer ({EXPLAIN_N_CLOSER} worlds — slower)
          </button>
        )}
        {closerPending && <p class="exp-note">looking closer&hellip;</p>}
      </>
    );
  }

  return (
    <div class="exp-panel" role="region" aria-label="walt's read">
      <div class="exp-title">
        Trick {sel.trick + 1} &mdash; {seatName(p.seat)} played {pips(p.domino)}
      </div>
      {body}
    </div>
  );
}
