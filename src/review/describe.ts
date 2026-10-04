/** Plain-language labels for the review screen. Pure, so copy is testable. */
import { type Action, type GameState, type Seat, type Team, teamOf } from '../engine';
import { SEAT_NAMES, bidLabel, contractLabel, declLabel } from '../ui/store';
import type { HandStep } from './steps';
import { type Comparison, type Outcome, netMarks } from './whatif';

export const seatName = (s: Seat): string => SEAT_NAMES[s] ?? `Seat ${s}`;
export const teamName = (t: Team): string => t === 0 ? 'You & Gran' : 'Earl & Ruby';
const pips = (id: string): string => `${id[0]}-${id[1]}`;

export function actionLabel(a: Action): string {
  switch (a.type) {
    case 'play': return pips(a.domino);
    case 'bid': return bidLabel(a.bid);
    case 'declare': return `${declLabel(a.decl)} as trump`.replace('Nel-O as trump', 'Nel-O');
    case 'next-hand': return 'next hand';
  }
}

/** "You played 6-4", "Earl bid 31", "Gran passed". */
export function moveSentence(seat: Seat, a: Action): string {
  const who = seatName(seat);
  if (a.type === 'bid') return a.bid.kind === 'pass' ? `${who} passed` : `${who} bid ${bidLabel(a.bid)}`;
  if (a.type === 'declare') return `${who} called ${actionLabel(a)}`;
  if (a.type === 'play') return `${who} played ${pips(a.domino)}`;
  return who;
}

/** Where a decision sits in the hand: "Bidding", "Trump", "Trick 3". */
export function stageOf(g: GameState): string {
  if (g.phase === 'bidding') return 'Bidding';
  if (g.phase === 'declaring') return 'Trump';
  if (g.phase === 'playing') return `Trick ${g.tricks.length + 1}`;
  return 'Hand over';
}

export function contractSentence(g: GameState): string {
  if (g.thrownIn) return 'Everyone passed — thrown in.';
  if (g.declarer === null || !g.contract) return 'Still bidding.';
  const trump = g.declaration ? `, ${declLabel(g.declaration)}` : '';
  return `${seatName(g.declarer)} bid ${contractLabel(g.contract)}${trump}.`;
}

export function outcomeSentence(o: Outcome): string {
  if (o.thrownIn) return 'Thrown in — no marks either way.';
  if (!o.finished || o.declaringTeam === null) return 'Not finished.';
  const winner: Team = o.marks[0] > 0 ? 0 : 1;
  const m = o.marks[winner];
  return `${teamName(o.declaringTeam)} ${o.made ? 'made it' : 'were set'} — ${teamName(winner)} +${m} mark${m === 1 ? '' : 's'} (points ${o.points[0]}–${o.points[1]}).`;
}

/** Net marks from one team's side, e.g. "+1 for You & Gran". */
export function netSentence(o: Outcome, team: Team): string {
  const n = netMarks(o, team);
  return n === 0 ? 'even' : `${n > 0 ? '+' : '−'}${Math.abs(n)} for ${teamName(team)}`;
}

/** The sampled verdict on an alternative compared with the recorded move. */
export function comparisonSentence(c: Comparison, alt: string, recorded: string): string {
  switch (c) {
    case 'same': return `On every guessed deal, ${alt} and ${recorded} finished the same way.`;
    case 'too-close': return `${alt} and ${recorded} are too close to call on these guesses — the difference is within sampling noise.`;
    case 'better': return `On these guesses, ${alt} tended to do better than ${recorded}. That is an estimate, not a proof.`;
    case 'worse': return `On these guesses, ${alt} tended to do worse than ${recorded}. That is an estimate, not a proof.`;
  }
}

/** A discussion opener for the table, keyed to the kind of decision. */
export function talkPrompt(g: GameState): string {
  const seat = g.turn;
  if (seat === null) return 'What would you do differently next time?';
  const who = seat === 0 ? 'you' : seatName(seat), is = seat === 0 ? 'are' : 'is';
  if (g.phase === 'bidding') return `What did ${who} have in hand that made this bid feel right? What did the earlier bids say?`;
  if (g.phase === 'declaring') return `Which trump gives ${who} the most tricks? What about the count?`;
  if (g.currentTrick.length === 0) return `Leading now: ${is} ${who} pulling trump, or making someone else follow?`;
  const ourSideLed = teamOf(seat) === teamOf(g.currentTrick[0]!.seat);
  return ourSideLed
    ? `${seat === 0 ? 'Your' : `${seatName(seat)}'s`} side led this trick. Is it safe to give count here?`
    : `Can ${who} win this trick, and is it worth what it costs later?`;
}

/** Index ranges for the timeline: bidding, trump, then one row per trick. */
export function timeline(steps: readonly HandStep[]): Array<{ label: string; indices: number[] }> {
  const rows: Array<{ label: string; indices: number[] }> = [];
  steps.forEach((s, i) => {
    const label = stageOf(s.state);
    const row = rows[rows.length - 1];
    if (row && row.label === label) row.indices.push(i); else rows.push({ label, indices: [i] });
  });
  return rows;
}
