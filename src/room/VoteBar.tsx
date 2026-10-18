import { useEffect, useState } from 'preact/hooks';
import type { Seat } from '../engine';
import type { Knock, Proposal, RoomSeat, Vote, VoteResult } from './protocol';
import { neededYes } from '../../worker/room-votes';

export function describeProposal(p: Proposal): string {
  switch (p.kind) {
    case 'start': return `${p.byName} wants to start the game`;
    case 'restart': return `${p.byName} wants to start over`;
    case 'next-hand': return `${p.byName} is ready for the next hand`;
    case 'undo': return `${p.byName} wants to take back the last move`;
    case 'open': return `${p.byName} wants to open the table`;
    case 'close': return `${p.byName} wants to close the table`;
    case 'kick': return `${p.byName} asks someone to step out`;
  }
}
const DONE: Record<VoteResult['kind'], string> = { start: 'New game', restart: 'Starting over', 'next-hand': 'Next hand',
  undo: 'Takeback', open: 'Table open', close: 'Table closed', kick: 'Chair freed' };
const ASK: Record<VoteResult['kind'], string> = { start: 'starting', restart: 'starting over', 'next-hand': 'the next hand',
  undo: 'the takeback', open: 'opening the table', close: 'closing the table', kick: 'that' };
export function describeResult(r: VoteResult): string {
  if (r.outcome === 'passed') return r.kind === 'kick' ? `${r.targetName ?? 'A chair'} stepped out · Walt plays that seat` : `${DONE[r.kind]} · ${r.byName} asked, the table agreed`;
  if (r.outcome === 'failed') return r.noFrom ? `${r.noFrom} said no to ${ASK[r.kind]}` : `Nobody answered ${r.byName} about ${ASK[r.kind]}`;
  return `Nothing left for ${ASK[r.kind]}`;
}
function useCountdown(deadline: number): number {
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
  useEffect(() => {
    setLeft(Math.max(0, deadline - Date.now()));
    const timer = setInterval(() => setLeft(Math.max(0, deadline - Date.now())), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return left;
}
/** One open question to the people present. Low stakes pass unless someone objects. */
export function VoteBar({ proposal, seat, seats, vote, pending }: {
  proposal: Proposal; seat: Seat | null; seats: (RoomSeat | null)[]; vote: (vote: Vote) => void; pending: boolean;
}) {
  const left = useCountdown(proposal.deadline), seconds = Math.ceil(left / 1000);
  const mine = seat === null ? undefined : proposal.votes[seat];
  const canVote = seat !== null && proposal.target !== seat && !pending;
  const text = proposal.kind === 'kick' && proposal.target !== undefined
    ? `${proposal.byName} asks ${seats[proposal.target]?.name ?? 'that chair'} to step out` : describeProposal(proposal);
  // The same arithmetic as the coordinator, over the seats it would count.
  const present = seats.filter((s, i) => s && s.connected && !s.away && i !== proposal.target).length;
  const yes = Object.values(proposal.votes).filter(v => v === 'yes').length;
  const more = Math.max(0, neededYes(proposal.needs, present) - yes);
  const nextHand = proposal.kind === 'next-hand';
  const note = proposal.mode === 'veto' ? `Goes ahead in ${seconds}s unless someone says no`
    : nextHand ? `Shakes when ${more === 1 ? 'one more person is' : `${more} more people are`} ready · ${seconds}s`
    : `Needs ${more === 1 ? 'a yes' : `${more} more yes`} within ${seconds}s`;
  return <div class={`vote-bar vote-${proposal.mode}`} role="status" data-proposal={proposal.id} data-kind={proposal.kind}>
    <div class="vote-text"><strong>{text}</strong><span>{note}{yes > 1 ? ` · ${yes} yes` : ''}</span></div>
    {seat === null ? null : proposal.target === seat ? <span class="vote-you">The table decides</span>
      : mine ? <span class="vote-you">{nextHand && mine === 'yes' ? 'You are ready' : `You said ${mine}`}</span>
      : <div class="vote-buttons">
        <button class="vote-yes" disabled={!canVote} onClick={() => vote('yes')}>{nextHand ? 'Ready' : proposal.mode === 'veto' ? 'Fine' : 'Yes'}</button>
        <button class="vote-no" disabled={!canVote} onClick={() => vote('no')}>{proposal.mode === 'veto' ? 'Wait, no' : nextHand ? 'Not yet' : 'No'}</button>
      </div>}
  </div>;
}
/** Whoever is at the door, beside (never behind) the table's vote. The first answer decides. */
export function Doorbell({ knocks, answer, disabled }: {
  knocks: readonly Knock[]; answer: (visitor: string, yes: boolean) => void; disabled: boolean;
}) {
  return <>{knocks.filter(knock => !knock.answer).map(knock =>
    <div key={knock.visitor} class="vote-bar vote-door" role="status" data-knock={knock.visitor}>
      <div class="vote-text"><strong>{knock.name} is at the door</strong><span>Anyone here can answer</span></div>
      <div class="vote-buttons">
        <button class="vote-yes" disabled={disabled} onClick={() => answer(knock.visitor, true)}>Let them in</button>
        <button class="vote-no" disabled={disabled} onClick={() => answer(knock.visitor, false)}>Not now</button>
      </div>
    </div>)}</>;
}
