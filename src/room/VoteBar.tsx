import { useEffect, useState } from 'preact/hooks';
import type { Seat } from '../engine';
import type { Proposal, Vote, VoteResult } from './protocol';

export function describeProposal(p: Proposal): string {
  switch (p.kind) {
    case 'start': return `${p.byName} wants to start the game`;
    case 'restart': return `${p.byName} wants to start over`;
    case 'next-hand': return `${p.byName} is shaking the next hand`;
    case 'undo': return `${p.byName} wants to take back the last move`;
    case 'open': return `${p.byName} wants to open the table`;
    case 'close': return `${p.byName} wants to close the table`;
    case 'kick': return `${p.byName} asks someone to step out`;
    case 'admit': return `${p.byName} is knocking`;
  }
}
const DONE: Record<VoteResult['kind'], string> = { start: 'New game', restart: 'Starting over', 'next-hand': 'Next hand',
  undo: 'Takeback', open: 'Table open', close: 'Table closed', kick: 'Chair freed', admit: 'Come on in' };
const ASK: Record<VoteResult['kind'], string> = { start: 'starting', restart: 'starting over', 'next-hand': 'the next hand',
  undo: 'the takeback', open: 'opening the table', close: 'closing the table', kick: 'that', admit: 'letting them in' };
export function describeResult(r: VoteResult): string {
  if (r.outcome === 'passed') return r.kind === 'admit' ? `${DONE.admit} · the table let ${r.byName} in`
    : r.kind === 'kick' ? `${r.targetName ?? 'A chair'} stepped out · Walt plays that seat` : `${DONE[r.kind]} · ${r.byName} asked, the table agreed`;
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
  proposal: Proposal; seat: Seat | null; seats: ({ name: string } | null)[]; vote: (vote: Vote) => void; pending: boolean;
}) {
  const left = useCountdown(proposal.deadline), seconds = Math.ceil(left / 1000);
  const mine = seat === null ? undefined : proposal.votes[seat];
  const canVote = seat !== null && proposal.target !== seat && !pending;
  const text = proposal.kind === 'kick' && proposal.target !== undefined
    ? `${proposal.byName} asks ${seats[proposal.target]?.name ?? 'that chair'} to step out` : describeProposal(proposal);
  const tally = Object.values(proposal.votes).filter(v => v === 'yes').length;
  return <div class={`vote-bar vote-${proposal.mode}`} role="status" data-proposal={proposal.id} data-kind={proposal.kind}>
    <div class="vote-text"><strong>{text}</strong>
      <span>{proposal.mode === 'veto' ? `Goes ahead in ${seconds}s unless someone says no` : `Needs a yes within ${seconds}s`}{tally > 1 ? ` · ${tally} yes` : ''}</span></div>
    {seat === null ? null : proposal.target === seat ? <span class="vote-you">The table decides</span>
      : mine ? <span class="vote-you">You said {mine}</span>
      : <div class="vote-buttons">
        <button class="vote-yes" disabled={!canVote} onClick={() => vote('yes')}>{proposal.kind === 'admit' ? 'Let them in' : proposal.mode === 'veto' ? 'Fine' : 'Yes'}</button>
        <button class="vote-no" disabled={!canVote} onClick={() => vote('no')}>{proposal.mode === 'veto' ? 'Wait, no' : 'No'}</button>
      </div>}
  </div>;
}
