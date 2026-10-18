/**
 * Hands, one shape for solo play and family rooms. A signed-in device uploads
 * its local hands log; a room records its own hands (worker/rooms.ts). Both
 * land through `handStatements`: one `hands` row per hand attempt with the
 * facts decoded from its replay, and one `hand_players` row per human seat.
 * The record is stored exactly as sent, so clients can attach more detail
 * without a server change. First write wins per hand and nothing here ever
 * overwrites. Stats are greedy: whoever is signed in claims the device's hands.
 */
import { DEVICE_ID, GAME_ID, MAX_UPLOAD_BYTES, UPLOAD_BATCH, handSummary, validHandRecord } from '../src/history/hand-record';
import type { HandRecord } from '../src/history/legacy';
import { accountSession, type AccountEnv } from './accounts';
import type { IdeasDatabase } from './ideas';
import { json, readJson } from './http';
export interface SeatPlayer { seat: number; account?: string | null; device?: string | null; name?: string | null }
/** `raw` is the record exactly as the client sent it, stored verbatim; `record` its checked fields. */
export interface HandEntry { record: HandRecord; raw?: unknown; roomId?: string | null; walt?: string | null; players: readonly SeatPlayer[] }
/** The stored id: a device's hands are its own, a room's hands are the room's. */
export const handId = (entry: HandEntry) => entry.roomId ? `room:${entry.roomId}:${entry.record.id}` : `${entry.players[0]?.device}:${entry.record.id}`;
/** Insert statements for hands; `INSERT OR IGNORE` keeps the first write of each. */
export function handStatements(db: IdeasDatabase, entries: readonly HandEntry[], now = new Date().toISOString()) {
  const statements = [];
  for (const entry of entries) {
    const { record, game } = validHandRecord(entry.raw ?? entry.record), facts = handSummary(record, game), id = handId(entry);
    statements.push(db.prepare(`INSERT OR IGNORE INTO hands(id,room_id,deal,ended_at,received,walt,finished,bidder,bid,contract,declaration,result_team,result_marks,
      team0_points,team1_points,team0_tricks,team1_tricks,payload) VALUES(${Array(18).fill('?').join(',')})`)
      .bind(id, entry.roomId ?? null, facts.deal, record.endedAt, now, entry.walt ?? null, facts.finished ? 1 : 0, facts.bidder, facts.bid, facts.contract, facts.declaration,
        facts.resultTeam, facts.resultMarks, facts.points[0], facts.points[1], facts.tricks[0], facts.tricks[1], JSON.stringify(entry.raw ?? entry.record)));
    for (const p of entry.players) statements.push(db.prepare('INSERT OR IGNORE INTO hand_players(hand_id,seat,account_id,device_id,name) VALUES(?,?,?,?,?)')
      .bind(id, p.seat, p.account ?? null, p.device ?? null, p.name ?? null));
  }
  return statements;
}
/**
 * PUT /api/stats/hands {device, hands}: store the device's hands for the
 * signed-in account and say which are now connected. An empty list just
 * returns the account's total, which is what the account page shows.
 */
export async function statsRequest(request: Request, env: AccountEnv): Promise<Response> {
  const url = new URL(request.url), db = env.QUESTIONS;
  if (url.pathname !== '/api/stats/hands' || request.method !== 'PUT') return json({ error: 'Not found.' }, 404);
  if (!db) return json({ error: 'This preview keeps stats on your device only.', local_only: true }, 503);
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Please use the Plunge app.' }, 403);
  try {
    const account = await accountSession(request, env);
    if (!account) return json({ error: 'Sign in to connect your stats.' }, 401);
    const data = await readJson(request, MAX_UPLOAD_BYTES);
    if (typeof data.device !== 'string' || !DEVICE_ID.test(data.device)) return json({ error: 'Invalid device.' }, 400);
    if (!Array.isArray(data.hands) || data.hands.length > UPLOAD_BATCH) return json({ error: `Send up to ${UPLOAD_BATCH} hands at a time.` }, 400);
    const device = data.device, entries: HandEntry[] = [], rejected: { id: string; error: string }[] = [];
    for (const value of data.hands) {
      const id = value && typeof value === 'object' && typeof (value as { id: unknown }).id === 'string' ? (value as { id: string }).id.slice(0, 90) : '';
      try {
        const { record } = validHandRecord(value);
        // Solo play: the human at seat 0, this device's Walt in the other three. The record is kept as sent.
        entries.push({ record, raw: value, walt: record.player, players: [{ seat: 0, account: account.id, device }] });
      } catch (error) { rejected.push({ id, error: error instanceof Error ? error.message : 'Invalid hand record.' }); }
    }
    if (entries.length) await db.batch(handStatements(db, entries));
    const total = await db.prepare('SELECT COUNT(DISTINCT hand_id) n FROM hand_players WHERE account_id=?').bind(account.id).first<{ n: number }>();
    return json({ account: account.id, stored: entries.map((e) => e.record.id), rejected, total: total?.n ?? 0 });
  } catch (error) { return error instanceof SyntaxError ? json({ error: error.message }, 400) : json({ error: 'Stats are temporarily unavailable. Your device keeps them and can retry.' }, 503); }
}
