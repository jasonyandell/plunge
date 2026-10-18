import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { applyAction, legalActions, newGame, LEGACY_PLUNGE_CONFIG, type Phase } from '../src/engine';
import { planPlayerChange } from '../src/ai/player-change';
import { player, usesPreparedDeals, usesForecastBidding } from '../src/ai/players';
import { catalogueDeal } from '../src/ai/catalogue';
import { initialApp, loadApp, pendingAiSeat, reducer, toSaved } from '../src/ui/store';
import { auctionKey } from '../src/ai/auction';
import { historyDb, listHistory, recordHistory, retryHistory } from '../src/history/recorder';
import { listHands } from '../src/history/legacy';

const started = () => reducer(initialApp(), { type: 'new-game', seed: 'switch-model', sessionId: 'switch-game' });

describe('model changes are game boundaries', () => {
  it('derives confirmation from the model and game lifecycle without changing either', () => {
    expect(planPlayerChange('native-partner', 'native-partner', { phase: 'playing' })).toEqual({ kind: 'unchanged' });
    for (const phase of ['bidding', 'declaring', 'playing', 'hand-over'] as Phase[]) {
      expect(planPlayerChange('native-partner', 'zeb', { phase })).toMatchObject({ kind: 'switch', endsGame: true });
    }
    expect(planPlayerChange('zeb', 'native-partner', { phase: 'game-over' })).toMatchObject({ endsGame: false });
    expect(planPlayerChange('zeb', 'native-partner', null)).toMatchObject({ endsGame: false });
  });

  it('does nothing on a same-model request, missing consent, or consent from another game', () => {
    const app = started(), before = structuredClone(app);
    expect(reducer(app, { type: 'set-difficulty', difficulty: 'native-partner', confirmed: true, sessionId: app.sessionId })).toBe(app);
    expect(reducer(app, { type: 'set-difficulty', difficulty: 'zeb' })).toBe(app);
    expect(reducer(app, { type: 'set-difficulty', difficulty: 'zeb', confirmed: true, sessionId: 'older-game' })).toBe(app);
    expect(app).toEqual(before);
  });

  it('ends the old game, clears transient state, rejects late decisions, and survives reload', () => {
    const app = { ...started(), showTrick: true, nativeReceipts: { '1:0': 'old' }, practiceHands: [1], aiMoves: 4 };
    const next = reducer(app, { type: 'set-difficulty', difficulty: 'zeb', confirmed: true, sessionId: app.sessionId });
    expect(next).toMatchObject({ screen: 'home', game: null, showTrick: false, aiMoves: 0,
      nativeReceipts: {}, auctionSurveys: {}, playerEvents: [], practiceHands: [], retry: null, scenarioGame: null, scenarioFlag: null });
    expect(next.epoch).toBe(app.epoch + 1); expect(next.settings.difficulty).toBe('zeb');
    expect(pendingAiSeat(next)).toBeNull();
    expect(reducer(next, { type: 'auction-ai', epoch: app.epoch,
      decision: { key: auctionKey(app.game!, app.sessionId), action: legalActions(app.game!)[0]!, survey: null } })).toBe(next);
    expect(reducer(next, { type: 'resume' })).toBe(next);
    const loaded = initialApp(loadApp({ getItem: () => JSON.stringify(toSaved(next)) } as never));
    expect(loaded.game).toBeNull(); expect(loaded.settings.difficulty).toBe('zeb');
  });

  it('uses capabilities for the fresh deal in both directions, with no old marks or evidence', () => {
    expect(player('native-partner').capabilities.bidding).toBe('recorded-hands');
    expect(usesPreparedDeals('native-l1')).toBe(true); expect(usesForecastBidding('zeb')).toBe(true);
    const first = started();
    const zeb = reducer(first, { type: 'set-difficulty', difficulty: 'zeb', confirmed: true, sessionId: first.sessionId });
    const fresh = reducer(zeb, { type: 'new-game', seed: 'new-zeb', sessionId: 'zeb-game' });
    expect(fresh.game).toEqual(newGame(LEGACY_PLUNGE_CONFIG, 'new-zeb'));
    const walt = reducer(fresh, { type: 'set-difficulty', difficulty: 'native-partner', confirmed: true, sessionId: fresh.sessionId });
    const prepared = reducer(walt, { type: 'new-game', seed: 'new-walt', sessionId: 'walt-game' });
    expect(prepared.game).toEqual(catalogueDeal(newGame(LEGACY_PLUNGE_CONFIG, 'new-walt'), 'new-walt'));
    expect(prepared.game?.marks).toEqual([0,0]); expect(prepared.playerEvents).toEqual([]);
  });

  it('retains an ended game under the old model even when saving has to retry', async () => {
    const app = started();
    const old = { ...app, game: applyAction(app.game!, legalActions(app.game!)[0]!) };
    const db = await historyDb();
    const failure = vi.spyOn(db, 'transaction').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(recordHistory(old, true)).rejects.toThrow('Full'); failure.mockRestore();
    const next = reducer(old, { type: 'set-difficulty', difficulty: 'zeb', confirmed: true, sessionId: old.sessionId });
    await recordHistory(next); await retryHistory();
    expect((await listHistory()).some(e => (e as { gameId: string }).gameId === old.sessionId)).toBe(true);
    expect((await listHands()).find(h => h.gameId === old.sessionId)?.player).toBe('native-partner');
  });
});
