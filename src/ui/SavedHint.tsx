/** Replay the saved advice, never replace it with a new calculation. */
import { allPlays, type Question } from '../questions/model';
import { decodeReplay } from '../engine/replay-code';
import { decisionStats } from '../ai/decision-stats';
import { legalDominoes } from '../engine';
import { tileOfId, idOfTile } from '../ai/walt/requests';
import { MoveScores } from './MoveScores';
import { BookDetails } from './BiddingHint';
import { Domino } from './Domino';
import { bidLabel, declLabel, trumpChip, ledChip, SEAT_NAMES } from './store';
import { TrickHistory } from './TrickHistory';

export function SavedHint({ question, complete }: { question: Question; complete: boolean }) {
  if (question.schema !== 'plunge-question-v2') return null;
  const h = question.hint, snapshot = decodeReplay(question.snapshot)!;
  const game = complete ? decodeReplay(question.replay) : null;
  const stats = h.kind === 'move' && h.estimate
    ? decisionStats(h.estimate.response, h.estimate.identity.request, legalDominoes(snapshot).map(tileOfId)) : null;
  const later = game ? h.kind === 'move' ? allPlays(game)[question.ply] : null : null;
  return <section class="saved-hint">
    <p class="setting-hint">The original hint, saved before you chose. These results haven’t been recalculated.</p>
    <div class="saved-hint-hand" aria-label="Your hand when the hint was saved">
      {snapshot.hands[0]!.map(id => <Domino key={id} id={id} orientation="v" />)}
    </div>
    {h.kind === 'move' ? <>
      <p class="hint-position">{trumpChip(snapshot)}{ledChip(snapshot,snapshot.currentTrick) ? ` · Led: ${ledChip(snapshot,snapshot.currentTrick)}` : ''}</p>
      <p>{h.explanation}</p><p class="hint-fact">{h.context}</p>
      {stats && <>
        <p class="setting-hint">{stats.worlds} sampled deals{stats.worlds < h.requested_worlds ? ` · ${h.requested_worlds} requested` : ''}. Baseline advice, without the separate partner check.</p>
        <MoveScores stats={stats} selected={h.choice} selectionLabel="Suggested" />
      </>}
      {later && <p class="hint-fact">You later played {later.domino.split('').join('–')}{later.domino === idOfTile(h.choice) ? ', as suggested.' : ', instead of the suggested move.'}</p>}
      {(snapshot.tricks.length > 0 || snapshot.currentTrick.length > 0) && <details class="disclosure"><summary>Public play before the hint</summary>
        {snapshot.currentTrick.length > 0 && <div class="saved-hint-trick">
          <p>Current trick</p>{snapshot.currentTrick.map((p,i) => <div key={p.seat}>
            <span>{SEAT_NAMES[p.seat]}{i === 0 ? ' led' : ''}</span><Domino id={p.domino} orientation="h" />
          </div>)}
        </div>}
        <TrickHistory g={snapshot} /></details>}
    </> : <>
      <BookDetails hint={h.advice} g={snapshot} captured={h} />
      {game && <p class="hint-fact">{h.kind === 'bid' ? `Your actual bid: ${bidLabel(game.bids.find(b => b.seat === 0)!.bid)}.`
        : `You chose ${game.declaration ? declLabel(game.declaration) : 'no declaration'}.`}</p>}
    </>}
  </section>;
}
