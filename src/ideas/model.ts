import type { ScreenshotInfo } from './screenshots';
/** `iced`: rested after quiet days, its PR closed and preview gone. `waking`: asked back; the PR reopens and the preview redeploys. */
export type IdeaStatus = 'queued' | 'building' | 'checking' | 'ready' | 'question' | 'failed' | 'shipped' | 'closed' | 'iced' | 'waking';
export interface IdeaCard {
  number: number; id: string; name: string; title: string; context: string;
  created: string; updated: string; revision: number; status: IdeaStatus;
  pr: number | null; sha: string | null; preview: string | null;
  /** `hand`: made by hand and linked to its PR; replies are conversation, never a build. */
  lane?: 'builder' | 'hand';
  releaseStatus?: 'queued'|'releasing'|'deploying'|null;
  activity?: {lastSeenAt:number|null;observedAt:number};
}
export interface IdeaMessage {
  id: string; role: 'family' | 'builder'; name: string; body: string; created: string; screenshots?:ScreenshotInfo[];
  /** Server-derived association with the frozen request answered by a completed run. */
  result?: { revision: number; requestId: string };
}
export interface IdeaRelease {id:string;revision:number;pr:number;sha:string;status:'queued'|'releasing'|'deploying'|'shipped'|'blocked';note:string}
export interface IdeaThread { release?:IdeaRelease|null; card: IdeaCard; messages: IdeaMessage[]; permissions?: {scope:'limited'|'repository';accountId:string|null;source:'default'|'owner'|'approval'} }
export const IDEA_ID = /^[a-f0-9]{32}$/;
export const IDEA_TOKEN = /^[a-f0-9]{64}$/;
export const IDEA_STATUS: Record<IdeaStatus, string> = {
  queued: 'Waiting to build', building: 'Making your change', checking: 'Checking your preview',
  ready: 'Ready to try', question: 'A question for you', failed: 'Needs attention', shipped: 'In the game', closed: 'Set aside',
  iced: 'On ice', waking: 'Waking up',
};
export const LIVE_PLUNGE = 'https://plunge.texas42.workers.dev';
export function previewFor(pr: number): string { return `https://plunge-pr-${pr}.texas42.workers.dev`; }
