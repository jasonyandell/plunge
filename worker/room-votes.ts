/** The table's one vote at a time. Everyone has a voice; nobody waits long. */
import type { Seat } from '../src/engine';
import type { Proposal, ProposalKind, ProposalMode } from '../src/room/protocol';

export interface VoteRule { mode: ProposalMode; needs: 'all' | 'one' | 'majority'; window: number }
/** Low stakes pass unless someone objects within five seconds. Admitting a knock
 * takes one yes; a kick takes most of the table. Tune here, nowhere else. */
export const VOTE_RULES: Record<ProposalKind, VoteRule> = {
  start: { mode: 'veto', needs: 'all', window: 5000 },
  restart: { mode: 'veto', needs: 'all', window: 5000 },
  'next-hand': { mode: 'veto', needs: 'all', window: 5000 },
  undo: { mode: 'veto', needs: 'all', window: 5000 },
  open: { mode: 'veto', needs: 'all', window: 5000 },
  close: { mode: 'veto', needs: 'all', window: 5000 },
  kick: { mode: 'allow', needs: 'majority', window: 10000 },
  admit: { mode: 'allow', needs: 'one', window: 60000 },
};
export const PROPOSAL_KINDS = Object.keys(VOTE_RULES) as ProposalKind[];

export function newProposal(id: string, kind: ProposalKind, by: Seat | null, byName: string, now: number,
  extra: { target?: Seat; knock?: string } = {}): Proposal {
  const rule = VOTE_RULES[kind];
  return { id, kind, mode: rule.mode, needs: rule.needs, by, byName, ...extra, at: now, deadline: now + rule.window,
    votes: by === null ? {} : { [by]: 'yes' } };
}

/** Live electorate: seated humans present right now, minus a kick's target.
 * Walt never votes and absent people never block. */
export function voters(proposal: Proposal, present: ReadonlySet<Seat>): Seat[] {
  return [...present].filter(seat => seat !== proposal.target).sort();
}
/** Derived, never stored: the same proposal settles differently as people come and go. */
export function proposalStatus(proposal: Proposal, present: ReadonlySet<Seat>, now: number): 'open' | 'passed' | 'failed' {
  const electorate = voters(proposal, present);
  if (electorate.some(seat => proposal.votes[seat] === 'no')) return 'failed';
  const yes = electorate.filter(seat => proposal.votes[seat] === 'yes').length;
  const needed = proposal.needs === 'all' ? electorate.length : proposal.needs === 'one' ? 1 : Math.floor(electorate.length / 2) + 1;
  if (needed > 0 ? yes >= needed : proposal.mode === 'veto') return 'passed';
  if (now < proposal.deadline) return 'open';
  return proposal.mode === 'veto' ? 'passed' : 'failed';
}
export function objector(proposal: Proposal, present: ReadonlySet<Seat>): Seat | undefined {
  return voters(proposal, present).find(seat => proposal.votes[seat] === 'no');
}
