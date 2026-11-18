import { describe, expect, it, vi } from 'vitest';
import { applyAction, newDealtGame, newGame, PLUNGE_CONFIG, type GameState, type Seat } from '../src/engine';
import { zebAuctionMove, type ZebSurvey } from '../src/ai/zeb';
import { forecastAdvice, forecastRows } from '../src/ai/zeb/auction-advice';
import { forecastCopy } from '../src/ui/ForecastDetails';
import { playerIdentity } from '../src/ai/players';
import { auctionRequest } from '../src/ai/auction';
import { validHint, type ForecastHintEvidence } from '../src/questions/hint-evidence';
import type { Forecast } from '@jasonyandell/zeb';

const pass = { type: 'bid', bid: { kind: 'pass' } } as const;
const game = (shaker: Seat = 3) => newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, 'zeb-hints').dealt, shaker);
const forecasts = (): Forecast[] => [0,1,2,3,4,5,6,7,9].map(decl => ({ decl, mean: 30,
  pmake: decl === 6 ? [.99,.98,.96,.94,.90,.87,.83,.75,.65,.55,.45,.35,.25]
    : decl === 5 ? [.98,.97,.95,.93,.89,.87,.80,.70,.60,.50,.40,.30,.20] : Array(13).fill(.2) }));
const evaluate = (forecast = forecasts()) => vi.fn(async () => ({ value: forecast, version: playerIdentity('zeb').version, net: 'a'.repeat(64), elapsed_us: 10 }));
async function advice(g: GameState, comparePartnerPass = true, forecast = forecasts()) {
  const decision = await zebAuctionMove(g, 0, 'hint', undefined, undefined, evaluate(forecast), { comparePartnerPass });
  const survey = decision.survey as ZebSurvey | null;
  return { decision, survey, summary: forecastAdvice(g, decision.action, survey), copy: forecastCopy(g, { action: decision.action, survey }) };
}

describe('Zeb auction explanations and exploration', () => {
  it('explains the actual bid and keeps its evidence fixed while ranking other targets and ties', async () => {
    const g = game(), before = structuredClone(g), { decision, survey, summary, copy } = await advice(g);
    expect(decision.action).toEqual({ type: 'bid', bid: { kind: 'points', value: 35 } });
    expect(summary).toMatchObject({ reason: 'bid', target: 35, tied: true });
    expect(copy.explanation).toContain('87.0%');
    const original = structuredClone(survey);
    expect(forecastRows(survey!.forecast, 35).slice(0,2).map(f => f.decl)).toEqual([5,6]);
    expect(forecastRows(survey!.forecast, 36)[0]!.decl).toBe(6);
    expect(survey).toEqual(original); expect(g).toEqual(before);
    expect(forecastCopy(g, { action: decision.action, survey })).toEqual(copy);
  });

  it('explains a weak pass against the actual minimum legal raise', async () => {
    const g = applyAction(game(2), { type: 'bid', bid: { kind: 'points', value: 35 } });
    const { summary, copy } = await advice(g);
    expect(summary).toMatchObject({ reason: 'pass', target: 36, minimumTarget: 36 });
    expect(copy.explanation).toContain('minimum bid of 36'); expect(copy.explanation).toContain('83.0%');
  });

  it('offers forecasts behind a partner bid without changing live bidding or its pass', async () => {
    const g = applyAction(applyAction(game(1), { type: 'bid', bid: { kind: 'points', value: 34 } }), pass);
    const unused = evaluate();
    const live = await zebAuctionMove(g, 0, 'hint', undefined, undefined, unused);
    expect(unused).not.toHaveBeenCalled(); expect(live.survey).toBeNull();
    const { decision, survey, summary, copy } = await advice(g);
    expect(decision.action).toEqual(live.action); expect(survey?.forecast).toHaveLength(9);
    expect(summary).toMatchObject({ reason: 'partner', target: 34 });
    expect(copy.explanation).toContain('leave the bid with your partner');
  });

  it('separates forced bids and a one-mark policy limit from a weak-hand verdict', async () => {
    const forced = [1,2,3].reduce(g => applyAction(g, pass), game(0));
    const weak = forecasts().map(f => ({ ...f, pmake: Array(13).fill(.2) }));
    const minimum = await advice(forced, true, weak);
    expect(minimum.summary).toMatchObject({ reason: 'forced', target: 30 });
    expect(minimum.copy.explanation).toContain('must bid at least 30');
    expect(minimum.copy.explanation).toContain('below Zeb’s usual 85% cutoff');
    const marks = applyAction(game(2), { type: 'bid', bid: { kind: 'marks', value: 1 } });
    const strong = forecasts().map(f => ({ ...f, pmake: Array(13).fill(.99) }));
    const capped = await advice(marks, true, strong);
    expect(capped.summary.reason).toBe('marks'); expect(capped.decision.action).toEqual(pass);
    expect(capped.copy.explanation).toContain('more than one mark'); expect(capped.copy.explanation).not.toContain('below');
  });

  it('explains trump at the contract target, including tied forecasts', async () => {
    const g = [1,2,3].reduce(at => applyAction(at, pass), applyAction(game(), { type: 'bid', bid: { kind: 'points', value: 35 } }));
    const { decision, summary, copy } = await advice(g);
    expect(decision.action.type).toBe('declare');
    expect(summary).toMatchObject({ reason: 'declare', target: 35, tied: true });
    expect(copy.explanation).toContain('35-point target'); expect(copy.explanation).toContain('shares the highest forecast');
  });

  it('preserves the explored target in saved evidence, reads older hints, and rejects invalid comparison state', async () => {
    const g = game(), { decision, survey, copy } = await advice(g);
    const original: ForecastHintEvidence = { kind: 'bid', source: 'zeb', model: playerIdentity('zeb'), action: decision.action, survey, ...copy };
    const seed = auctionRequest(g, 'hint').seed;
    expect(validHint(original, g, seed)).toEqual(original);
    const saved = { ...original, explored_target: 37, comparison_open: true };
    expect(validHint(saved, g, seed)).toEqual(saved);
    expect(() => validHint({ ...saved, explored_target: 43 }, g, seed)).toThrow(/comparison/);
    expect(() => validHint({ ...original, comparison_open: true }, g, seed)).toThrow(/comparison/);
  });
});
