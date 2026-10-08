export type IdeaStatus = 'queued' | 'building' | 'checking' | 'ready' | 'question' | 'failed' | 'shipped' | 'closed';
export interface IdeaCard {
  number: number; id: string; name: string; title: string; context: string;
  created: string; updated: string; revision: number; status: IdeaStatus;
  pr: number | null; sha: string | null; preview: string | null;
}
export interface IdeaMessage { id: string; role: 'family' | 'builder'; name: string; body: string; created: string }
export interface IdeaThread { card: IdeaCard; messages: IdeaMessage[] }
export const IDEA_ID = /^[a-f0-9]{32}$/;
export const IDEA_TOKEN = /^[a-f0-9]{64}$/;
export const IDEA_STATUS: Record<IdeaStatus, string> = {
  queued: 'Waiting to build', building: 'Making your change', checking: 'Checking your preview',
  ready: 'Ready to try', question: 'A question for you', failed: 'Needs attention', shipped: 'In the game', closed: 'Set aside',
};
export const LIVE_PLUNGE = 'https://plunge.texas42.workers.dev';
export function previewFor(pr: number): string { return `https://plunge-pr-${pr}.texas42.workers.dev`; }
