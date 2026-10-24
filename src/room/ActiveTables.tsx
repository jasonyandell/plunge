import { useEffect, useState } from 'preact/hooks';
import { liveTables, roomUrl, savedSeat } from './client';
import type { ListedTable } from './protocol';
import { tableTitle } from './view';

/** The public listing contains names and presence, never hands or seat keys. */
export function activeTables(tables: readonly ListedTable[]): ListedTable[] {
  return tables.filter(table => table.seats.some(seat => seat?.connected));
}

/** Open a table as a fresh page load. From the rooms page only the hash would change,
 * and the room screen reads its room once, so a plain assign would leave it stale. */
function openTable(roomId: string) {
  const url = new URL(roomUrl(roomId), location.href);
  location.assign(url.href);
  if (url.pathname === location.pathname && url.search === location.search) location.reload();
}

/** Put the people already playing on the path a newcomer actually takes. */
export function ActiveTables({ family = false, onJoin }: {
  family?: boolean;
  onJoin?: (table: ListedTable) => void;
}) {
  const [tables, setTables] = useState<ListedTable[]>([]);
  useEffect(() => {
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const next = await liveTables(); if (live) setTables(activeTables(next)); }
      catch { /* A temporary failure leaves the last known table links usable. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, []);
  if (!tables.length) return null;
  return <section class="active-tables" aria-label="People playing now">
    <h2>At the table now</h2>
    <ul class="home-tables">
      {tables.map(table => {
        const here = table.seats.flatMap(seat => seat?.connected ? [seat.name] : []);
        const chairs = table.seats.filter(seat => !seat).length;
        const remembered = (() => { try { return savedSeat(table.roomId, localStorage) !== null; } catch { return false; } })();
        const action = table.rejoin || remembered ? 'Rejoin' : chairs === 0 ? 'View table' : table.open || (table.standing && family) ? 'Join' : 'Knock';
        return <li key={table.roomId}>
          <button type="button" class="home-table"
            onClick={() => onJoin ? onJoin(table) : openTable(table.roomId)}>
            <strong>{tableTitle(table)}</strong>
            <span>{here.join(', ')} here · {chairs === 0 ? 'All chairs reserved' : `${chairs} open ${chairs === 1 ? 'chair' : 'chairs'}`}</span>
            <em>{action}</em>
          </button>
        </li>;
      })}
    </ul>
    <p class="setting-hint">Join in the middle of a hand. No account needed.</p>
  </section>;
}
