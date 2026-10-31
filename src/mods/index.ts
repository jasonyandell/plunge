/** Every mod Plunge ships. Only src/kernel imports this list. */
import type { ModManifest } from '../kernel/mod-api';
import { dominoCounter } from './domino-counter';

export const MODS: readonly ModManifest[] = [dominoCounter];
