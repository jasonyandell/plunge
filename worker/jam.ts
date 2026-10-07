/**
 * Family jam: an idea typed at the table becomes a GitHub issue, a builder
 * turns it into a pull request, the existing PR preview deploys it, and the
 * conversation lives in the issue/PR comments. GitHub is the only store; this
 * module is a thin, passphrase-gated proxy with caps, so a leaked passphrase
 * can only file a bounded number of ideas per day.
 *
 * Two builders produce the same GitHub shapes:
 *   codex  — the Codex cloud GitHub integration (Jason's ChatGPT plan) picks
 *            up `@codex` mentions that this Worker posts as the repo owner.
 *   action — `.github/workflows/jam.yml` runs `openai/codex-action` with an
 *            OpenAI API key whenever a `jam` issue is labeled or replied to.
 */

export const JAM_LABEL = 'jam';
export const MARKER = '<!-- plunge-jam';
export const INSTRUCTIONS = '<!-- plunge-jam:instructions -->';
export const DEFAULT_REPO = 'jasonyandell/plunge';
export const DEFAULT_PREVIEW_HOST = 'plunge-pr-{n}.texas42.workers.dev';
export const LIMITS = { name: 24, idea: 2000, reply: 1500, device: 120, ideasPerDay: 20, repliesPerHour: 12, body: 16384 } as const;
const LIST_TTL = 20000;
const REPO = /^[\w.-]+\/[\w.-]+$/;

export type Backend = 'codex' | 'action';
export type JamStatus = 'waiting' | 'working' | 'preview' | 'shipped' | 'closed';
export interface JamEnv {
  JAM_GITHUB_TOKEN?: string; JAM_PASSPHRASE?: string; JAM_BACKEND?: string; JAM_REPO?: string; JAM_PREVIEW_HOST?: string;
}
export interface JamIdea {
  number: number; title: string; from: string; created: string; updated: string; status: JamStatus;
  pr: number | null; preview: string | null; link: string; replies: number;
}
export interface JamMessage { from: string; kind: 'family' | 'builder' | 'maintainer'; body: string; at: string }
export interface JamThread extends JamIdea { idea: string; messages: JamMessage[] }
export interface JamBoard { backend: Backend; repo: string; ideas: JamIdea[] }

// --- GitHub shapes (only the fields read here) ------------------------------
interface GhUser { login: string; type: string }
interface GhLabel { name: string }
export interface GhIssue {
  number: number; title: string; body: string | null; state: 'open' | 'closed'; created_at: string; updated_at: string;
  html_url: string; user: GhUser; labels: GhLabel[]; comments: number; pull_request?: unknown;
}
export interface GhPull {
  number: number; title: string; body: string | null; state: 'open' | 'closed'; merged_at: string | null;
  html_url: string; updated_at: string; head: { ref: string };
}
export interface GhComment { body: string | null; created_at: string; user: GhUser }

export type Github = <T>(path: string, init?: RequestInit) => Promise<T>;
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function backend(env: JamEnv): Backend { return env.JAM_BACKEND === 'action' ? 'action' : 'codex'; }
export function repoOf(env: JamEnv): string {
  const repo = env.JAM_REPO ?? DEFAULT_REPO;
  if (!REPO.test(repo)) throw new Error('JAM_REPO must look like owner/name.');
  return repo;
}
/** A minimal GitHub REST client with the repo-scoped fine-grained token. */
export function github(env: JamEnv, request: Fetch = fetch): Github {
  const repo = repoOf(env);
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await request(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.JAM_GITHUB_TOKEN}`, 'User-Agent': 'plunge-jam',
      'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} failed (${response.status}).`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
}

