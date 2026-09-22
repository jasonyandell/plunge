/**
 * Your stats: the on-device dashboard over the append-only hand log.
 *
 * Everything is computed from recorded replays. "Agreed with Walt" measures
 * decisions, never hint use — nothing about hints is recorded anywhere.
 * While the log is empty the screen shows a clearly-labeled sample so the
 * layout reads populated from day one.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { idOfTile } from '../ai/walt/requests';
import { decodeReplay } from '../engine/replay-code';
import { ANALYSIS_PROFILE, reviewMissing, type ReviewProgress } from '../stats/analysis';
import { aggregate, type Disagreement, type StatsReport } from '../stats/aggregate';
import { listAnalyses, listHands, putAnalysis, type HandAnalysis, type HandRecord } from '../stats/log';
import { sampleData } from '../stats/sample';
import type { AppEvent } from './store';
import { BackBar } from './Home';
import { Domino } from './Domino';
import './stats.css';

interface StatsProps {
  dispatch: (e: AppEvent) => void;
}

interface Loaded {
  records: readonly HandRecord[];
  analyses: readonly HandAnalysis[];
  sample: boolean;
}

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const ratio = (n: number, d: number): string => `${n} of ${d}`;

export function Stats({ dispatch }: StatsProps) {
  const [data, setData] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [reviewStalled, setReviewStalled] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([listHands(), listAnalyses()])
      .catch(() => [[], []] as [HandRecord[], HandAnalysis[]])
      .then(([records, analyses]) => {
        if (!alive) return;
        if (records.length === 0) {
          const sample = sampleData();
          setData({ records: sample.hands, analyses: sample.analyses, sample: true });
        } else setData({ records, analyses, sample: false });
      });
    return () => { alive = false; };
  }, []);

  // Walt reviews any hands he hasn't seen yet, one at a time, saving as he
  // goes — leaving the screen pauses the pass and a later visit resumes it.
  const reviewing = useRef(false);
  useEffect(() => {
    if (!data || data.sample || reviewing.current) return;
    const missing = new Set(data.analyses.filter((a) => a.profile === ANALYSIS_PROFILE).map((a) => a.id));
    if (!data.records.some((r) => !missing.has(r.id))) return;
    reviewing.current = true;
    const controller = new AbortController();
    void reviewMissing(data.records, data.analyses, putAnalysis, setProgress, controller.signal)
      .then((fresh) => {
        if (!controller.signal.aborted && fresh.length) {
          setData((d) => d && { ...d, analyses: [...d.analyses, ...fresh] });
        }
      })
      .catch(() => { if (!controller.signal.aborted) setReviewStalled(true); })
      .finally(() => { reviewing.current = false; setProgress(null); });
    return () => controller.abort();
  }, [data]);

  const report = useMemo(
    () => data && aggregate(data.records, data.analyses, ANALYSIS_PROFILE),
    [data],
  );

  return (
    <div class="doc stats">
      <BackBar dispatch={dispatch} title="Your stats" />
      <div class="doc-body">
        {!report && <p class="fine">Reading the log…</p>}
        {data?.sample && (
          <div class="stat-sample" role="note">
            <strong>Sample data.</strong> This is what your stats will look like.
            Deal yourself in and the real thing starts counting — everything stays on this device.
          </div>
        )}
        {report && data && (
          <>
            <Topline r={report} />
            <Bidding r={report} />
            <PartnerPlay r={report} />
            <WaltAgreement r={report} />
            <WaltReview r={report} progress={progress} stalled={reviewStalled} sample={data.sample} dispatch={dispatch} />
            <p class="fine stat-footnote">
              Kept on this device only, from finished hands. Walt's play review is a
              40-world sample per move — a couple of points either way is weather, not climate.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Topline({ r }: { r: StatsReport }) {
  const streak = r.games.current;
  return (
    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-num">{r.games.won}–{r.games.played - r.games.won}</span>
        <span class="stat-label">Games</span>
        <span class="stat-sub">
          {streak > 1 ? `${streak} wins running` : streak < -1 ? `${-streak} losses running` : `best run ${r.games.best}`}
        </span>
      </div>
      <div class="stat-tile">
        <span class="stat-num">{pct(r.handsWon, r.decided)}</span>
        <span class="stat-label">Hands won</span>
        <span class="stat-sub">marks {r.marks.us}–{r.marks.them}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-num">{pct(r.bidding.yours.made, r.bidding.yours.bids)}</span>
        <span class="stat-label">Your bids made</span>
        <span class="stat-sub">{ratio(r.bidding.yours.made, r.bidding.yours.bids)}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-num">{pct(r.agreement.bids.agreed, r.agreement.bids.considered)}</span>
        <span class="stat-label">Bid like Walt</span>
        <span class="stat-sub">{ratio(r.agreement.bids.agreed, r.agreement.bids.considered)}</span>
      </div>
    </div>
  );
}

function Meter({ label, n, d }: { label: string; n: number; d: number }) {
  return (
    <div class="stat-meter">
      <span class="stat-meter-label">{label}</span>
      <span class="stat-meter-track" aria-hidden="true">
        <span class="stat-meter-fill" style={{ width: d > 0 ? `${(n / d) * 100}%` : '0' }} />
      </span>
      <span class="stat-meter-value">{d > 0 ? `${n}/${d}` : '—'}</span>
    </div>
  );
}

function Bidding({ r }: { r: StatsReport }) {
  const b = r.bidding;
  return (
    <section>
      <h2>Bidding</h2>
      {b.byBid.length > 0 && (
        <div class="stat-group">
          <p class="stat-group-title">Your bids made, by bid</p>
          {b.byBid.map((l) => <Meter key={l.label} label={l.label} n={l.made} d={l.bids} />)}
        </div>
      )}
      {b.byTrump.length > 0 && (
        <div class="stat-group">
          <p class="stat-group-title">Your bids made, by trump</p>
          {b.byTrump.map((l) => <Meter key={l.label} label={l.label} n={l.made} d={l.bids} />)}
        </div>
      )}
      <ul class="stat-lines">
        <li>Team bids made: <strong>{pct(b.team.made, b.team.bids)}</strong> ({ratio(b.team.made, b.team.bids)})</li>
        <li>Sets delivered on defense: <strong>{pct(b.defense.sets, b.defense.hands)}</strong> ({ratio(b.defense.sets, b.defense.hands)})</li>
        {b.yours.forced > 0 && (
          <li>Forced 30s survived: <strong>{ratio(b.yours.forcedMade, b.yours.forced)}</strong></li>
        )}
        {(r.sweeps.us > 0 || r.sweeps.them > 0) && (
          <li>Seven-trick sweeps: <strong>{r.sweeps.us}</strong> by y'all, <strong>{r.sweeps.them}</strong> by them</li>
        )}
        {r.thrownIn > 0 && <li>Hands thrown in: <strong>{r.thrownIn}</strong></li>}
      </ul>
    </section>
  );
}

function PartnerPlay({ r }: { r: StatsReport }) {
  const p = r.partner;
  return (
    <section>
      <h2>Playing with Gran</h2>
      <ul class="stat-lines">
        <li>Assists — count fed to Gran's winning tricks: <strong>{p.assistPoints}</strong> points, {p.assists} times</li>
        <li>Saves — their count captured by your tricks: <strong>{p.savePoints}</strong> points, {p.saves} times</li>
        <li>Gifts — your count lost to Earl and Ruby: <strong>{p.giftPoints}</strong> points, {p.gifts} times</li>
        <li>Count captured: <strong>{pct(r.count.captured, r.count.decided)}</strong> of the {r.count.decided} points played out</li>
      </ul>
    </section>
  );
}

function WaltAgreement({ r }: { r: StatsReport }) {
  const a = r.agreement;
  const agreedRate = a.whenAgreed.hands > 0 ? Math.round((a.whenAgreed.won / a.whenAgreed.hands) * 100) : null;
  const freelanceRate = a.whenNot.hands > 0 ? Math.round((a.whenNot.won / a.whenNot.hands) * 100) : null;
  return (
    <section>
      <h2>Thinking like Walt</h2>
      <div class="stat-group">
        <Meter label="Bids" n={a.bids.agreed} d={a.bids.considered} />
        <Meter label="Trump calls" n={a.trump.agreed} d={a.trump.considered} />
      </div>
      {agreedRate !== null && freelanceRate !== null && (
        <p class="stat-lines">
          Hands where you bid Walt's way: won <strong>{agreedRate}%</strong> ({ratio(a.whenAgreed.won, a.whenAgreed.hands)}).
          Where you went your own way: <strong>{freelanceRate}%</strong> ({ratio(a.whenNot.won, a.whenNot.hands)}).
          {a.phi !== null && <span class="fine"> φ = {a.phi.toFixed(2)} — correlation, not causation; you already knew that.</span>}
        </p>
      )}
      <p class="fine">
        Scored after the fact from the same recorded-game book as the bidding hint —
        it measures the call you made, never whether you peeked.
      </p>
    </section>
  );
}

function WaltReview({ r, progress, stalled, sample, dispatch }: {
  r: StatsReport; progress: ReviewProgress | null; stalled: boolean; sample: boolean;
  dispatch: (e: AppEvent) => void;
}) {
  const p = r.play;
  const avgRegret = p.decisions > 0 ? ((p.regretSum / p.decisions) * 100).toFixed(1) : null;
  return (
    <section>
      <h2>Walt reviewed your plays</h2>
      {progress && progress.total > 0 && (
        <p class="stat-progress" role="status">Walt's reviewing hand {Math.min(progress.done + 1, progress.total)} of {progress.total}…</p>
      )}
      {stalled && <p class="fine">Walt couldn't finish reviewing — he'll pick it back up next visit.</p>}
      {p.decisions > 0 ? (
        <>
          <div class="stat-group">
            <Meter label="Played Walt's pick" n={p.matches} d={p.decisions} />
            <Meter label="Within a whisker" n={p.defensible} d={p.decisions} />
          </div>
          <ul class="stat-lines">
            {avgRegret !== null && (
              <li>Left on the table: <strong>{avgRegret}</strong> points of make-chance per decision</li>
            )}
            <li>Forced plays (no decision to make): <strong>{p.forced}</strong></li>
          </ul>
          <div class="stat-group">
            <p class="stat-group-title">Where y'all part ways</p>
            {p.byStage.map((s) => <Meter key={s.label} label={s.label} n={s.matches} d={s.decisions} />)}
            <Meter label="Declaring" n={p.declaring.matches} d={p.declaring.decisions} />
            <Meter label="Defending" n={p.defending.matches} d={p.defending.decisions} />
          </div>
          {p.disagreements.length > 0 && (
            <div class="stat-group">
              <p class="stat-group-title">Biggest disagreements</p>
              <ul class="stat-disagreements">
                {p.disagreements.map((d) => <DisagreementRow key={`${d.id}:${d.ply}`} d={d} dispatch={dispatch} />)}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p class="fine">
          {sample ? 'Nothing reviewed in the sample yet.'
            : 'Walt reviews each finished hand right here, on your device, the first time you open this screen.'}
        </p>
      )}
    </section>
  );
}

function DisagreementRow({ d, dispatch }: { d: Disagreement; dispatch: (e: AppEvent) => void }) {
  const open = () => {
    const game = decodeReplay(d.code);
    if (game) dispatch({ type: 'view-scenario', game });
  };
  return (
    <li>
      <button type="button" class="stat-disagreement" onClick={open}>
        <span class="stat-dom"><Domino id={idOfTile(d.played)} /></span>
        <span class="stat-disagreement-text">
          you, trick {Math.floor(d.ply / 4) + 1} — Walt liked
        </span>
        <span class="stat-dom"><Domino id={idOfTile(d.suggested)} /></span>
        <span class="stat-gap">−{Math.round(d.gap * 100)}% to {d.objective}</span>
      </button>
    </li>
  );
}
