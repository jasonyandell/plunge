/** Plain words for bids, contracts and suits. Depends on the engine only, so mods can share it. */
import { CALLED_SUIT, fromId, ledSuitOf, type Bid, type Contract, type Declaration, type GameState, type PlayRecord } from '../engine';

export const PIP_SUIT_NAMES: readonly string[] = [
  'blanks', 'aces', 'deuces', 'treys', 'fours', 'fives', 'sixes',
];

export function bidLabel(bid: Bid): string {
  switch (bid.kind) {
    case 'pass':
      return 'Pass';
    case 'points':
      return String(bid.value);
    case 'marks': {
      const base = bid.value === 1 ? '1 mark' : `${bid.value} marks`;
      if (bid.special === 'plunge') return `Plunge! (${base})`;
      if (bid.special === 'splash') return `Splash! (${base})`;
      if (bid.special === 'nello') return `Nel-O (${base})`;
      return base;
    }
  }
}

export function contractLabel(c: Contract): string {
  const marks = c.kind === 'points' ? 1 : c.value;
  const m = marks === 1 ? '1 mark' : `${marks} marks`;
  switch (c.kind) {
    case 'points': return `${c.value}`;
    case 'marks': return m;
    case 'nello': return `Nel-O, ${m}`;
    case 'plunge': return `Plunge, ${m}`;
    case 'splash': return `Splash, ${m}`;
    case 'sevens': return `Sevens, ${m}`;
  }
}

export function declLabel(d: Declaration): string {
  switch (d.type) {
    case 'pip': return PIP_SUIT_NAMES[d.pip] ?? String(d.pip);
    case 'doubles': return 'doubles';
    case 'no-trump': return 'follow me';
    case 'nello': return 'Nel-O';
    case 'sevens': return 'sevens';
  }
}

/**
 * Trump chip for the in-play info bar — what was called, kept short.
 * Spells out the doubles treatment for no-trump and Nel-O, where it matters.
 */
export function trumpChip(g: GameState): string | null {
  const d = g.declaration;
  if (!d) return null;
  switch (d.type) {
    case 'pip':
      return `trump: ${PIP_SUIT_NAMES[d.pip]}`;
    case 'doubles':
      return 'trump: doubles';
    case 'no-trump':
      switch (g.config.noTrumpDoubles) {
        case 'high': return 'no trump — doubles high';
        case 'low': return 'no trump — doubles low';
        case 'own-suit': return 'no trump — doubles own suit';
      }
      break;
    case 'nello':
      switch (g.config.nelloDoubles) {
        case 'own-suit': return 'Nel-O — doubles own suit';
        case 'high': return 'Nel-O — doubles high';
        case 'low': return 'Nel-O — doubles low';
        case 'own-suit-inverted': return 'Nel-O — doubles own suit, 0-0 high';
      }
      break;
    case 'sevens':
      return 'Sevens — closest to 7 wins';
  }
}

/**
 * The suit the displayed trick's lead calls for ("sixes", "trumps",
 * "doubles"), or null when nothing is on the table.
 */
export function ledChip(g: GameState, plays: readonly PlayRecord[]): string | null {
  const lead = plays[0];
  if (!lead || !g.rules) return null;
  const led = ledSuitOf(fromId(lead.domino), g.rules);
  if (led === CALLED_SUIT) {
    return g.rules.called.kind === 'doubles' ? 'doubles' : 'trumps';
  }
  return PIP_SUIT_NAMES[led] ?? null;
}
