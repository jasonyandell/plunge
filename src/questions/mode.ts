/** Where saved questions go. PR previews have no question database. */
import type { LocalQuestion } from './model';

export const QUESTIONS_LOCAL_ONLY: boolean = __QUESTIONS_LOCAL_ONLY__;

export type Delivery = 'device-only' | 'waiting' | 'sent';
/** Never report an upload that did not happen, or cannot happen in this build. */
export function delivery(item: Pick<LocalQuestion, 'revision' | 'syncedRevision'>, localOnly = QUESTIONS_LOCAL_ONLY): Delivery {
  if (localOnly) return 'device-only';
  return item.revision > item.syncedRevision ? 'waiting' : 'sent';
}
