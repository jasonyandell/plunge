/**
 * The reviewable hands on this device, gathered READ-ONLY from every local
 * record format: PR16 history snapshots, the plunge-stats log, the rescued
 * plunge-records journal (PR7 hand-v2), and staged writes still waiting in
 * localStorage. Nothing here writes, migrates, or deletes. A record this
 * build cannot read is counted and left untouched; a store that fails to
 * open is named so the player knows to export rather than worry.
 */
import type { GameState } from '../engine';
import { decodeReplay, encodeReplay } from '../engine/replay-code';
import { handSteps } from './steps';
import { listHistory, readExistingDatabase } from '../history/recorder';
import { listHands } from '../history/legacy';

export type SourceName = 'history' | 'stats' | 'records' | 'pending' | 'example';

export interface ReviewHand {
  /** Stable navigation key, safe across reloads. */
  readonly key: string;
  readonly code: string;
  readonly game: GameState;
  readonly gameId: string | null;
  readonly handNumber: number | null;
  readonly recordedAt: string | null;
  readonly sources: readonly SourceName[];
  readonly finished: boolean;
  /** Action indices that a displayed hint preceded (hand-v2 records only). */
  readonly hintsBefore: readonly number[];
}

export interface Unreadable { readonly source: SourceName; readonly schema: string; readonly count: number }

export interface Library {
  readonly hands: readonly ReviewHand[];
  readonly unreadable: readonly Unreadable[];
  /** Stores that could not be opened or read right now. */
  readonly unavailable: readonly SourceName[];
}

interface Candidate {
  readonly source: SourceName;
  readonly code: string;
  readonly gameId: string | null;
  readonly handNumber: number | null;
  readonly at: string | null;
  readonly hints: readonly number[];
}

const str = (v: unknown): string | null => typeof v === 'string' ? v : null;
const num = (v: unknown): number | null => Number.isSafeInteger(v) ? v as number : null;

function schemaOf(r: unknown): string {
  const o = r as { schema?: unknown; record?: { schema?: unknown } } | null;
  return str(o?.schema) ?? str(o?.record?.schema) ?? (o && typeof o === 'object' && 'game' in o ? 'app-state' : 'unknown');
}

/** One record to a candidate, or null when this build cannot read it. */
function candidateOf(source: SourceName, raw: unknown): Candidate | null | 'empty' {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  switch (schemaOf(r)) {
    case 'plunge-history-v1': {
      const code = str(r.code) ?? (r.engineState ? safeEncode(r.engineState as GameState) : null);
      return code ? { source, code, gameId: str(r.gameId), handNumber: num(r.handNumber), at: str(r.recordedAt), hints: [] } : null;
    }
    case 'plunge-hand-v1':
      return str(r.code) ? { source, code: r.code as string, gameId: str(r.gameId), handNumber: num(r.handNumber), at: str(r.endedAt), hints: [] } : null;
    case 'plunge-hand-v2': {
      const h = (r.record ?? r) as Record<string, unknown> & { game?: { id?: unknown; hand?: unknown }; assist?: unknown };
      const hints = Array.isArray(h.assist) ? h.assist.map(a => num((a as { before?: unknown })?.before)).filter((n): n is number => n !== null) : [];
      return str(h.code) ? { source, code: h.code as string, gameId: str(h.game?.id), handNumber: num(h.game?.hand), at: str(h.ended), hints } : null;
    }
    case 'app-state': {
      // A staged write: the whole app state, kept until the recorder lands it.
      if (!r.game) return 'empty';
      const code = safeEncode(r.game as GameState);
      return code ? { source, code, gameId: str(r.sessionId), handNumber: num((r.game as GameState).handNumber), at: null, hints: [] } : null;
    }
    default:
      return null;
  }
}

