import {expect,it} from 'vitest';
import {hasIdeaDemo,matchesIdeaFilter,ideaTitle} from '../src/ideas/presentation';
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
it('shows the saved summary as written, never a keyword slug',()=>{
  expect(ideaTitle({...card,title:'See your own bid while bidding'})).toBe('See your own bid while bidding');
  expect(ideaTitle({...card,title:'When a player is the last possible bidder, no one has bid'})).toBe('When a player is the last possible bidder, no one has bid');
  expect(ideaTitle({...card,title:'  Two\n lines  '})).toBe('Two lines');
  expect(ideaTitle({...card,title:''})).toBe('Community idea 1');
});
