import { birdwatchDemoApp } from './birdwatch-demo';

export const SHOWCASE_ID='f98536466db4422aa0af37418476d46a';
export const TOUR_STEPS=[
  {key:'blossoms',title:'A little blossom at the table',short:'Blossoms',text:'Cherry blossoms frame your partner’s hand. Switch them off and on to compare.'},
  {key:'shuffle',title:'A tandem ride around the shuffle',short:'Tandem shuffle',text:'The couple circles a pile of dominoes when a new hand begins. Replay it as often as you like.'},
  {key:'birdwatch',title:'A visitor during a pause',short:'Birdwatching',text:'We skipped the usual 20-second wait. Watch the owl land and the birdwatcher peek in. Play a highlighted domino to send them away.'},
  {key:'victory',title:'A celebration for the winners',short:'Congratulations',text:'Here’s the picture at the end of a game. Try it for either winning team—no need to finish a whole game first.'},
  {key:'bram',title:'Bram, a first sketch',short:'Bram concept',text:'Silver curls, round glasses, and a red outfit come from the style reference. Is this Bram’s look, or should the features be different? This is a concept to discuss.'},
] as const;
export function tourStep(search:string):number {
  const key=new URLSearchParams(search).get('step');
  return Math.max(0,TOUR_STEPS.findIndex(step=>step.key===key));
}
export function opensShowcase({search,hash}:Pick<Location,'search'|'hash'>):boolean {
  const query=new URLSearchParams(search);
  if(query.has('rooms') || hash)return false;
  return query.get('demo')==='scifigoofy' || query.get('idea')===SHOWCASE_ID;
}
/** Only the origin and the named step are shared, never incoming invite/account data. */
export function showcaseLink(origin:string,step?:number):string {
  const url=new URL('/?demo=scifigoofy',origin);
  if(step!==undefined && TOUR_STEPS[step])url.searchParams.set('step',TOUR_STEPS[step].key);
  return url.href;
}
export function showcaseGame() {
  const app=birdwatchDemoApp();
  return {...app,sessionId:'scifigoofy-sample',settings:{...app.settings,showHints:true}};
}