// --- Text ---------------------------------------------------------------------
/** Family text is quoted into public GitHub markdown: no control characters, no live mentions, no spoofed markers. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n')
    .replace(/@(?=\w)/g, '@‌').replace(/<!--/g, '<!-‌-').trim().slice(0, max).trim();
}
export function cleanName(value: unknown): string {
  const name = cleanText(value, LIMITS.name).replace(/\n+/g, ' ').replace(/["*_`<>[\]]/g, '').trim();
  return name || 'Family';
}
/** Forgiving match for a passphrase typed by hand: case and spacing don't matter. */
export const normalizePassphrase = (value: string): string => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export async function passphraseMatches(offered: string | null, expected: string): Promise<boolean> {
  if (!offered) return false;
  const encode = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizePassphrase(value))));
  const [a, b] = await Promise.all([encode(offered), encode(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
export const ideaTitle = (idea: string): string => {
  const line = idea.split('\n').find(l => l.trim())?.trim().replace(/[#*_`>]/g, '') ?? 'An idea from the table';
  return line.length > 72 ? `${line.slice(0, 69).trimEnd()}…` : line;
};
const fromMarker = (name: string) => `${MARKER} from="${name.replace(/"/g, '')}" -->`;
export function issueBody(name: string, idea: string, device: string): string {
  return [fromMarker(name), `**From ${name}, at the Plunge table.**`, '', idea.split('\n').map(l => `> ${l}`).join('\n'), '',
    device ? `Device: ${device}` : '', '', '---', '_Filed from the Family jam inside Plunge. Replies on this thread reach them in the app._'].join('\n');
}
export function commentBody(name: string, text: string, instructions: string): string {
  return [fromMarker(name), `**${name}:** ${text}`, ...(instructions ? ['', INSTRUCTIONS, instructions] : [])].join('\n');
}
/** The `@codex` trigger text posted by the repo owner. Only used by the codex backend. */
export function codexTrigger(number: number, title: string, kind: 'idea' | 'reply'): string {
  return kind === 'idea'
    ? `@codex Please build this family idea from Plunge. Read the Family jam section of AGENTS.md first. Work on branch \`jam/${number}\`, open a pull request titled \`Jam #${number}: ${title}\` whose body says \`Closes #${number}\`, keep the change small and tested (\`npm run typecheck && npm test\`), and reply on this issue in two or three plain sentences a non-programmer can follow.`
    : `@codex Please take this reply from the family into account for Jam #${number}: push to the open pull request's branch if there is one, run \`npm run typecheck && npm test\`, and answer here in plain language.`;
}
/** What the app shows: the marker, the bold name prefix and any builder instructions are stripped. */
export function familyView(body: string | null): { from: string | null; text: string } {
  const raw = body ?? '';
  const from = /^<!-- plunge-jam from="([^"\n]{1,24})" -->\n?/.exec(raw);
  let text = from ? raw.slice(from[0].length) : raw;
  const cut = text.indexOf(INSTRUCTIONS);
  if (cut >= 0) text = text.slice(0, cut);
  if (from) text = text.replace(new RegExp(`^\\*\\*${from[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\* ?`), '');
  return { from: from?.[1] ?? null, text: text.trim() };
}
/** The idea as typed, out of the issue body's blockquote. */
export function ideaFromIssue(body: string | null): string {
  const { text } = familyView(body);
  const quoted = text.split('\n').filter(l => l.startsWith('>')).map(l => l.replace(/^> ?/, ''));
  return (quoted.length ? quoted.join('\n') : text.split('\n---\n')[0] ?? '').trim();
}

// --- Linking issues, pull requests and previews --------------------------------
export function linkedIssue(pr: Pick<GhPull, 'title' | 'body' | 'head'>): number | null {
  const title = /^jam #(\d+)/i.exec(pr.title)?.[1] ?? /^jam\/(\d+)/.exec(pr.head.ref)?.[1]
    ?? /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(pr.body ?? '')?.[1];
  return title ? Number(title) : null;
}
/** One PR per idea: the open one, else the merged one, else the latest closed one. */
export function pullFor(number: number, pulls: GhPull[]): GhPull | null {
  const mine = pulls.filter(pr => linkedIssue(pr) === number).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return mine.find(pr => pr.state === 'open') ?? mine.find(pr => pr.merged_at) ?? mine[0] ?? null;
}
export function jamStatus(issue: Pick<GhIssue, 'state'>, pr: GhPull | null, previewLive: boolean): JamStatus {
  if (pr?.merged_at) return 'shipped';
  if (issue.state === 'closed') return 'closed';
  if (pr?.state === 'open') return previewLive ? 'preview' : 'working';
  return 'waiting';
}
export const previewUrl = (pr: number, host = DEFAULT_PREVIEW_HOST): string => `https://${host.replace('{n}', String(pr))}`;
/** The preview workflow stamps version.json with the PR it serves; nothing else counts as live. */
export async function previewLive(pr: number, host: string, request: Fetch): Promise<boolean> {
  try {
    const response = await request(`${previewUrl(pr, host)}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(6000) } as RequestInit);
    if (!response.ok) return false;
    const version = await response.json() as { preview_pr?: unknown };
    return version.preview_pr === pr;
  } catch { return false; }
}
const kindOf = (user: GhUser): JamMessage['kind'] => user.type === 'Bot' || /codex|github-actions|\[bot\]/i.test(user.login) ? 'builder' : 'maintainer';
export function messagesFrom(comments: GhComment[]): JamMessage[] {
  return comments.flatMap(comment => {
    const { from, text } = familyView(comment.body);
    if (!text) return [];
    return [{ from: from ?? (kindOf(comment.user) === 'builder' ? 'Builder' : comment.user.login), kind: from ? 'family' : kindOf(comment.user),
      body: text, at: comment.created_at }];
  }).sort((a, b) => a.at.localeCompare(b.at));
}
const familyFrom = (issue: GhIssue): string => familyView(issue.body).from ?? issue.user.login;

// --- Board assembly with a short in-memory cache -------------------------------
interface Loaded { issues: GhIssue[]; pulls: GhPull[]; live: Map<number, boolean>; at: number }
let cache: { key: string; value: Promise<Loaded> } | null = null;
export function clearJamCache(): void { cache = null; }
async function load(env: JamEnv, gh: Github, request: Fetch): Promise<Loaded> {
  const key = `${repoOf(env)}|${env.JAM_PREVIEW_HOST ?? ''}`;
  if (cache?.key === key) {
    const value = await cache.value.catch(() => null);
    if (value && Date.now() - value.at < LIST_TTL) return value;
  }
  const value = (async () => {
    const [issues, pulls] = await Promise.all([
      gh<GhIssue[]>(`/issues?labels=${JAM_LABEL}&state=all&sort=created&direction=desc&per_page=60`),
      gh<GhPull[]>('/pulls?state=all&sort=updated&direction=desc&per_page=100'),
    ]);
    const ideas = issues.filter(issue => !issue.pull_request);
    const open = [...new Set(ideas.map(issue => pullFor(issue.number, pulls)).filter((pr): pr is GhPull => pr?.state === 'open').map(pr => pr.number))];
    const live = new Map(await Promise.all(open.map(async pr => [pr, await previewLive(pr, env.JAM_PREVIEW_HOST ?? DEFAULT_PREVIEW_HOST, request)] as const)));
    return { issues: ideas, pulls, live, at: Date.now() };
  })();
  cache = { key, value };
  try { return await value; } catch (error) { cache = null; throw error; }
}
function idea(issue: GhIssue, loaded: Loaded, env: JamEnv): JamIdea {
  const pr = pullFor(issue.number, loaded.pulls);
  const status = jamStatus(issue, pr, pr ? loaded.live.get(pr.number) ?? false : false);
  return { number: issue.number, title: ideaTitle(ideaFromIssue(issue.body) || issue.title), from: familyFrom(issue), created: issue.created_at,
    updated: issue.updated_at, status, pr: pr?.number ?? null, preview: status === 'preview' && pr ? previewUrl(pr.number, env.JAM_PREVIEW_HOST ?? DEFAULT_PREVIEW_HOST) : null,
    link: issue.html_url, replies: issue.comments };
}
export async function board(env: JamEnv, gh: Github, request: Fetch): Promise<JamBoard> {
  const loaded = await load(env, gh, request);
  return { backend: backend(env), repo: repoOf(env), ideas: loaded.issues.map(issue => idea(issue, loaded, env)) };
}
export async function thread(number: number, env: JamEnv, gh: Github, request: Fetch): Promise<JamThread | null> {
  const loaded = await load(env, gh, request);
  const issue = loaded.issues.find(i => i.number === number);
  if (!issue) return null;
  const summary = idea(issue, loaded, env);
  const comments = await gh<GhComment[]>(`/issues/${number}/comments?per_page=100`);
  const prComments = summary.pr ? await gh<GhComment[]>(`/issues/${summary.pr}/comments?per_page=100`) : [];
  return { ...summary, idea: ideaFromIssue(issue.body) || issue.title, messages: messagesFrom([...comments, ...prComments]) };
}

// --- Writes -------------------------------------------------------------------
export class JamError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function fileIdea(env: JamEnv, gh: Github, request: Fetch, input: { name: unknown; idea: unknown; device?: unknown }): Promise<JamIdea> {
  const name = cleanName(input.name), text = cleanText(input.idea, LIMITS.idea), device = cleanText(input.device, LIMITS.device).replace(/\n/g, ' ');
  if (text.length < 4) throw new JamError('Tell us a little more about the idea.', 400);
  const loaded = await load(env, gh, request);
  const day = Date.now() - 24 * 60 * 60 * 1000;
  if (loaded.issues.filter(issue => Date.parse(issue.created_at) > day).length >= LIMITS.ideasPerDay)
    throw new JamError('The jam box is full for today. Bring it back tomorrow!', 429);
  const title = ideaTitle(text);
  const issue = await gh<GhIssue>('/issues', { method: 'POST', body: JSON.stringify({ title, body: issueBody(name, text, device), labels: [JAM_LABEL] }) });
  if (backend(env) === 'codex') await gh(`/issues/${issue.number}/comments`, { method: 'POST',
    body: JSON.stringify({ body: `${INSTRUCTIONS}\n${codexTrigger(issue.number, title, 'idea')}` }) });
  clearJamCache();
  return { number: issue.number, title, from: name, created: issue.created_at, updated: issue.updated_at, status: 'waiting', pr: null, preview: null,
    link: issue.html_url, replies: 0 };
}
export async function reply(number: number, env: JamEnv, gh: Github, request: Fetch, input: { name: unknown; text: unknown }): Promise<JamMessage> {
  const name = cleanName(input.name), text = cleanText(input.text, LIMITS.reply);
  if (!text) throw new JamError('Write a line first.', 400);
  const current = await thread(number, env, gh, request);
  if (!current) throw new JamError('That idea is not on the board.', 404);
  const hour = Date.now() - 60 * 60 * 1000;
  if (current.messages.filter(m => m.kind === 'family' && Date.parse(m.at) > hour).length >= LIMITS.repliesPerHour)
    throw new JamError('Lots of chatter on this one. Give the builder a few minutes.', 429);
  // Once a pull request is open the conversation moves there: that is the branch the builder pushes to.
  const target = current.status === 'preview' || current.status === 'working' ? current.pr! : number;
  const instructions = backend(env) === 'codex' ? codexTrigger(number, current.title, 'reply') : '';
  await gh(`/issues/${target}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody(name, text, instructions) }) });
  clearJamCache();
  return { from: name, kind: 'family', body: text, at: new Date().toISOString() };
}

// --- HTTP ---------------------------------------------------------------------
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new JamError('Nothing was sent.', 400);
  let size = 0, text = ''; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > LIMITS.body) { await reader.cancel(); throw new JamError('That is too long for the jam box.', 413); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { const value = JSON.parse(text + decoder.decode()) as unknown; return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
  catch { throw new JamError('That could not be read.', 400); }
}
export async function jamRequest(request: Request, env: JamEnv, fetchImpl: Fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/jam(?:\/([1-9]\d{0,6})(\/replies)?)?$/.exec(url.pathname);
  if (!match) return json({ error: 'Not found.' }, 404);
  if (!env.JAM_GITHUB_TOKEN || !env.JAM_PASSPHRASE) return json({ error: 'The family jam lives on the main Plunge site.', unavailable: true }, 503);
  const offered = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? null;
  if (!await passphraseMatches(offered ? safeDecode(offered) : null, env.JAM_PASSPHRASE)) return json({ error: 'That family passphrase did not match.' }, 401);
  const origin = request.headers.get('Origin');
  if (request.method !== 'GET' && origin && origin !== url.origin) return json({ error: 'Wrong origin.' }, 403);
  const number = match[1] ? Number(match[1]) : null, replies = Boolean(match[2]);
  const gh = github(env, fetchImpl);
  try {
    if (request.method === 'GET' && number === null && !replies) return json(await board(env, gh, fetchImpl));
    if (request.method === 'GET' && number !== null && !replies) {
      const value = await thread(number, env, gh, fetchImpl);
      return value ? json(value) : json({ error: 'That idea is not on the board.' }, 404);
    }
    if (request.method === 'POST' && number === null) return json(await fileIdea(env, gh, fetchImpl, await readBody(request) as { name: unknown; idea: unknown; device?: unknown }), 201);
    if (request.method === 'POST' && number !== null && replies) return json(await reply(number, env, gh, fetchImpl, await readBody(request) as { name: unknown; text: unknown }), 201);
    return json({ error: 'Method not allowed.' }, 405);
  } catch (error) {
    if (error instanceof JamError) return json({ error: error.message }, error.status);
    console.error('jam:', error instanceof Error ? error.message : error);
    return json({ error: 'The jam board is taking a breather. Try again in a minute.' }, 503);
  }
}
const safeDecode = (value: string): string => { try { return decodeURIComponent(value); } catch { return value; } };
