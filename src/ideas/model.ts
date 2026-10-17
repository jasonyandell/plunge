import type { ScreenshotInfo } from './screenshots';
export type IdeaStatus = 'queued' | 'building' | 'checking' | 'ready' | 'question' | 'failed' | 'shipped' | 'closed';
export interface IdeaCard {
  number: number; id: string; name: string; title: string; context: string;
  created: string; updated: string; revision: number; status: IdeaStatus;
  pr: number | null; sha: string | null; preview: string | null;
  /** `hand`: made by hand and linked to its PR; replies are conversation, never a build. */
  lane?: 'builder' | 'hand';
  activity?: {lastSeenAt:number|null;observedAt:number};
}
export interface IdeaMessage { id: string; role: 'family' | 'builder'; name: string; body: string; created: string; screenshots?:ScreenshotInfo[] }
export interface IdeaThread { card: IdeaCard; messages: IdeaMessage[]; permissions?: {scope:'limited'|'repository';accountId:string|null;source:'default'|'owner'|'approval'} }
export const IDEA_ID = /^[a-f0-9]{32}$/;
export const IDEA_TOKEN = /^[a-f0-9]{64}$/;
export const IDEA_STATUS: Record<IdeaStatus, string> = {
  queued: 'Waiting to build', building: 'Making your change', checking: 'Checking your preview',
  ready: 'Ready to try', question: 'A question for you', failed: 'Needs attention', shipped: 'In the game', closed: 'Set aside',
};
export const LIVE_PLUNGE = 'https://plunge.texas42.workers.dev';
export function previewFor(pr: number): string { return `https://plunge-pr-${pr}.texas42.workers.dev`; }
