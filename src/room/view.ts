import type { GameState, Seat } from '../engine';
export const relativeSeat = (absolute: Seat, viewer: Seat): Seat => ((absolute - viewer + 4) % 4) as Seat;
/** Presentation only. Wire actions and recorder state always use canonical seats. */
export function rotateGame(g: GameState, viewer: Seat): GameState {
  const seat = (s: Seat | null) => s === null ? null : relativeSeat(s, viewer);
  const teams = (pair: readonly [number, number]): readonly [number, number] => viewer % 2 ? [pair[1], pair[0]] : pair;
  const play = (p: GameState['currentTrick'][number]) => ({ ...p, seat: relativeSeat(p.seat, viewer) });
  return { ...g, hands: [0,1,2,3].map(i => g.hands[(i + viewer) % 4]!), dealt: [0,1,2,3].map(i => g.dealt[(i + viewer) % 4]!),
    shaker: relativeSeat(g.shaker, viewer), turn: seat(g.turn), declarer: seat(g.declarer), sittingOut: seat(g.sittingOut), leader: seat(g.leader),
    bids: g.bids.map(b => ({ ...b, seat: relativeSeat(b.seat, viewer) })), currentTrick: g.currentTrick.map(play),
    tricks: g.tricks.map(t => ({ ...t, winner: relativeSeat(t.winner, viewer), plays: t.plays.map(play) })),
    marks: teams(g.marks), points: teams(g.points), winner: g.winner === null ? null : ((g.winner + viewer) % 2) as 0 | 1,
    handResult: g.handResult ? { ...g.handResult, declarer: relativeSeat(g.handResult.declarer, viewer), team: ((g.handResult.team + viewer) % 2) as 0 | 1 } : null,
  };
}
