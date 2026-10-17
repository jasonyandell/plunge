import { IDEA_STATUS, type IdeaCard } from './model';
// Check-ins arrive every 30 seconds. Allow two missed intervals plus polling time.
export const ACTIVITY_FRESH_MS=75000;
export function ideaActivity(card:IdeaCard,elapsedMs=0,connected=true) {
  const activity=card.activity;
  const age=activity && activity.lastSeenAt!==null && Number.isFinite(activity.lastSeenAt) && Number.isFinite(activity.observedAt)
    ? Math.max(0,activity.observedAt-activity.lastSeenAt)+Math.max(0,elapsedMs):null;
  const lastSeen=age===null?'':age<10000?'Checked in just now.':age<60000?`Checked in ${Math.floor(age/1000)} seconds ago.`
    :`Checked in ${Math.floor(age/60000)} ${age<120000?'minute':'minutes'} ago.`;
  if(!connected)return {tone:'quiet',label:'Updates unavailable',detail:'Reconnect to check whether the builder is working.',lastSeen};
  if(card.status==='building') {
    if(age===null)return {tone:'quiet',label:'Waiting for an update',detail:'Your idea is saved. We have not received a check-in yet.',lastSeen};
    if(age>=ACTIVITY_FRESH_MS)return {tone:'quiet',label:'No recent update',detail:'We cannot confirm the builder is still working. Your idea is saved.',lastSeen};
    return {tone:'active',label:'Working now',detail:'The builder is making or testing your change.',lastSeen};
  }
  const details={
    queued:'Your idea is saved and waiting for the builder.',
    checking:'The change is made. Waiting for preview checks to finish.',
    question:'The builder is waiting for your reply below.',
    failed:'The builder stopped. Read its message below for what happened. Your idea and conversation are saved.',
    ready:'The builder has finished. Your preview is ready to try.',
    shipped:'This change is now part of Plunge.',
    closed:'The builder is not working on this idea.',
  };
  const label=card.status==='question'?'Waiting for your reply':card.status==='queued'?'Waiting to start'
    :card.status==='checking'?'Waiting for preview':IDEA_STATUS[card.status];
  return {tone:card.status==='failed'?'quiet':['ready','shipped'].includes(card.status)?'done':'waiting',label,detail:details[card.status],lastSeen:''};
}
