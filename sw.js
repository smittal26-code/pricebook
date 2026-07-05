const CACHE = 'jpb-v4'; // bump this number any time you want to force a clean cache reset
const BASE = '/pricebook/';
const ASSETS = [
  BASE,
  BASE + 'index.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
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

// Network-first: always try to fetch the latest version first. Only serve the
// cached copy if the network request fails (i.e. actually offline). This is
// the key fix - the old cache-first version served a stale index.html forever
// once it was cached once, and never checked the network again.
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match(BASE + 'index.html')))
  );
});
