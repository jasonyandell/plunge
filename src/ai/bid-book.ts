/** Empirical scores from complete bid-30 games. No solver prices in this book. */
import data from './book/played.json';
import type { AuctionRequest } from './auction';

export interface PlayedPanel {
  decl: number; games: number; tails: number[]; allocation: string; uncertain: number[]; audit: boolean;
}
export interface PlayedHand { seed: number; seat: number; hand: number[]; panels: PlayedPanel[] }
export interface PlayedBook {
  schema: 'plunge-played-bids-v1'; source_book: string; profile: string; policy_bid: 30;
  threshold: [number, number]; games: number; seeds: number[]; hands: PlayedHand[];
}
export interface BookAuctionSurvey extends AuctionRequest {
  schema: 'plunge-played-auction-v1'; book_id: string; profile: string; policy_bid: 30;
  threshold: readonly [number, number]; decl: number; eligible: boolean; forced: boolean;
  source_deal_seed: number; panels: readonly PlayedPanel[];
}
const key = (hand: readonly number[], seat: number) => `${seat}:${[...hand].sort((a,b)=>a-b).join(',')}`;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
export function validateBook(input: unknown): PlayedBook {
  const b = input as PlayedBook;
  if (b?.schema !== 'plunge-played-bids-v1' || !/^[a-f0-9]{64}$/.test(b.source_book)
    || b.policy_bid !== 30 || b.profile !== 'walt-table-v2-opening160-ordinary40-partner-bid30-v1'
    || JSON.stringify(b.threshold) !== '[4,5]' || !Array.isArray(b.hands) || !b.hands.length
    || !Array.isArray(b.seeds) || !b.seeds.length || !count(b.games)) throw new Error('Invalid played bid book.');
  const seen = new Set<string>(); let games = 0;
  for (const h of b.hands) {
    if (!count(h.seed) || h.seed > 0xffffffff || !count(h.seat) || h.seat > 3
      || !Array.isArray(h.hand) || h.hand.length !== 7 || new Set(h.hand).size !== 7
      || h.hand.some(t=>!count(t)||t>27) || !b.seeds.includes(h.seed)
      || !Array.isArray(h.panels) || JSON.stringify(h.panels.map(p=>p.decl)) !== '[0,1,2,3,4,5,6,7,9]') throw new Error('Invalid bid hand.');
    if (seen.has(key(h.hand,h.seat))) throw new Error('Duplicate bid hand.'); seen.add(key(h.hand,h.seat));
    for (const p of h.panels) {
      if (!count(p.games) || p.games < 8 || !Array.isArray(p.tails) || p.tails.length !== 13
        || p.tails.some((n,i)=>!count(n)||n>p.games||(i>0&&n>p.tails[i-1]!))
        || !['screened','resolved','capped-unsettled','audit-complete'].includes(p.allocation)
        || typeof p.audit !== 'boolean' || !Array.isArray(p.uncertain)
        || p.uncertain.some(n=>!count(n)||n<30||n>42)) throw new Error('Invalid played scores.');
      games += p.games;
    }
  }
  if (games !== b.games || new Set(b.seeds).size !== b.seeds.length
    || b.seeds.some(s=>JSON.stringify(b.hands.filter(h=>h.seed===s).map(h=>h.seat).sort())!=='[0,1,2,3]')) throw new Error('Incomplete bid catalogue.');
  return b;
}
export const BID_BOOK = validateBook(data);
const byHand = new Map(BID_BOOK.hands.map(h=>[key(h.hand,h.seat),h]));
/** The lookup boundary deliberately has no access to other hands or actual deal seed. */
export function playedHand(hand: readonly number[], seat: number): PlayedHand | undefined {
  return byHand.get(key(hand,seat));
}
export function bestPanel(panels: readonly PlayedPanel[], bid: number): PlayedPanel {
  if (!Number.isInteger(bid) || bid < 30 || bid > 42 || !panels.length) throw new Error('Unsupported bid target.');
  return panels.reduce((a,b)=>b.tails[bid-30]!*a.games>a.tails[bid-30]!*b.games?b:a);
}
export function qualifies(panel: PlayedPanel, bid: number): boolean {
  return panel.tails[bid-30]!*BID_BOOK.threshold[1] >= panel.games*BID_BOOK.threshold[0];
}
