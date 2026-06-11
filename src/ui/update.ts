/**
 * Deploy-aware reload (issue #2). CI stamps /version.json with the commit SHA
 * at deploy; the same SHA is baked into the bundle as __BUILD_ID__. When they
 * disagree, a fresh version has shipped. Pure decision logic here; the poll
 * timer and banner live in App.tsx.
 */

/** Injected by vite.config.ts at build time; 'dev' outside CI builds (and in vitest). */
export const BUILD_ID: string = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

export const VERSION_URL = '/version.json';
export const UPDATE_POLL_MS = 5 * 60_000;

/** A fresh deploy is one with a real, different build id. */
export function updateAvailable(current: string, remote: unknown): boolean {
  if (current === 'dev') return false; // local dev / preview — never nag
  if (typeof remote !== 'object' || remote === null) return false;
  const build = (remote as { build?: unknown }).build;
  return typeof build === 'string' && build.length > 0 && build !== current;
}

/** Fetch the deployed build id, bypassing every cache. Null on any failure. */
export async function fetchRemoteVersion(): Promise<unknown> {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null; // offline / flaky — try again next poll
  }
}
