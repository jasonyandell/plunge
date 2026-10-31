import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VNode } from 'preact';
import { modState, reloadMods } from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import type { Proposal, VoteSlotProps } from '../src/kernel/mod-api';
import { voteNotice } from '../src/mods/vote-notice';

const css = readFileSync(resolve(__dirname, '../src/mods/vote-notice/vote-notice.css'), 'utf8');
const visit = (search: string) => { vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods(); };
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

const proposal = (kind: Proposal['kind']) => ({ id: 'p', kind, mode: 'allow', needs: 'all', by: 1, byName: 'Gran', at: 0, deadline: 0, votes: {} }) as unknown as Proposal;
const props = (kind: Proposal['kind'], mine?: 'yes' | 'no'): VoteSlotProps => ({ proposal: proposal(kind), seat: 0, mine, yes: mine === 'yes' ? 1 : 0, more: 1 });
const render = (name: 'vote-heading' | 'vote-status', p: VoteSlotProps) =>
  slotParts(name, modState().enabled).map(({ Part }) => (Part as (p: VoteSlotProps) => VNode<{ class: string; children: string }> | null)(p));

describe('vote notice mod', () => {
  it('is off unless the link turns it on, and then fills nothing in the vote', () => {
    expect(voteNotice.defaultOn).toBe(false);
    visit('');
    expect(render('vote-heading', props('player'))).toEqual([]);
    expect(render('vote-status', props('player', 'yes'))).toEqual([]);
  });
  it('heads a computer player vote, and says it is waiting once you said yes', () => {
    visit('?mods=vote-notice');
    expect(render('vote-heading', props('player'))[0]?.props).toEqual({ class: 'vote-notice-heading', children: 'Computer player vote' });
    expect(render('vote-status', props('player'))).toEqual([null]);
    expect(render('vote-status', props('player', 'no'))).toEqual([null]);
    expect(render('vote-status', props('player', 'yes'))[0]?.props.children).toBe('Waiting for the table');
  });
  it('leaves other votes alone', () => {
    visit('?mods=vote-notice');
    for (const kind of ['start', 'restart', 'next-hand', 'undo', 'open', 'close', 'kick'] as const) {
      expect(render('vote-heading', props(kind))).toEqual([null]);
      expect(render('vote-status', props(kind, 'yes'))).toEqual([null]);
    }
  });
  it('turns the player vote into a big card, keyed on core\'s data-kind', () => {
    expect(css).toMatch(/:root\[data-mods~="vote-notice"\] \.vote-bar\[data-kind="player"\] \{[^}]*flex-direction: column;[^}]*border: 2px solid/);
    expect(readFileSync(resolve(__dirname, '../src/room/VoteBar.tsx'), 'utf8')).toContain('data-kind={proposal.kind}');
  });
});
