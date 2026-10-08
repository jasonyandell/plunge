import {expect,it} from 'vitest';
import {ACTIVITY_FRESH_MS,ideaActivity} from '../src/ideas/activity';
import type {IdeaCard} from '../src/ideas/model';
const card=(status:IdeaCard['status'],age=0)=>({status,activity:{lastSeenAt:1000000-age,observedAt:1000000}} as IdeaCard);
it('uses recent check-ins for active work and ages out without another response',()=>{
 expect(ideaActivity(card('building',5000))).toMatchObject({tone:'active',label:'Working now',lastSeen:'Checked in just now.'});
 expect(ideaActivity(card('building',30000),30000)).toMatchObject({tone:'active',lastSeen:'Checked in 1 minute ago.'});
 expect(ideaActivity(card('building'),ACTIVITY_FRESH_MS)).toMatchObject({tone:'quiet',label:'No recent update'});
 expect(ideaActivity(card('building',180000))).toMatchObject({tone:'quiet',lastSeen:'Checked in 3 minutes ago.'});
});
it('does not confuse a saved building status or a lost browser connection with live activity',()=>{
 expect(ideaActivity({status:'building'} as IdeaCard).tone).toBe('quiet');
 expect(ideaActivity(card('building'),0,false)).toMatchObject({tone:'quiet',label:'Updates unavailable'});
 expect(ideaActivity({...card('building'),activity:{lastSeenAt:NaN,observedAt:100}}).tone).toBe('quiet');
});
it('server-relative age is independent of the phone clock',()=>{
 const earlier=card('building',15000),later={...earlier,activity:{lastSeenAt:earlier.activity!.lastSeenAt!+1e12,observedAt:earlier.activity!.observedAt+1e12}};
 expect(ideaActivity(earlier,10000)).toEqual(ideaActivity(later,10000));
 expect(ideaActivity(earlier,-100)).toEqual(ideaActivity(earlier,0));
});
it('questions, queued work, preview checks and finished builds do not show an active agent',()=>{
 for(const status of ['queued','question','failed','checking','ready','shipped','closed'] as const)
   expect(ideaActivity(card(status)).tone).not.toBe('active');
 expect(ideaActivity(card('question')).label).toBe('Waiting for your reply');
 expect(ideaActivity(card('checking')).label).toBe('Waiting for preview');
 expect(ideaActivity(card('failed')).label).toBe('Needs attention');
});
