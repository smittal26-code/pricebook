const CACHE = 'jpb-v5'; // bumped for share-target support
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

// ===== Web Share Target =====
// Android/Chrome POSTs the shared files here (multipart/form-data, field
// name "media", per manifest.json's share_target block). A service worker
// fetch handler is the only place that can intercept this POST - there's no
// server behind this static site to receive it. We stash the raw file blobs
// in IndexedDB (shared with the main app via the same DB name/store) and
// then redirect the browser to the app with a ?share=1 flag so index.html
// knows to open the "attach shared media" screen and pick them up.
const SHARE_DB = 'pbshare';
const SHARE_STORE = 'shares';

function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) {
        req.result.createObjectStore(SHARE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeSharedFiles(files) {
  const db = await openShareDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(SHARE_STORE);
    files.forEach((file, i) => {
      store.put({
        id: Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2),
        blob: file,
        name: file.name || '',
        type: file.type || '',
        ts: Date.now()
      });
    });
  });
}

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const files = formData.getAll('media').filter(f => f && f.size > 0);
    if (files.length) await storeSharedFiles(files);
  } catch (err) {
    console.log('share-target handling failed:', err);
  }
  // 303 turns the browser's follow-up navigation into a GET, which is
  // required after responding to a POST like this.
  return Response.redirect(BASE + '?share=1', 303);
}

// Network-first: always try to fetch the latest version first. Only serve the
// cached copy if the network request fails (i.e. actually offline). This is
// the key fix - the old cache-first version served a stale index.html forever
// once it was cached once, and never checked the network again.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.method === 'POST' && url.pathname === BASE + 'share-target/') {
    e.respondWith(handleShareTarget(e));
    return;
  }

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
