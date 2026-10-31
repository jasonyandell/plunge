/** Every mod Plunge ships. Only src/kernel imports this list. Order is precedence:
 * for a slot only one mod may fill (REPLACING_SLOTS), the first enabled one here wins. */
import type { ModManifest } from '../kernel/mod-api';
import { biddingHint } from './bidding-hint';
import { dominoCounter } from './domino-counter';
import { partnerBadge } from './partner-badge';
import { flashLetIn } from './flash-let-in';
import { voteNotice } from './vote-notice';
import { redBackground } from './red-background';
import { dragArrange } from './drag-arrange';
import { nelloSitoutView } from './nello-sitout-view';

export const MODS: readonly ModManifest[] = [biddingHint, dominoCounter, partnerBadge, flashLetIn, voteNotice, redBackground, nelloSitoutView, dragArrange];
