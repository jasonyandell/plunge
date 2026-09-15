import { encodeReplay } from '../engine/replay-code';
import type { GameState } from '../engine';
import { api, nativeSeed, type NativeReceipt } from '../ai/native';
import { BUILD_ID } from '../ui/update';
import { allPlays, finished, validQuestion, type LocalQuestion, type PublicQuestion, type RemoteQuestion } from './model';
import { acceptRemote, changeQuestion, insertQuestion, listQuestions, ownerToken, randomHex } from './storage';
export { listQuestions } from './storage';

const changed = () => window.dispatchEvent(new Event('plunge-questions-changed'));
const API = '/api/questions';
let flushing: Promise<void> | undefined;
async function request<T>(path: string, init: RequestInit = {}, privateRequest = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (privateRequest) headers.set('Authorization', `Bearer ${await ownerToken()}`);
  if (init.body) headers.set('Content-Type','application/json');
  const r = await fetch(`${API}${path}`, { ...init, headers, cache:'no-store', signal:AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Question service unavailable (${r.status}). Your saved copy stays on this device.`);
  return await r.json() as T;
}
export async function saveQuestion(g: GameState, ply: number, sessionId: string, receiptId: string | null,
  note: string | undefined = undefined, alternative: number | null = null, original: NativeReceipt | null = null, seed?: number): Promise<LocalQuestion> {
  const replay = encodeReplay(g);
  if (!replay || !allPlays(g)[ply]) throw new Error('That play could not be saved.');
  const question = validQuestion({ schema:'plunge-question-v1', id:randomHex(16), created:new Date().toISOString(),
    game_id:sessionId, hand_number:g.handNumber, ply, seed:seed ?? original?.identity.request.seed ?? nativeSeed(sessionId,g.handNumber),
    snapshot:replay, replay, note:note ?? '', alternative, receipt_id:receiptId, receipt:original, build:BUILD_ID });
  let saved = await insertQuestion(question);
  // A plain table tap preserves the note; an explicit examiner save applies its edits.
  if (note !== undefined) saved = (await changeQuestion(saved.question.id, old => {
    if (!old) return old;
    const next = validQuestion({...old.question,note,alternative,
      replay:replay.startsWith(old.question.replay) ? replay : old.question.replay});
    return JSON.stringify(next) === JSON.stringify(old.question) ? old : {...old,question:next,revision:old.revision+1};
  }))!;
  changed();
  // The bookmark is durable before loading its separate original receipt.
  // Missing receipts are retried too; the durable bookmark can upload immediately.
  void syncQuestions();
  return saved;
}
export async function editNote(id: string, note: string): Promise<void> {
  await changeQuestion(id, old => old && old.question.note !== note ? {
    ...old, question:{...old.question,note:note.slice(0,4000)}, revision:old.revision+1,
  } : old);
  changed(); void syncQuestions();
}
export async function attachGame(g: GameState, sessionId: string): Promise<void> {
  if (!finished(g)) return;
  const replay = encodeReplay(g);
  if (!replay) return;
  let updated = false;
  for (const item of await listQuestions()) {
    if (item.question.game_id !== sessionId || item.question.hand_number !== g.handNumber) continue;
    await changeQuestion(item.question.id, old => {
      if (!old || replay.length <= old.question.replay.length || !replay.startsWith(old.question.replay)) return old;
      updated = true;
      return {...old,question:{...old.question,replay},revision:old.revision+1};
    });
  }
  if (updated) changed();
}
/** Acknowledge only the version actually sent. An edit during upload stays pending. */
export function syncQuestions(): Promise<void> {
  return flushing ??= (async () => {
    for (let item of await listQuestions()) {
      if (item.question.receipt_id && !item.question.receipt) {
        try {
          const receipt = await api<NativeReceipt>(`receipts/${item.question.receipt_id}`);
          const q = validQuestion({...item.question, receipt});
          item = (await changeQuestion(item.question.id, old => old && !old.question.receipt
            ? {...old, question:{...old.question,receipt:q.receipt},revision:old.revision+1} : old))!;
        } catch { /* Preserve the receipt id; retry after the local bridge or storage recovers. */ }
      }
      if (item.revision <= item.syncedRevision) continue;
      try {
        const ack = await request<{revision:number; answer:RemoteQuestion['answer']}>(`/${item.question.id}`, {
          method:'PUT',body:JSON.stringify({question:item.question,revision:item.revision}),
        });
        await changeQuestion(item.question.id, old => old && ({...old,
          syncedRevision:Math.max(old.syncedRevision, Math.min(item.revision,ack.revision)), answer:ack.answer}));
        changed();
      } catch { break; } // Offline or service down: retry the same ids, never invent success.
    }
  })().catch(() => { /* Saving itself reports errors; background sync never interrupts a game. */ })
    .finally(() => { flushing = undefined; });
}
export async function refreshQuestions(): Promise<void> {
  await syncQuestions();
  let cursor = '';
  do {
    const page = await request<{items:RemoteQuestion[]; next:string|null}>(cursor ? `?before=${cursor}` : '');
    for (const item of page.items) { validQuestion(item.question); await acceptRemote(item); }
    cursor = page.next ?? '';
  } while(cursor);
  changed();
}
export const getPublicQuestion = (id: string) => request<PublicQuestion>(`/${id}`,{},false);
export const questionLink = (id: string) => `${location.origin}/#question=${id}`;
