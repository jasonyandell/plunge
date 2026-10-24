import { previewFor } from './model';

// Adapted requests, not quotations from family conversations. The source story
// titles are from commits 6659b21 (#75), 67aaae7 (#37), and 661d920 (#73).
export const headlineExamples = [
  {label:'This idea', request:'the slugs should be headline summaries for titles'},
  {label:'Name the high bidder', request:'Could we please name the high bidder in the bidding prompt?'},
  {label:'Review completed hands', request:'I would like to review completed hands from the current solo or family game.'},
  {label:'Wait for everyone', request:'Please pause between hands until everyone is ready.'},
];

export function isHeadlineDemo(location: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>, localOnly: boolean): boolean {
  const params = new URLSearchParams(location.search);
  if (params.has('stats') || params.has('account')) return false;
  if (params.has('ideas') && params.get('demo') === 'headlines') return true;
  // Only this story's preview opens straight into its demo. Other previews,
  // production, explicit game links, and shared-hand/room hashes keep routing.
  return localOnly && location.hostname === new URL(previewFor(86)).hostname
    && location.pathname === '/' && !location.search && !location.hash;
}
