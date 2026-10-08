/** Ordinary-code scheduling and durable idea/session routing. No model calls here. */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const IDEA = /^[a-f0-9]{32}$/;
const SESSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function sessionFile(stateDir, ideaId) {
  if (!IDEA.test(ideaId)) throw new Error('Invalid idea session identifier.');
  return join(stateDir, 'ideas', ideaId, 'session.json');
}
export function saveIdeaSession(stateDir, record) {
  const file = sessionFile(stateDir, record.ideaId);
  if (!SESSION.test(record.sessionId) || !IDEA.test(record.runId)) throw new Error('Invalid Codex session identity.');
  mkdirSync(join(stateDir, 'ideas', record.ideaId), { recursive: true, mode: 0o700 });
  // Synchronous and atomic: retain the identity as soon as thread.started arrives,
  // including when the process later fails or the Mac restarts.
  writeFileSync(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
export async function loadIdeaSession(stateDir, ideaId) {
  const file = sessionFile(stateDir, ideaId);
  try {
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.ideaId !== ideaId || !SESSION.test(record.sessionId) || !IDEA.test(record.runId)) throw new Error('Invalid saved idea session.');
    return record;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Upgrade existing cards without discarding the session they are already using.
  const runs = await readdir(join(stateDir, 'runs')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const candidates = [];
  for (const runId of runs.filter(name => IDEA.test(name))) {
    const dir = join(stateDir, 'runs', runId);
    const request = await readFile(join(dir, 'request.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!request || JSON.parse(request).card.id !== ideaId) continue;
    const info = await stat(join(dir, 'build.log')).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info) candidates.push({ dir, runId, time: info.mtimeMs });
  }
  for (const { dir, runId } of candidates.sort((a,b) => b.time-a.time)) {
    for (const line of (await readFile(join(dir, 'build.log'), 'utf8')).split('\n')) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== 'thread.started' || !SESSION.test(event.thread_id)) continue;
      const record = { ideaId, sessionId: event.thread_id, runId };
      saveIdeaSession(stateDir, record);
      return record;
    }
  }
  return null;
}

export function sessionRecorder(stateDir, job, logDir, previous) {
  let seen = false;
  return event => {
    if (event.type !== 'thread.started') return;
    if (seen || (previous && event.thread_id !== previous.sessionId)) throw new Error('Codex did not resume the expected idea session.');
    const record = { ideaId: job.card.id, sessionId: event.thread_id, runId: job.run.id };
    saveIdeaSession(stateDir, record);
    writeFileSync(join(logDir, 'session.json'), JSON.stringify({ ...record, resumed: !!previous }), { mode: 0o600 });
    seen = true;
  };
}

export function concurrency(config) {
  const limit = config.maxConcurrent ?? 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) throw new Error('maxConcurrent must be an integer from 1 to 4.');
  return limit;
}
function waitForWork(active, pollMs, signal) {
  let timer, wake;
  const tick = new Promise(resolve => {
    wake = resolve;
    timer = setTimeout(resolve, pollMs);
    signal.addEventListener('abort', wake, { once: true });
    if (signal.aborted) resolve();
  });
  return Promise.race([tick, ...active.values()]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', wake);
  });
}
/** Fill free slots immediately; keep polling while other ideas are still building. */
export async function coordinate({ limit = 3, claim, build, inspect = async()=>{}, pollMs = 15000,
  signal = new AbortController().signal, onError = error => console.error(error.message) }) {
  concurrency({ maxConcurrent: limit });
  const active = new Map();
  try {
    while (!signal.aborted) {
      try {
        await inspect();
        while (active.size < limit && !signal.aborted) {
          const job = await claim([...active.keys()]);
          if (!job) break;
          if (active.has(job.card.id)) throw new Error('Service claimed an already active idea.');
          const task = Promise.resolve().then(() => build(job)).catch(onError).finally(() => active.delete(job.card.id));
          active.set(job.card.id, task);
        }
      } catch (error) {
        onError(error);
      }
      if (!active.size) return;
      await waitForWork(active, pollMs, signal);
    }
  } finally {
    // Do not release the coordinator lock until every child has stopped.
    await Promise.allSettled(active.values());
  }
}
