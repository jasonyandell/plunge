/** Only this idea's preview opens the demo by default. Explicit routes and saved
 * game/room links keep their destination; the main app's home is unchanged. */
export function seatDemoRoute(search: string, hash: string, hostname: string, localOnly: boolean): boolean {
  const params = new URLSearchParams(search);
  if (hash || ['rooms', 'account', 'ideas', 'stats', 'play'].some(key => params.has(key))) return false;
  return params.get('demo') === 'seats'
    || (localOnly && hostname === 'plunge-pr-87.texas42.workers.dev' && !search);
}