function safeEncode(g: GameState): string | null {
  try { return encodeReplay(g); } catch { return null; }
}

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/** Merge raw records into reviewable hands. Pure: no storage access. */
export function collectHands(raw: ReadonlyArray<{ source: SourceName; records: readonly unknown[] }>): Pick<Library, 'hands' | 'unreadable'> {
  const unreadable = new Map<string, Unreadable>();
  const groups = new Map<string, Candidate[]>();
  for (const { source, records } of raw) {
    for (const record of records) {
      const c = candidateOf(source, record);
      if (c === 'empty') continue;
      if (!c) {
        const schema = schemaOf(record), k = `${source}|${schema}`;
        unreadable.set(k, { source, schema, count: (unreadable.get(k)?.count ?? 0) + 1 });
        continue;
      }
      const group = c.gameId !== null && c.handNumber !== null ? `${c.gameId}:${c.handNumber}` : `code:${shortHash(c.code)}`;
      groups.set(group, [...(groups.get(group) ?? []), c]);
    }
  }
  const byCode = new Map<string, ReviewHand>();
  for (const [group, cands] of groups) {
    // Snapshots of one hand grow action by action; keep each distinct line's longest code.
    const lines: Candidate[][] = [];
    for (const c of [...cands].sort((a, b) => b.code.length - a.code.length)) {
      const line = lines.find(l => l[0]!.code.startsWith(c.code));
      if (line) line.push(c); else lines.push([c]);
    }
    lines.forEach((line, i) => {
      const top = line[0]!, game = decodeReplay(top.code), steps = game && handSteps(game);
      if (!game || !steps) {
        const k = `${top.source}|unreplayable`;
        unreadable.set(k, { source: top.source, schema: 'unreplayable', count: (unreadable.get(k)?.count ?? 0) + 1 });
        return;
      }
      if (steps.length === 0) return;
      const existing = byCode.get(top.code);
      const sources = [...new Set([...(existing?.sources ?? []), ...line.map(c => c.source)])];
      const at = [...line.map(c => c.at), existing?.recordedAt ?? null].filter((v): v is string => !!v).sort().pop() ?? null;
      const hints = [...new Set([...(existing?.hintsBefore ?? []), ...line.flatMap(c => c.hints)])].sort((a, b) => a - b);
      byCode.set(top.code, {
        key: existing?.key ?? (i === 0 ? group : `${group}~${i}`),
        code: top.code, game, gameId: existing?.gameId ?? top.gameId, handNumber: existing?.handNumber ?? top.handNumber,
        recordedAt: at, sources, finished: game.phase === 'hand-over' || game.phase === 'game-over', hintsBefore: hints,
      });
    });
  }
  const hands = [...byCode.values()].sort((a, b) => (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''));
  return { hands, unreadable: [...unreadable.values()] };
}

export const PENDING_PREFIX = 'plunge:history:pending:';

export interface LibrarySources {
  history(): Promise<unknown[]>;
  stats(): Promise<unknown[]>;
  records(): Promise<unknown[]>;
  pending(): Promise<unknown[]>;
}

/** Read every source independently; one failing store never hides the others. */
export async function loadLibrary(sources: LibrarySources): Promise<Library> {
  const unavailable: SourceName[] = [];
  const read = async (source: SourceName, f: () => Promise<unknown[]>) => {
    try { return { source, records: await f() }; } catch { unavailable.push(source); return { source, records: [] }; }
  };
  const raw = await Promise.all([
    read('history', sources.history), read('stats', sources.stats), read('records', sources.records), read('pending', sources.pending),
  ]);
  return { ...collectHands(raw), unavailable };
}

/** The real device stores, read-only. */
export async function deviceSources(): Promise<LibrarySources> {
  return {
    history: listHistory,
    stats: listHands,
    // Only read the rescued journal if it already exists: opening a missing
    // database would create it empty and break that schema's own upgrade.
    records: async () => {
      const db = await readExistingDatabase('plunge-records');
      return db?.hands ?? [];
    },
    pending: async () => {
      if (typeof localStorage === 'undefined') return [];
      const out: unknown[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PENDING_PREFIX)) continue;
        try { out.push(JSON.parse(localStorage.getItem(key)!)); } catch { out.push({ schema: 'unparseable-pending' }); }
      }
      return out;
    },
  };
}

/** A QA stand-in for storage that refuses to open, so the failure copy can be checked on a phone. */
export function failingSources(): LibrarySources {
  const fail = () => Promise.reject(new DOMException('Simulated storage failure', 'UnknownError'));
  return { history: fail, stats: fail, records: fail, pending: fail };
}
