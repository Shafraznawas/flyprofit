// SLA Salary Portal — Service Worker v47
const CACHE = 'sla-salary-v70';

const ASSETS = [
  '/SL-salary-app/',
  '/SL-salary-app/index.html',
  '/SL-salary-app/manifest.json',
  '/SL-salary-app/icon-192.png',
  '/SL-salary-app/icon-512.png',
  '/SL-salary-app/stations.json',
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
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => {
        return caches.match(e.request)
          .then(cached => cached || new Response('Offline', { status: 503 }));
      })
  );
});
