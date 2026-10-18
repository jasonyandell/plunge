import { accountSession, type AccountEnv, type Account } from './accounts';
import { json, readJson } from './http';
import type { IdeasDatabase } from './ideas';
import type { Seat, Action } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { actionKey, ghostProgress } from '../src/stats/ghost';
import type { HandRecord } from '../src/history/legacy';

const mine = 'EXISTS (SELECT 1 FROM hand_players p WHERE p.hand_id=h.id AND p.account_id=?)';
const family = `h.finished=1 AND EXISTS (SELECT 1 FROM hand_players p JOIN accounts a ON a.id=p.account_id
  JOIN idea_members m ON m.id=a.member_id WHERE p.hand_id=h.id AND m.revoked=0)`;
async function visible(db: IdeasDatabase, account: Account, id: string) {
  return db.prepare(`SELECT h.payload FROM hands h WHERE h.id=? AND (${mine}${account.family ? ` OR (${family})` : ''})`)
    .bind(id, account.id).first<{payload:string}>();
}
async function attempts(db: IdeasDatabase, account: string, hand: string, seat: number) {
  const { results } = await db.prepare(`SELECT attempt_id id,choices,matched,total,done FROM replay_attempts
    WHERE account_id=? AND hand_id=? AND seat=? ORDER BY seq`).bind(account, hand, seat)
    .all<{id:string; choices:string; matched:number; total:number; done:number}>();
  return results.map(r => ({ ...r, choices: JSON.parse(r.choices) as Action[], done: !!r.done }));
}
export async function statsBrowseRequest(request: Request, env: AccountEnv): Promise<Response> {
  const db = env.QUESTIONS, url = new URL(request.url);
  if (!db) return json({ error: 'This preview keeps stats on your device.', local_only: true }, 503);
  try {
    const account = await accountSession(request, env);
    if (!account) return json({ error: 'Sign in to browse account hands.' }, 401);
    if (url.pathname === '/api/stats/browse') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      const scope = url.searchParams.get('scope') ?? 'mine', before = url.searchParams.get('before') ?? '';
      if (!['mine', 'family'].includes(scope) || before.length > 240) return json({ error: 'Invalid hand filter.' }, 400);
      if (scope === 'family' && !account.family) return json({ error: 'Family access is required.' }, 403);
      const { results } = await db.prepare(`SELECT h.id,h.payload FROM hands h WHERE ${scope === 'mine' ? mine : family}
        ${before ? 'AND h.id<?' : ''} ORDER BY h.id DESC LIMIT 101`)
        .bind(...(scope === 'mine' ? [account.id] : []), ...(before ? [before] : [])).all<{id:string; payload:string}>();
      const page = results.slice(0, 100);
      const people = page.length ? (await db.prepare(`SELECT p.hand_id,p.seat,COALESCE(p.name,a.name,'Player') name
        FROM hand_players p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.hand_id IN (${page.map(() => '?').join(',')})
        ORDER BY p.seat,p.account_id`).bind(...page.map(h => h.id)).all<{hand_id:string; seat:Seat; name:string}>()).results : [];
      const players = (id: string) => ([0, 1, 2, 3] as Seat[]).flatMap(seat => {
        const names = [...new Set(people.filter(p => p.hand_id === id && p.seat === seat).map(p => p.name))];
        return names.length ? [{ seat, name: names.join(' / ') }] : [];
      });
      return json({ account: account.id, family: !!account.family, items: page.map(h => ({ id: h.id, record: JSON.parse(h.payload),
        players: players(h.id), remote: true })),
        next: results.length > 100 ? page[page.length - 1]!.id : null });
    }
    const hand = url.searchParams.get('hand') ?? '', rawSeat = url.searchParams.get('seat') ?? '';
    if (!hand || hand.length > 240 || !/^[0-3]$/.test(rawSeat)) return json({ error: 'Choose a hand and seat.' }, 400);
    const seat = Number(rawSeat) as Seat, source = await visible(db, account, hand);
    if (!source) return json({ error: 'Hand not found or no longer shared with you.' }, 404);
    const original = decodeReplay((JSON.parse(source.payload) as HandRecord).code);
    if (!original || !['hand-over', 'game-over'].includes(original.phase)) return json({ error: 'Ghost play needs a completed hand.' }, 400);
    if (request.method === 'GET') return json({ account: account.id, attempts: await attempts(db, account.id, hand, seat) });
    if (!['POST', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'Please use the Plunge app.' }, 403);
    const data = await readJson(request, 16000);
    if (data.account !== account.id) return json({ error: 'Your signed-in account changed. Reopen stats.' }, 409);
    if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) return json({ error: 'Invalid attempt.' }, 400);
    if (request.method === 'POST') {
      const progress = ghostProgress(original, seat, []);
      await db.prepare(`INSERT INTO replay_attempts(account_id,hand_id,seat,attempt_id,choices,matched,total,done)
        SELECT ?,?,?,?,'[]',0,?,? WHERE NOT EXISTS
          (SELECT 1 FROM replay_attempts WHERE account_id=? AND hand_id=? AND seat=? AND done=0)
        ON CONFLICT(account_id,hand_id,seat,attempt_id) DO NOTHING`)
        .bind(account.id, hand, seat, data.id, progress.total, progress.done ? 1 : 0, account.id, hand, seat).run();
    } else {
      if (!Array.isArray(data.choices) || data.choices.length > 50) return json({ error: 'Invalid choices.' }, 400);
      const previous = await db.prepare(`SELECT choices,done FROM replay_attempts WHERE account_id=? AND hand_id=? AND seat=? AND attempt_id=?`)
        .bind(account.id, hand, seat, data.id).first<{choices:string; done:number}>();
      if (!previous) return json({ error: 'Start or resume this attempt first.' }, 409);
      const old = JSON.parse(previous.choices) as Action[], choices = data.choices as Action[];
      let progress;
      try {
        progress = ghostProgress(original, seat, choices);
        if (choices.length < old.length || choices.length > old.length + 1
          || old.some((a, i) => actionKey(a) !== actionKey(choices[i]!))
          || (previous.done && choices.length !== old.length)) throw new Error('Earlier choices cannot be replaced.');
      } catch { return json({ error: 'That attempt changed. Reload to resume its saved choices.' }, 409); }
      const payload = JSON.stringify(choices);
      await db.prepare(`UPDATE replay_attempts SET choices=?,matched=?,total=?,done=?
        WHERE account_id=? AND hand_id=? AND seat=? AND attempt_id=? AND choices=?`)
        .bind(payload, progress.matched, progress.total, progress.done ? 1 : 0, account.id, hand, seat, data.id, previous.choices).run();
      const saved = await db.prepare('SELECT choices FROM replay_attempts WHERE account_id=? AND hand_id=? AND seat=? AND attempt_id=?')
        .bind(account.id, hand, seat, data.id).first<{choices:string}>();
      if (saved?.choices !== payload) return json({ error: 'Another tab saved a choice. Reload to resume.' }, 409);
    }
    const saved = await attempts(db, account.id, hand, seat);
    if (!saved.some(a => a.id === data.id)) return json({ error: 'An attempt is already underway. Reload to resume it.' }, 409);
    return json({ account: account.id, attempts: saved });
  } catch (e) {
    return json({ error: e instanceof SyntaxError ? 'Invalid replay request.' : 'Stats are temporarily unavailable. Your saved hands are unchanged.' }, e instanceof SyntaxError ? 400 : 503);
  }
}
