/** Every mod Plunge ships. Only src/kernel imports this list. Order is precedence:
 * for a slot only one mod may fill (REPLACING_SLOTS), the first enabled one here wins. */
import type { ModManifest } from '../kernel/mod-api';
import { biddingHint } from './bidding-hint';
import { dominoCounter } from './domino-counter';
import { nelloSitoutView } from './nello-sitout-view';

export const MODS: readonly ModManifest[] = [biddingHint, dominoCounter, nelloSitoutView];
