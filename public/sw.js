/* Plunge service worker — the whole game, Walt included, is saved at install so
 * it plays with no connection from the first launch. The build fills in BUILD
 * and FILES (vite.config.ts); this unbuilt copy precaches nothing. */
const BUILD = 'dev';
const FILES = [];
const CACHE = `plunge-${BUILD}`;
const SHELL = '/';
// A slow signal (one bar at the lake) shouldn't stall the table: after this
// long, a page load falls back to the saved game.
const NAVIGATION_WAIT_MS = 4000;

// All-or-nothing: if any file fails to download, install fails and the
// previous version keeps running, complete, until the next try.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          [SHELL, ...FILES].map(async (path) => {
            // Hashed files never change: reuse an earlier version's copy so an
            // update doesn't download Walt's 6 MB again.
            const kept = path.startsWith('/assets/') && (await caches.match(path));
            if (kept) return c.put(path, kept);
            const res = await fetch(path, { cache: 'reload' });
            if (!res.ok) throw new Error(`${path}: ${res.status}`);
            // A redirected response can't answer a page load; store a clean copy.
            await c.put(path, res.redirected ? new Response(await res.blob(), res) : res);
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

// Keep this build and the one before it: a page still open on the old version
// starts a fresh Walt worker every move and needs that version's files.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const ours = keys.filter((k) => k !== CACHE);
        const keep = new Set([CACHE, ours.filter((k) => k.startsWith('plunge-') && k !== 'plunge-dev').at(-1)]);
        return Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Local research code and live experiment status always come from the server.
  if (['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) return;
  // The deploy beacon must always come from the network (deploy-aware reload).
  if (url.pathname === '/version.json') return;

  // Page loads: network-first so a fresh deploy shows up, the saved game when
  // offline or slow. The network copy is never cached: the saved page must
  // stay the one that matches this version's saved files.
  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise((resolve) => {
        const saved = () => caches.open(CACHE).then((c) => c.match(SHELL)).then((hit) => hit ?? caches.match(SHELL));
        const timer = setTimeout(() => saved().then((hit) => hit && resolve(hit)), NAVIGATION_WAIT_MS);
        fetch(req)
          .then((res) => { clearTimeout(timer); resolve(res); })
          .catch(() => { clearTimeout(timer); saved().then((hit) => resolve(hit ?? Response.error())); });
      }),
    );
    return;
  }

  // Everything else: saved first, fill on miss.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
