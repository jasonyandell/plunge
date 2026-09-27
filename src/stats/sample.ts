/**
 * Sample stats for an empty log: a deterministic slate of complete games,
 * played through the real engine on catalogued deals by the heuristic club
 * player. Hand records are genuine replays (so wins, bids, assists and the
 * book-agreement stats are computed for real); Walt's play review is the one
 * fabricated part, seeded so the preview reads the same on every device.
 *
 * Nothing here ever touches the log — the sample lives only in memory.
 */
import {
  LEGACY_PLUNGE_CONFIG,
  applyAction,
  legalActions,
  legalDominoes,
  mulberry32,
  newGame,
  toSeed,
} from '../engine';
import { catalogueDeal } from '../ai/catalogue';
import { mediumAction } from '../ai/medium';
import { observe } from '../ai/observation';
import { tileOfId } from '../ai/walt/requests';
import { ANALYSIS_PROFILE } from './analysis';
import { encodeReplay } from '../engine/replay-code';
import type { GameState } from '../engine';
import type { ScoredHand } from '../records/model';
import type { HandAnalysis, PlyVerdict } from './log';
import { handSteps } from './replay';
import { decodeRecords } from './aggregate';

export interface SampleData {
  readonly hands: readonly ScoredHand[];
  readonly analyses: readonly HandAnalysis[];
}

const GAMES = 8;
const START_MS = Date.parse('2026-08-30T19:00:00Z');

const COMPUTER = { kind: 'computer', player: 'sample', walt: null } as const;

function sampleHand(g: GameState, gameId: string, ended: string): ScoredHand | null {
  const code = encodeReplay(g);
  if (!code) return null;
  const marksBefore: [number, number] = [g.marks[0], g.marks[1]];
  if (g.handResult) marksBefore[g.handResult.team] -= g.handResult.marks;
  return { id: `${gameId}:${g.handNumber}`, game: { id: gameId, hand: g.handNumber }, ended, outcome: 'finished',
    marksBefore, code, seats: [{ kind: 'person' }, COMPUTER, COMPUTER, COMPUTER] };
}

function playGame(index: number): ScoredHand[] {
  const seed = `walt-demo-${index + 1}`;
  const gameId = `sample-${index + 1}`;
  const rand = mulberry32(toSeed(seed));
  let endedMs = START_MS + index * 26 * 3_600_000;
  let g = catalogueDeal(newGame(LEGACY_PLUNGE_CONFIG, seed), seed);
  const records: ScoredHand[] = [];
  for (let guard = 0; guard < 3000; guard++) {
    if (g.phase === 'hand-over' || g.phase === 'game-over') {
      endedMs += (6 + Math.floor(rand() * 7)) * 60_000;
      const record = sampleHand(g, gameId, new Date(endedMs).toISOString());
      if (record) records.push(record);
      if (g.phase === 'game-over') return records;
      g = catalogueDeal(applyAction(g, { type: 'next-hand' }), seed);
      continue;
    }
    if (g.turn === null) throw new Error('sample game stalled');
    g = applyAction(g, mediumAction(observe(g, g.turn), legalActions(g), rand));
  }
  throw new Error('sample game never finished');
}

/** Plausible, clearly-labeled review verdicts for the preview dashboard. */
function fakeAnalysis(record: ScoredHand): HandAnalysis | null {
  const decoded = decodeRecords([record])[0];
  const steps = decoded && handSteps(decoded.game);
  if (!steps) return null;
  const rand = mulberry32(toSeed(record.id));
  const plies: PlyVerdict[] = [];
  let ply = -1;
  for (const { state, action } of steps) {
    if (action.type !== 'play') continue;
    ply++;
    if (state.turn !== 0) continue;
    const legal = legalDominoes(state).map(tileOfId);
    const played = tileOfId(action.domino);
    if (legal.length === 1) {
      plies.push({ ply, played, suggested: played, forced: true, playedChance: null, bestChance: null, playedBest: true });
      continue;
    }
    if (rand() < 0.72) {
      const chance = 0.45 + rand() * 0.5;
      plies.push({ ply, played, suggested: played, forced: false, playedChance: chance, bestChance: chance, playedBest: true });
      continue;
    }
    const others = legal.filter((t) => t !== played);
    const suggested = others[Math.floor(rand() * others.length)] ?? played;
    const gap = rand() < 0.4 ? 0.01 + rand() * 0.04 : 0.05 + rand() * 0.25;
    const bestChance = Math.min(0.99, 0.5 + rand() * 0.45);
    plies.push({
      ply, played, suggested, forced: false,
      playedChance: Math.max(0.01, bestChance - gap), bestChance, playedBest: false,
    });
  }
  return { schema: 'plunge-hand-analysis-v1', id: record.id, profile: ANALYSIS_PROFILE, plies, unsupported: false };
}

let cached: SampleData | undefined;

export function sampleData(): SampleData {
  if (cached) return cached;
  const hands = Array.from({ length: GAMES }, (_, i) => playGame(i)).flat();
  const analyses = hands.map(fakeAnalysis).filter((a): a is HandAnalysis => a !== null);
  return cached = { hands, analyses };
}
