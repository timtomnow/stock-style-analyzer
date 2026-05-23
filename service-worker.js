// Service worker — makes the app installable as a PWA and lets it boot offline
// from cache. Strategy: network-first with cache fallback so users see the
// latest code when online, but the shell still loads without a connection.
//
// Bump CACHE_VERSION whenever you want clients to evict their old cache.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `stock-style-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './scoring.js',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache live quote data — always go to the network.
  if (url.pathname.startsWith('/api/quote/') || url.pathname.includes('/api/quote/')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Only cache successful same-origin responses.
      if (fresh.ok && url.origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Fall back to the index for navigations so deep links still boot offline.
      if (req.mode === 'navigate') {
        const indexCached = await caches.match('./index.html');
        if (indexCached) return indexCached;
      }
      throw new Error('offline and no cache match');
    }
  })());
});
