const CACHE = 'vocab-v65';
const FILES = ['./', './index.html', './manifest.json', './icon-180-v2.png', './icon-512-v2.png', './icon-mask-512-v2.png', './favicon-32-v2.png', './favicon-192-v2.png',
  './wixd-lat.woff2', './wixd-cyr.woff2', './wixt-lat.woff2', './wixt-cyr.woff2'];
const EXTERNAL = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES).then(() => Promise.all(EXTERNAL.map(u => c.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // the sign-in / sync library: network first, cached copy when offline
  if (new URL(req.url).origin !== location.origin) {
    if (EXTERNAL.some(u => req.url.startsWith(u))) {
      e.respondWith(
        fetch(req)
          .then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
            return res;
          })
          .catch(() => caches.match(req))
      );
    }
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
