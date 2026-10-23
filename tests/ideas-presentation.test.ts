import {expect,it} from 'vitest';
import {hasIdeaDemo,matchesIdeaFilter,ideaPresentation} from '../src/ideas/presentation';
import {previewFor,type IdeaCard} from '../src/ideas/model';
const card:IdeaCard={id:'a'.repeat(32),number:1,name:'Family',title:'I want to see my bid during bidding',context:'',created:'',updated:'',revision:1,status:'ready',pr:58,sha:'b'.repeat(40),preview:previewFor(58)};
it('offers only checked previews with the matching preview address',()=>{
  expect(hasIdeaDemo(card)).toBe(true);
  for(const change of [{status:'checking' as const},{sha:null},{preview:previewFor(59)},{preview:'https://example.com'}, {pr:null}])expect(hasIdeaDemo({...card,...change})).toBe(false);
});
it('keeps closed duplicates out of the current board without hiding their history',()=>{
  const closed={...card,status:'closed' as const};
  expect(matchesIdeaFilter(closed,'current')).toBe(false);
  expect(matchesIdeaFilter(closed,'closed')).toBe(true);
  expect(matchesIdeaFilter({...card,status:'failed'},'attention')).toBe(true);
  expect(matchesIdeaFilter({...card,status:'building'},'attention')).toBe(false);
});
it('presents a concise title and topics while preserving the request',()=>{
  expect(ideaPresentation(card)).toEqual({title:'Show my bid during bidding',tags:['Bidding','Accessibility']});
  expect(card.title).toBe('I want to see my bid during bidding');
});
it.each([
  ['the slugs should be headline summaries for titles', 'Slugs: headline summaries for titles'],
  ['Could we please add a button to review past hands?', 'Add a button to review past hands'],
  ['I’d like to make the score easier to read.', 'Make the score easier to read'],
  ['Please don’t show my bid after bidding.', 'Don’t show my bid after bidding'],
  ['I can’t see what I bid.', 'I can’t see what I bid'],
  ['Fix Zeb freezing after a trick', 'Fix Zeb freezing after a trick'],
  ['Remove broken links from ideas', 'Remove broken links from ideas'],
  ['Keep the dashboard from losing my search', 'Keep the dashboard from losing my search'],
  ['Don’t show prior hands until the game ends', 'Don’t show prior hands until the game ends'],
])('summarizes "%s" without losing its meaning', (request, headline)=>{
  expect(ideaPresentation({...card,title:request}).title).toBe(headline);
});
