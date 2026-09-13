/** Finished-hand examiner UI. No data from this view enters a live chooser. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { legalPlays, type GameState } from '../engine';
import { api, nativeSeed, requestTile, type NativeReceipt, type FlagRecord, type Comparison } from '../ai/native';
import { explainRequestOf } from '../ai/walt/explain';
import { tileOfId } from '../ai/walt/requests';
import { encodeHand, shareUrl } from './share';
import { TrickHistory } from './Review';
import { Domino } from './Domino';
import { SEAT_NAMES } from './store';

type Selection = { trick: number; play: number };
const pips = (tile: number): string => requestTile(tile).split('').join('–');

export function reviewLegal(g: GameState, sel: Selection): number[] {
  const built = explainRequestOf(g, sel.trick, sel.play);
  if (!built || !g.rules) return [];
  const remaining = new Set(built.req.hand);
  for (let i = 1; i < built.req.plays.length; i += 2) remaining.delete(built.req.plays[i]!);
  const lead = sel.play === 0 ? null : g.tricks[sel.trick]!.plays[0]!.domino;
  return legalPlays([...remaining].map(requestTile), lead, g.rules).map(tileOfId);
}

export function NativeReview({ g, onBack, sessionId, receipts, initialFlag }: {
  g: GameState; onBack: () => void; sessionId: string; receipts: Record<string,string>; initialFlag: FlagRecord | null;
}) {
  const [sel, setSel] = useState<Selection | null>(initialFlag ? { trick: Math.floor(initialFlag.ply / 4), play: initialFlag.ply % 4 } : null);
  const [receipt, setReceipt] = useState<NativeReceipt | null>(initialFlag?.original_receipt ?? null);
  const [flag, setFlag] = useState<FlagRecord | null>(initialFlag);
  const [note, setNote] = useState(initialFlag?.note ?? '');
  const [alternative, setAlternative] = useState(initialFlag?.alternative?.toString() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [future, setFuture] = useState('l1');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const ply = sel === null ? null : sel.trick * 4 + sel.play;
  const rid = ply === null ? undefined : (initialFlag?.ply === ply ? initialFlag.receipt_id : receipts[`${g.handNumber}:${ply}`]);

  useEffect(() => {
    let live = true; setReceipt(null); setError('');
    if (rid) void api<NativeReceipt>(`receipts/${rid}`).then((r) => { if (live) setReceipt(r); })
      .catch((e: unknown) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [rid]);

  useEffect(() => {
    if (!flag || comparison?.status !== 'running') return;
    let live = true;
    const timer = setTimeout(() => {
      void api<Comparison>(`flags/${flag.id}/compare/${future}`).then((value) => { if (live) setComparison(value); })
        .catch((e: unknown) => { if (live) { setError(String(e)); setComparison(null); } });
    }, 1500);
    return () => { live = false; clearTimeout(timer); };
  }, [flag, future, comparison]);

  const select = (trick: number, play: number): void => {
    generation.current++; setBusy(false);
    setSel({ trick, play }); setFlag(null); setNote(''); setAlternative(''); setComparison(null); setCopied(false); setError('');
  };
  const save = async (): Promise<void> => {
    if (ply === null) return;
    const code = encodeHand(g);
    if (!code) { setError('This hand could not be exported.'); return; }
    setBusy(true); setError('');
    const started = generation.current;
    try {
      const value = await api<FlagRecord>('flags', { share_code: code, ply,
        seed: initialFlag?.request.seed ?? nativeSeed(sessionId, g.handNumber), note,
        alternative: alternative === '' ? null : Number(alternative), receipt_id: rid ?? null });
      if (started === generation.current) { setFlag(value); setComparison(null); }
    } catch (e) { if (started === generation.current) setError(String(e)); }
    finally { if (started === generation.current) setBusy(false); }
  };
  const compare = async (): Promise<void> => {
    if (!flag) return; setError(''); setBusy(true);
    const started = generation.current;
    try {
      const value = await api<Comparison>(`flags/${flag.id}/compare/${future}`, {});
      if (started === generation.current) setComparison(value);
    }
    catch (e) { if (started === generation.current) setError(String(e)); }
    finally { if (started === generation.current) setBusy(false); }
  };
  const pause = async (): Promise<void> => {
    if (!flag) return;
    const started = generation.current; setBusy(true);
    try {
      const value = await api<Comparison>(`flags/${flag.id}/compare/${future}/pause`, {});
      if (started === generation.current) setComparison(value);
    } catch (e) { if (started === generation.current) setError(String(e)); }
    finally { if (started === generation.current) setBusy(false); }
  };
  const copy = async (url: string | null): Promise<void> => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { window.prompt('Copy this link', url); }
  };
  const legal = sel ? reviewLegal(g, sel) : [];
  const locked = busy || comparison?.status === 'running';
  const current = sel && g.tricks[sel.trick]?.plays[sel.play];
  const review = receipt?.response.review_result;

  return <div class="overlay"><div class="card review-card native-review" role="dialog" aria-label="Research hand review">
    <h2 class="card-title">How it went</h2>
    <p class="card-detail">Us {g.points[0]} · Them {g.points[1]}. Tap a play to bring it into the gym.</p>
    <div class="review-scroll">
      <TrickHistory g={g} onTapPlay={select} selected={sel} />
      {sel && current && <section class="native-question">
        <h3>{SEAT_NAMES[current.seat]} played {current.domino.split('').join('–')} · play {ply! + 1}</h3>
        {receipt ? <div class="native-receipt">
          <p>Original decision: {receipt.identity.player.name === 'l1-default' ? 'L1' : 'L1 + partner check'} · {(receipt.response.elapsed_us / 1e6).toFixed(2)} s</p>
          <p>{review?.status === 'changed' ? `The check changed ${pips(review.baseline)} to ${pips(review.choice)}.`
            : review?.status === 'retained' ? 'The check kept L1’s move.'
            : review?.status === 'inactive' ? 'The partnership check did not trigger.'
            : review ? 'The check was unresolved; L1’s move was kept.' : `Decision route: ${receipt.response.route}.`}</p>
          {review?.samples !== undefined && <p>{review.samples} of {review.support} compatible hands compared
            {review.coverage === 'census' ? ' · full census' : ' · sampled guess'}.</p>}
        </div> : <p class="setting-hint">{rid ? 'Loading the original decision…' : 'No native decision receipt for this play. The hand and your observation can still be saved.'}</p>}
        <label class="native-label">What caught your eye?
          <textarea disabled={locked} value={note} maxLength={4000} placeholder="I thought Gran could have given me the five…"
            onInput={(e) => { setNote(e.currentTarget.value); setFlag(null); }} />
        </label>
        <label class="native-label">Another play to try (optional)
          <select disabled={locked} value={alternative} onChange={(e) => { setAlternative(e.currentTarget.value); setFlag(null); }}>
            <option value="">No suggestion</option>
            {legal.map((tile) => <option value={tile} key={tile}>{pips(tile)}</option>)}
          </select>
        </label>
        <button type="button" class="big-btn" disabled={locked || Boolean(flag) || (Boolean(rid) && receipt === null)} onClick={() => void save()}>
          {busy ? 'Saving…' : flag ? 'Saved for the gym' : 'Save this move for the gym'}
        </button>
        {flag && <div class="native-analysis">
          <p>Saved on your Mac. <button class="text-btn" onClick={() => void copy(`${location.origin}${location.pathname}#flag=${flag.id}`)}>Copy flagged-move link</button></p>
          <label class="native-label">Players used for the continuation
            <select disabled={locked} value={future} onChange={(e) => { generation.current++; setFuture(e.currentTarget.value); setComparison(null); }}>
              <option value="l1">L1 at every seat</option>
              <option value="partner-l2">Partner uses L2; other seats use L1</option>
              <option value="reviewed">L1 + partner check at every seat</option>
            </select>
          </label>
          <button class="big-btn secondary" disabled={locked} onClick={() => void compare()}>
            {comparison?.status === 'running' ? 'Comparing…' : comparison?.status === 'partial' ? 'Resume comparison' : 'Compare every legal play'}
          </button>
          {comparison?.status === 'running' && <button class="text-btn" disabled={busy} onClick={() => void pause()}>Pause comparison</button>}
          {comparison?.message && <p role="status">{comparison.message}{comparison.status === 'running' ? ` ${comparison.saved ?? 0} trajectories saved.` : ''}</p>}
          {comparison?.status === 'complete' && <>
            <p>Chance to {comparison.objective} the bid across all {comparison.support} compatible hands.</p>
            <div class="exp-rows">{comparison.actions?.map((a) => <div class={`exp-row${a.played ? ' exp-played' : ''}`} key={a.tile}>
              <Domino id={requestTile(a.tile)} orientation="h" className="exp-dom" />
              <span>{a.makes}/{a.worlds} · {(100*a.makes/a.worlds).toFixed(1)}%</span>
              <span>{a.played ? 'played' : ''}{a.best ? ' · best in this model' : ''}</span>
            </div>)}</div>
            <p class="setting-hint">{comparison.meaning}</p>
          </>}
        </div>}
      </section>}
      {error && <p role="alert" class="native-warning">{error}</p>}
    </div>
    <div class="review-footer">
      <button type="button" class="text-btn" onClick={() => void copy(shareUrl(g))}>{copied ? 'Link copied!' : 'Share this hand'}</button>
      <button type="button" class="big-btn" onClick={onBack}>Back to the result</button>
    </div>
  </div></div>;
}
