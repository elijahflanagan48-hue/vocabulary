const CACHE = 'vocab-v112';
const FILES = ['./', './index.html', './manifest.json', './icon-180-v3.png', './icon-512-v3.png', './icon-mask-512-v3.png', './favicon-32-v3.png', './favicon-192-v3.png',
  './wixd-lat.woff2', './wixd-cyr.woff2', './wixt-lat.woff2', './wixt-cyr.woff2'];
const OCR_CACHE = 'noeon-ocr-v1';
const EXTERNAL = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];
/* how long the app waits for the network before opening the saved copy */
const WAIT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      /* cache:'reload' — take the files from the server, not from the browser's short-term cache, so a new version is really new */
      .then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))
        .then(() => Promise.all(EXTERNAL.map(u => caches.match(u).then(hit => hit ? c.put(u, hit) : c.add(u)).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* fresh from the network and saved for later */
function fetchAndKeep(req) {
  return fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* other sites (the cloud database, translation, dictionaries) go straight to the network, untouched.
     Only the sign-in / sync library is kept: its address carries an exact version, so a saved copy is always the same file. */
  if (url.origin !== location.origin) {
    if (EXTERNAL.some(u => req.url.startsWith(u))) {
      e.respondWith(
        caches.match(req).then(hit => hit || fetchAndKeep(req))
      );
    }
    return;
  }

  // the offline text recogniser is large and never changes: keep it once, across releases
  if (/\/lib\/ocr\//.test(req.url)) {
    e.respondWith(
      caches.open(OCR_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  /* fonts, icons and the PDF libraries do not change between versions: open the saved copy at once,
     refresh it in the background */
  if (/\/lib\//.test(url.pathname)) {          /* large; a new release brings a fresh copy anyway (new cache) */
    e.respondWith(caches.match(req).then(hit => hit || fetchAndKeep(req)));
    return;
  }
  /* word-formation texts: a file's address carries its version (?v=...), so a saved copy is always the right one */
  if (/\/wf\/[a-z0-9]+-\d+\.json$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetchAndKeep(req)));
    return;
  }
  if (/\.(woff2|png|svg|ico)$/.test(url.pathname)) {
    const fresh = fetchAndKeep(req);
    e.waitUntil(fresh.then(() => {}, () => {}));
    e.respondWith(caches.match(req).then(hit => hit || fresh));
    return;
  }

  /* the app itself: network first, as before. If the network has not answered within WAIT_MS and a saved copy exists,
     open the saved copy; the network answer still arrives in the background and is saved for the next start. */
  const net = fetchAndKeep(req);
  e.waitUntil(net.then(() => {}, () => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const give = r => { if (!done && r) { done = true; resolve(r); } };
    const fallback = () => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : null));
    const timer = setTimeout(() => fallback().then(give), WAIT_MS);
    net.then(res => {
      clearTimeout(timer);
      /* the server is having trouble (5xx): a saved copy is better than an error page */
      if (res.status >= 500) fallback().then(r => give(r || res));
      else give(res);
    },
      () => { clearTimeout(timer); fallback().then(r => { if (r) give(r); else if (!done) { done = true; resolve(Response.error()); } }); });
  }));
});

/* ---- reminders: a push arrives, a tap on it opens the right screen ---- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'NOEON Words', {
    body: d.body || '',
    icon: './icon-180-v3.png',
    badge: './favicon-192-v3.png',
    tag: d.tag || 'noeon',
    data: { go: d.go || 'td' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const go = (e.notification.data && e.notification.data.go) || 'td';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => x.url.indexOf(self.registration.scope) === 0);
    if (c) { c.postMessage({ type: 'noeon-go', go }); return c.focus(); }
    return self.clients.openWindow(self.registration.scope + 'index.html?go=' + encodeURIComponent(go));
  }));
});
