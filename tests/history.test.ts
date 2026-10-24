import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { initialApp, pendingAiSeat, reducer, type AppState } from '../src/ui/store';
import { legalActions } from '../src/engine';

/** Cheap computer seats until it is your turn (the table only accepts your own decisions). */
function toYourTurn(app: AppState): AppState {
  while (pendingAiSeat(app) !== null) app = reducer(app, { type: 'ai', choose: (g) => legalActions(g)[0]! });
  return app;
}
import { appendSnapshot, snapshotOf, listHistory, exportHistory, recordHistory, historyDb, retryHistory } from '../src/history/recorder';
import { decodeReplay } from '../src/engine/replay-code';
import { putEstimate, listEstimates } from '../src/ai/phone/records';

describe('local history', () => {
  it('retains interrupted hands and deduplicates concurrent writes across connections', async () => {
    const app = toYourTurn(reducer(initialApp(), { type: 'new-game', seed: 'history', sessionId: 'history-test' }));
    const snapshot = snapshotOf(app)!;
    await Promise.all([appendSnapshot(snapshot), appendSnapshot(snapshot)]);
    expect((await listHistory()).length).toBe(1);
    expect(decodeReplay(snapshot.code!)).not.toBeNull();
    const next = reducer(app, { type: 'human', action: { type: 'bid', bid: { kind: 'points', value: 30 } } });
    await recordHistory(next);
    expect((await listHistory()).length).toBe(2);
    await recordHistory(app);
    expect((await listHistory()).length).toBe(2);
  });
  it('keeps different games on the same seed and excludes shared review game', async () => {
    const app = reducer(initialApp(), { type: 'new-game', seed: 'history', sessionId: 'history-second' });
    const review = reducer(app, { type: 'view-scenario', game: app.game! });
    await recordHistory(review);
    expect(snapshotOf(review)?.gameId).toBe('history-second');
    const data = JSON.parse(await exportHistory());
    expect(data.events.length).toBe(3);
    expect(data.schema).toBe('plunge-history-export-v1');
    expect(data.events.every((e: { schema: string }) => e.schema === 'plunge-history-v1')).toBe(true);
  });
});

it('retries failed transactions without evicting earlier records and exports pending evidence', async () => {
  const app = reducer(initialApp(), { type: 'new-game', seed: 'quota', sessionId: 'quota-test' });
  const db = await historyDb();
  const broken = vi.spyOn(db, 'transaction').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  await expect(recordHistory(app)).rejects.toThrow('Full');
  broken.mockRestore();
  await retryHistory();
  expect((await listHistory()).length).toBe(4);
});
it('preserves actual deeper Walt result and exports it with provenance', async () => {
  const value = { schema: 'plunge-estimate-v1' as const, id: 'estimate-test', created: '2026-10-03',
    identity: { request: { decl: 0, bid: 30, bidder: 0, seat: 0, hand: [0], plays: [], seed: 1 }, player: { n: 160 }, implementation: { app: 'test' } },
    response: { choice: 0, legal: [0], route: 'test', leader: 0, points: [0,0], elapsed_us: 100 } };
  expect(await putEstimate(value)).toBe(true);
  expect(await listEstimates()).toContainEqual(value);
  expect(JSON.parse(await exportHistory()).estimates).toContainEqual(value);
});
