import type { Seat } from '../engine';
import type { StatsHand } from './model';
import { practiceSave, restorePractice, type PracticeRun, type PracticeSave } from './practice';

/** Separate practice records: never write the solo save, source hand, or counted account stats. */
export function practiceStore(hand: StatsHand, seat: Seat, demo: boolean, storage: Storage) {
  const prefix = `plunge:play-again:v1:${JSON.stringify([demo, hand.id, seat])}:`;
  return {
    list(): PracticeRun[] {
      const runs: PracticeRun[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const save = JSON.parse(storage.getItem(key)!) as PracticeSave;
        if (save.seat !== seat) throw new Error('Practice belongs to a different seat.');
        runs.push(restorePractice(hand.game, hand.record.code, save));
      }
      return runs.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    },
    save(run: PracticeRun): void {
      const key = prefix + run.id, previous = storage.getItem(key);
      if (previous) {
        const old = JSON.parse(previous) as PracticeSave;
        if (old.actions.length > run.actions.length || old.actions.some((a, i) => JSON.stringify(a) !== JSON.stringify(run.actions[i]))) {
          throw new Error('This practice was changed in another tab. Reopen the hand to resume it.');
        }
      }
      storage.setItem(key, JSON.stringify(practiceSave(run)));
    },
  };
}
