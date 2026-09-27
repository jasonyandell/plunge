/** Compact full or partial hand replay, validated through the rules engine. */
import {
  type Bid,
  type Declaration,
  type DominoId,
  type GameConfig,
  type GameState,
  type Pip,
  type Seat,
  TOURNAMENT_CONFIG,
  PLUNGE_CONFIG,
  LEGACY_PLUNGE_CONFIG,
  CASUAL_CONFIG,
  applyAction,
  newDealtGame,
} from './index';
type Preset = 'casual' | 'tournament' | 'plunge' | 'plunge-nello';
const configFor = (preset: Preset): GameConfig => preset === 'plunge-nello' ? PLUNGE_CONFIG : preset === 'plunge' ? LEGACY_PLUNGE_CONFIG
  : preset === 'tournament' ? TOURNAMENT_CONFIG : CASUAL_CONFIG;

/** Which preset produced this game's config (custom configs read as casual). */
export function presetOf(config: GameConfig): Preset {
  if (JSON.stringify(config) === JSON.stringify(PLUNGE_CONFIG)) return 'plunge-nello';
  if (JSON.stringify(config) === JSON.stringify(LEGACY_PLUNGE_CONFIG)) return 'plunge';
  return JSON.stringify(config) === JSON.stringify(TOURNAMENT_CONFIG) ? 'tournament' : 'casual';
}

function bidToken(b: Bid): string {
  if (b.kind === 'pass') return 'P';
  if (b.kind === 'points') return String(b.value); // always two digits, 30..41
  const v = String(b.value);
  if (b.special === 'plunge') return `G${v}`;
  if (b.special === 'splash') return `S${v}`;
  if (b.special === 'nello') return `N${v}`;
  return `M${v}`;
}

function declToken(d: Declaration): string {
  switch (d.type) {
    case 'pip':
      return String(d.pip);
    case 'doubles':
      return '7';
    case 'no-trump':
      return '9';
    case 'nello':
      return 'n';
    case 'sevens':
      return 's';
  }
}

/**
 * Encode a complete or partial hand, or null if replay disagrees with it.
 */
export function encodeReplay(g: GameState): string | null {
  try {
    const preset = presetOf(g.config);
    let sim = newDealtGame(configFor(preset), g.dealt, g.shaker);
    let tokens = '';
    for (const sb of g.bids) {
      if (sim.phase !== 'bidding') return null;
      tokens += bidToken(sb.bid);
      sim = applyAction(sim, { type: 'bid', bid: sb.bid });
    }
    if (sim.phase === 'declaring' && g.declaration) {
      tokens += `D${declToken(g.declaration)}`;
      sim = applyAction(sim, { type: 'declare', decl: g.declaration });
    }
    if (sim.phase === 'declaring' && g.phase !== 'declaring') return null;
    for (const t of g.tricks) {
      for (const p of t.plays) {
        if (sim.phase !== 'playing') return null;
        tokens += p.domino;
        sim = applyAction(sim, { type: 'play', domino: p.domino });
      }
    }
    for (const p of g.currentTrick) {
      tokens += p.domino;
      sim = applyAction(sim, { type: 'play', domino: p.domino });
    }
    if (JSON.stringify(sim.tricks) !== JSON.stringify(g.tricks) || JSON.stringify(sim.currentTrick) !== JSON.stringify(g.currentTrick)) return null;
    if (sim.points[0] !== g.points[0] || sim.points[1] !== g.points[1]) return null;
    const head =
      'v1' +
      (preset === 'plunge-nello' ? 'l' : preset === 'plunge' ? 'f' : preset === 'tournament' ? 't' : 'c') +
      String(g.shaker) +
      g.dealt.map((h) => h.join('')).join('');
    return `${head}.${tokens}`;
  } catch {
    return null;
  }
}

/** Decode a share code by replaying it; null on any inconsistency. */
export function decodeReplay(code: string): GameState | null {
  try {
    if (!code.startsWith('v1') || code.length < 61) return null;
    const pc = code[2];
    if (pc !== 'c' && pc !== 't' && pc !== 'f' && pc !== 'l') return null;
    const preset: Preset = pc === 'l' ? 'plunge-nello' : pc === 'f' ? 'plunge' : pc === 't' ? 'tournament' : 'casual';
    const shaker = Number(code[3]);
    if (!(shaker >= 0 && shaker <= 3)) return null;
    const dealt: DominoId[][] = [0, 1, 2, 3].map((s) => {
      const h: DominoId[] = [];
      for (let j = 0; j < 7; j++) h.push(code.slice(4 + s * 14 + j * 2, 4 + s * 14 + j * 2 + 2));
      return h;
    });
    let g = newDealtGame(configFor(preset), dealt, shaker as Seat);
    let i = 60;
    if (code[i] !== '.') return null;
    i++;
    while (i < code.length) {
      if (g.phase === 'bidding') {
        const c = code[i]!;
        let bid: Bid;
        if (c === 'P') {
          bid = { kind: 'pass' };
          i += 1;
        } else if (c === 'M' || c === 'G' || c === 'S' || c === 'N') {
          const value = Number(code[i + 1]);
          bid =
            c === 'M'
              ? { kind: 'marks', value }
              : {
                  kind: 'marks',
                  value,
                  special: c === 'G' ? 'plunge' : c === 'S' ? 'splash' : 'nello',
                };
          i += 2;
        } else {
          bid = { kind: 'points', value: Number(code.slice(i, i + 2)) };
          i += 2;
        }
        g = applyAction(g, { type: 'bid', bid });
      } else if (g.phase === 'declaring') {
        if (code[i] !== 'D') return null;
        const c = code[i + 1]!;
        const decl: Declaration =
          c === '7'
            ? { type: 'doubles' }
            : c === '9'
              ? { type: 'no-trump' }
              : c === 'n'
                ? { type: 'nello' }
                : c === 's'
                  ? { type: 'sevens' }
                  : { type: 'pip', pip: Number(c) as Pip };
        g = applyAction(g, { type: 'declare', decl });
        i += 2;
      } else if (g.phase === 'playing') {
        g = applyAction(g, { type: 'play', domino: code.slice(i, i + 2) });
        i += 2;
      } else {
        return null; // trailing tokens after the hand ended
      }
    }
    return g;
  } catch {
    return null;
  }
}

