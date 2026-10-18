import { accountSession, type AccountEnv } from './accounts';
import { json } from './http';
import type { Seat } from '../src/engine';

const mine = 'EXISTS (SELECT 1 FROM hand_players p WHERE p.hand_id=h.id AND p.account_id=?)';
const family = `h.finished=1 AND EXISTS (SELECT 1 FROM hand_players p JOIN accounts a ON a.id=p.account_id
  JOIN idea_members m ON m.id=a.member_id WHERE p.hand_id=h.id AND m.revoked=0)`;
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
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    return json({ error: e instanceof SyntaxError ? 'Invalid stats request.' : 'Stats are temporarily unavailable. Your saved hands are unchanged.' }, e instanceof SyntaxError ? 400 : 503);
  }
}
