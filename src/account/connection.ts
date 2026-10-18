/** Only Plunge's consent and connection-management pages can follow a passkey sign-in. */
export function connectionReturn(value: string | null, origin: string): string | null {
  if (!value?.startsWith('/')) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && (url.pathname === '/oauth/authorize' || url.pathname === '/oauth/connections')
      ? url.pathname + url.search : null;
  } catch { return null; }
}
