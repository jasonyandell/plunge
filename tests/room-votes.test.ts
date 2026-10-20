import { describe, expect, it } from 'vitest';
import type { Seat } from '../src/engine';
import { newProposal, objector, proposalStatus, VOTE_RULES, voters } from '../worker/room-votes';

const present = (...seats: Seat[]) => new Set<Seat>(seats);
describe('one vote at a time', () => {
  it('passes low-stakes asks at once when the proposer is alone, otherwise after the veto window unless someone objects', () => {
    const solo = newProposal('p', 'undo', 0, 'Host', 1000);
    expect(proposalStatus(solo, present(0), 1000)).toBe('passed');
    const pair = newProposal('p', 'undo', 0, 'Host', 1000);
    expect(proposalStatus(pair, present(0, 2), 1000)).toBe('open');
    expect(proposalStatus(pair, present(0, 2), 5999)).toBe('open');
    expect(proposalStatus(pair, present(0, 2), 6000)).toBe('passed');
    expect(proposalStatus({ ...pair, votes: { 0: 'yes', 2: 'yes' } }, present(0, 2), 1001)).toBe('passed');
    expect(proposalStatus({ ...pair, votes: { 0: 'yes', 2: 'no' } }, present(0, 2), 1001)).toBe('failed');
    expect(objector({ ...pair, votes: { 0: 'yes', 2: 'no' } }, present(0, 2))).toBe(2);
    // Someone who dropped neither blocks nor decides; their old no stops counting.
    expect(proposalStatus({ ...pair, votes: { 0: 'yes', 2: 'no' } }, present(0), 1001)).toBe('passed');
    expect(proposalStatus(pair, present(0, 1, 2, 3), 6000)).toBe('passed');
  });
  it('keeps the result until everyone asked is ready, without counting disconnects as readiness', () => {
    const next = newProposal('n', 'next-hand', 0, 'Host', 1000, { electorate: [0, 1, 2, 3] });
    expect(next).toMatchObject({ mode: 'allow', needs: 'all' });
    const two = { ...next, votes: { 0: 'yes', 2: 'yes' } as const };
    expect(proposalStatus(two, present(0, 1, 2, 3), 1001)).toBe('open');
    expect(proposalStatus(two, present(0, 2), 1001)).toBe('open');
    expect(proposalStatus(two, present(0, 2), 1000 + VOTE_RULES['next-hand'].window)).toBe('failed');
    expect(proposalStatus({ ...two, votes: { 0: 'yes', 1: 'yes', 2: 'yes', 3: 'yes' } }, present(0, 1, 2, 3), 1001)).toBe('passed');
    expect(proposalStatus({ ...two, votes: { 0: 'yes', 3: 'no' } }, present(0, 1, 2, 3), 1001)).toBe('failed');
    const solo = newProposal('s', 'next-hand', 0, 'Host', 1000, { electorate: [0] });
    expect(proposalStatus(solo, present(0), 1001)).toBe('passed');
  });
  it('needs the rest of the table for a kick, and fails at the deadline', () => {
    const kick = newProposal('k', 'kick', 0, 'Host', 1000, { target: 1 });
    expect(voters(kick, present(0, 1, 2, 3))).toEqual([0, 2, 3]);
    expect(proposalStatus(kick, present(0, 1, 2, 3), 1000)).toBe('open');
    expect(proposalStatus({ ...kick, votes: { 0: 'yes', 1: 'no' } }, present(0, 1, 2, 3), 1001)).toBe('open');
    expect(proposalStatus({ ...kick, votes: { 0: 'yes', 2: 'yes' } }, present(0, 1, 2, 3), 1001)).toBe('passed');
    expect(proposalStatus({ ...kick, votes: { 0: 'yes', 3: 'no' } }, present(0, 1, 2, 3), 1001)).toBe('failed');
    expect(proposalStatus(kick, present(0, 1, 2, 3), 1000 + VOTE_RULES.kick.window)).toBe('failed');
    expect(proposalStatus(kick, present(0, 1), 1000)).toBe('passed');
  });
});
