import { expect,it } from 'vitest';
import { NOTE_LIMIT,NOTE_SECTIONS,feedbackText,parseNotes } from '../src/ui/showcase-notes';
it('recovers only known text notes and tolerates unavailable or corrupt storage',()=>{
  for(const raw of [null,'{broken','42','null','[]'])expect(parseNotes(raw)).toEqual({});
  expect(parseNotes(JSON.stringify({blossoms:'Softer pink',bram:3,token:'secret',sample:'x'.repeat(900)}))).toEqual({blossoms:'Softer pink',sample:'x'.repeat(NOTE_LIMIT)});
});
it('copies every feature together and fits one idea-board reply',()=>{
  const notes=Object.fromEntries(NOTE_SECTIONS.map(({key})=>[key,'a'.repeat(NOTE_LIMIT)]));
  const text=feedbackText(notes,'https://plunge-pr-62.texas42.workers.dev/?demo=scifigoofy');
  expect(text.length).toBeLessThanOrEqual(3000);
  for(const {title} of NOTE_SECTIONS)expect(text).toContain(title+':');
  expect(feedbackText({bram:'  Different glasses  ',blossoms:' '},'https://example.test')).toContain('Bram concept:\nDifferent glasses');
  expect(feedbackText({blossoms:' '},'https://example.test')).not.toContain('Blossoms:');
});
