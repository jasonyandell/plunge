/** IndexedDB transactions keep edits and upload acknowledgements safe across tabs. */
import type { LocalQuestion, Question, RemoteQuestion } from './model';
import { OWNER_TOKEN } from './model';
let opened: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('plunge-questions', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('questions', { keyPath: 'question.id' }).createIndex('target', 'target', { unique: true });
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opened = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opened = undefined; reject(new Error('This browser could not save the question.')); };
  });
}
export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function ownerToken(): Promise<string> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('meta', 'readwrite'), store = tx.objectStore('meta');
    let token = '';
    const request = store.get('owner');
    request.onsuccess = () => {
      token = typeof request.result === 'string' && OWNER_TOKEN.test(request.result) ? request.result : randomHex(32);
      store.put(token, 'owner');
    };
    tx.oncomplete = () => resolve(token);
    tx.onabort = tx.onerror = () => reject(new Error('This browser could not save its question key.'));
  });
}
export const questionTarget = (q: Question): string => `${q.game_id}:${q.hand_number}:${q.ply}:${q.snapshot.slice(0,61)}`
  + (q.schema === 'plunge-question-v2' ? `:hint:${q.snapshot}:${q.hint_id}` : '');
export async function listQuestions(): Promise<LocalQuestion[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('questions').objectStore('questions').getAll();
    r.onsuccess = () => resolve((r.result as LocalQuestion[]).sort((a,b) => b.question.created.localeCompare(a.question.created)));
    r.onerror = () => reject(r.error);
  });
}
export async function changeQuestion(id: string, fn: (old: LocalQuestion | undefined) => LocalQuestion | undefined): Promise<LocalQuestion | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('questions','readwrite'), store = tx.objectStore('questions');
    let result: LocalQuestion | undefined;
    const r = store.get(id);
    r.onsuccess = () => { result = fn(r.result as LocalQuestion | undefined); if (result) store.put(result); };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(new Error('The question could not be saved. Please try again.'));
  });
}
export async function insertQuestion(question: Question): Promise<LocalQuestion> {
  await ownerToken();
  const database = await db(), target = questionTarget(question);
  return new Promise((resolve, reject) => {
    const tx = database.transaction('questions','readwrite'), store = tx.objectStore('questions');
    let result: LocalQuestion;
    const r = store.index('target').get(target);
    r.onsuccess = () => {
      result = r.result as LocalQuestion ?? { question, target, revision: 1, syncedRevision: 0, answer: null };
      // Repeated taps refer to the original bookmark; they never erase a note.
      if (!r.result) store.add(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(new Error('The question could not be saved. Please try again.'));
  });
}
export async function acceptRemote(remote: RemoteQuestion): Promise<void> {
  await changeQuestion(remote.question.id, old => {
    if (!old || old.revision <= old.syncedRevision) return { ...remote, target: questionTarget(remote.question), syncedRevision: remote.revision };
    return { ...old, answer: remote.answer };
  });
}
