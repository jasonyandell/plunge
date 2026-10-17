import type { GameState, Seat } from '../engine';
import type { ListedTable, RoomState } from './protocol';
import { DEFAULT_SETTINGS, initialApp } from '../ui/store';
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

/** What the recorder keeps for a shared table: canonical seats, hints off, the table's Nel-O rule. */
export function roomHistory(room: RoomState, localSeat: Seat) {
  return { ...initialApp(), screen: 'table' as const, settings: { ...DEFAULT_SETTINGS, showHints: false, nelloPreview: room.game?.config.nello === 'open' },
    seed: room.seed, game: room.game, sessionId: room.sessionId, nativeReceipts: room.nativeReceipts, auctionSurveys: room.auctionSurveys,
    epoch: room.revision, retry: room.retry ?? null, practiceHands: room.practiceHands ?? [],
    room: { mode: 'shared-room' as const, localSeat, revision: room.revision,
      humans: room.seats.flatMap((s, seat) => s ? [{ seat: seat as Seat, name: s.name }] : []) },
  };
}

/** How a listed table reads on the home screen: whose it is, who is here, and the door. */
export const tableTitle = (table: ListedTable): string =>
  table.standing ? 'Family table' : `${table.seats.find(seat => seat)?.name ?? 'Someone'}’s table`;
export function tableNote(table: ListedTable): string {
  const here = table.seats.flatMap(seat => seat?.connected ? [seat.name] : []);
  const who = here.length === 0 ? 'Nobody here right now' : `${here.join(', ')} here`;
  return `${who} · ${table.open ? 'Open, sit right down' : 'Closed, knock to come in'}`;
}
