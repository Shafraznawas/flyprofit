// SLA Salary Portal — Service Worker v172
const CACHE = 'sla-salary-v196';

// Inbox for PDFs handed over by the Android share sheet. Deliberately a
// SEPARATE cache from CACHE: the activate handler below wipes old asset
// caches on every version bump, and a roster shared moments before an
// update must not be swept away with them.
const SHARE_CACHE = 'sla-share-inbox';
const SHARE_PATH = 'share-target';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './stations.json',
  './pdf.worker.min.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ---- Android share sheet: "Share → FlyProfit" arrives here as a POST ----
  // Handled entirely inside the service worker, which is what makes this work
  // on a static host — GitHub Pages could never accept this POST itself. It
  // also means the app being closed, backgrounded or already open makes no
  // difference: the SW answers, stashes the file, and redirects to the app.
  if (e.request.method === 'POST' && url.pathname.endsWith('/' + SHARE_PATH)) {
    const home = new URL('./', self.registration.scope);
    e.respondWith((async () => {
      const back = q => Response.redirect(home.href + q, 303);
      try {
        const form = await e.request.formData();
        const file = form.get('roster');
        if (!file || typeof file === 'string' || !file.size) return back('?shareerr=nofile');
        if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
          return back('?shareerr=notpdf');
        }

        // One id per share event. The page consumes the entry exactly once and
        // deletes it, which is what prevents a reloaded or restored URL from
        // importing the same roster twice.
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        const cache = await caches.open(SHARE_CACHE);
        await cache.put(
          new Request(home.href + SHARE_PATH + '/' + id),
          new Response(file, {
            headers: {
              'Content-Type': 'application/pdf',
              'X-Share-Filename': encodeURIComponent(file.name || 'roster.pdf')
            }
          })
        );
        return back('?shared=' + id);
      } catch (err) {
        return back('?shareerr=failed');
      }
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  // Only the app's own files (index.html, icons, pdf.worker.min.js, etc.)
  // go through the cache-first path below. Anything to a different origin —
  // script.google.com, i.e. trial checks, license checks, and upload/usage
  // logging — is left completely alone here (no respondWith) so it always
  // hits the network fresh, exactly as before this change. Locking,
  // licensing and monitoring all depend on that staying true.
  if (url.origin !== self.location.origin) return;

  // Don't cache the one-shot share hand-off URLs — they're unique per share
  // and would otherwise pile up in the asset cache forever.
  const isShareNav = url.searchParams.has('shared') || url.searchParams.has('shareerr');

  // Cache-first, falling back to network. Previously this always tried the
  // network FIRST and only fell back to the cache once that attempt failed
  // — fine on a good connection, but on a weak/no signal the network
  // attempt can take several seconds to give up before the cached copy
  // ever gets used, and that delay stacks up across every file the app
  // loads. Serving the cached copy immediately (when there is one) fixes
  // that; a network fetch still runs alongside to refresh the cache for
  // next time, kept alive via waitUntil so it completes even though the
  // response itself already went out.
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    const networkFetch = fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res && res.status === 200 && !isShareNav) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => null);

    if (cached) {
      e.waitUntil(networkFetch);
      return cached;
    }

    const netRes = await networkFetch;
    if (netRes) return netRes;

    // Nothing cached and the network failed too.
    // A navigation carrying a query string — notably the share hand-off
    // ./?shared=<id> — has no exact cache entry, so fall back to the app
    // shell. Without this, sharing a roster while offline dead-ends on
    // the 503 below instead of opening the app.
    if (e.request.mode === 'navigate') {
      return caches.match('./index.html')
        .then(shell => shell || caches.match('./'))
        .then(shell => shell || new Response('Offline', { status: 503 }));
    }
    return new Response('Offline', { status: 503 });
  })());
});
