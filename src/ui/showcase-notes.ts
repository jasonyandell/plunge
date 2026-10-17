import { TOUR_STEPS } from './scifigoofy-tour';

export const NOTES_KEY='plunge:scifigoofy-feedback:v1';
export const NOTE_LIMIT=400;
export const NOTE_SECTIONS=[...TOUR_STEPS.map(step=>({key:step.key as string,title:step.short as string})),{key:'sample',title:'Sample game'}];
export type ShowcaseNotes=Record<string,string>;
export function parseNotes(raw:string|null):ShowcaseNotes {
  try {
    const value:unknown=JSON.parse(raw??'null');
    if(!value || typeof value!=='object' || Array.isArray(value))return {};
    return Object.fromEntries(NOTE_SECTIONS.flatMap(({key})=>{
      const text=(value as Record<string,unknown>)[key];return typeof text==='string'?[[key,text.slice(0,NOTE_LIMIT)]]:[];
    }));
  }catch{return {};}
}
export function feedbackText(notes:ShowcaseNotes,tourUrl:string):string {
  return ['Scifigoofy’s playground — feedback',tourUrl,...NOTE_SECTIONS.flatMap(({key,title})=>
    notes[key]?.trim()?[`${title}:\n${notes[key]!.trim().slice(0,NOTE_LIMIT)}`]:[])].join('\n\n');
}
