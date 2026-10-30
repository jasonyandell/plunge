import { describe, expect, it } from 'vitest';
import type { PlayerEvent, PlayerIdentity } from '../src/ai/players';
import { handModelLabel, replaySeatLabel, type SavedHand } from '../src/stats/model';
import { finishedRecord } from './hand-fixtures';

const zeb: PlayerIdentity = { id:'zeb', character:'zeb', name:'Zeb', version:'0.3.0', implementation:'archived-zeb', package:'@jasonyandell/zeb' };
const walt: PlayerIdentity = { id:'native-partner', character:'walt', name:'Walt', version:'archived-walt-v1', implementation:'archived-walt', package:'bundled:walt' };
const event = (model: PlayerIdentity, seat: 0|1|2|3, phase = 'playing'): PlayerEvent => ({model,seat,handNumber:1,step:4,phase});
const base = (): SavedHand => ({id:'archived',record:finishedRecord('archived'),players:[{seat:0,name:'Ruby'}]});

describe('recorded models in stats replay', () => {
  it('shows archived versions and deduplicates repeated decisions', () => {
    const hand=base(),record={...hand.record,models:[zeb],playerEvents:[event(zeb,1),event(zeb,1)]};
    expect(handModelLabel(record)).toBe('Zeb · 0.3.0');
    expect(replaySeatLabel({...hand,record},1)).toBe('Zeb · 0.3.0');
  });
  it('keeps mixed and Nel-O coverage on the recorded seat', () => {
    const hand=base(),record={...hand.record,models:[zeb,walt],playerEvents:[event(zeb,1,'bidding'),event(walt,1),event(zeb,3)]};
    expect(handModelLabel(record)).toBe('Zeb · 0.3.0 + Walt · archived-walt-v1');
    expect(replaySeatLabel({...hand,record},1)).toBe('Zeb · 0.3.0 / Walt · archived-walt-v1');
    expect(replaySeatLabel({...hand,record},3)).toBe('Zeb · 0.3.0');
  });
  it('preserves human names when a computer covered the same seat', () => {
    const hand=base(),record={...hand.record,playerEvents:[event(walt,0)]};
    expect(replaySeatLabel({...hand,record},0)).toBe('Ruby / Walt · archived-walt-v1');
  });
  it('does not infer a seat model from a hand-wide summary or invent legacy versions', () => {
    const hand=base();
    const {models:_models,playerEvents:_events,...legacy}=hand.record;
    const record={...legacy,player:'zeb'};
    expect(handModelLabel(record)).toBe('Zeb · version not recorded');
    expect(replaySeatLabel({...hand,record:{...record,models:[zeb]}},2)).toBe('Recorded player · model not recorded');
    expect(replaySeatLabel({...hand,record},0)).toBe('Ruby');
  });
  it('ignores other hands and labels synthetic choices without claiming an AI played them', () => {
    const hand=base(),record={...hand.record,player:'demo',playerEvents:[{...event(zeb,1),handNumber:2}]};
    expect(handModelLabel(record)).toBe('Sample choices · no computer model');
    expect(replaySeatLabel({...hand,record},1)).toBe('Sample player');
  });
});
