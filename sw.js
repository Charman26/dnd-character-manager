// App shell only (rules data lives in IndexedDB). Network-first so updates arrive when online; cache when offline.
const CACHE = 'dndcm-shell-v30', ART = 'dndcm-art';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'rules.js', 'data.js', 'db.js', 'effects.js', 'manifest.webmanifest', 'icon.svg', 'icons.svg',
  ...['bookinsanity', 'bookinsanity-bold', 'bookinsanity-italic', 'bookinsanity-bold-italic', 'mr-eaves-small-caps', 'nodesto-caps-condensed', 'scaly-sans', 'scaly-sans-bold', 'scaly-sans-caps'].map(f => `fonts/${f}.woff2`)];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== ART).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'GET' && u.hostname === 'raw.githubusercontent.com' && /-img\/main\//.test(u.pathname)) {
    // class art: cache-first, it never changes
    return e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(ART).then(c => c.put(e.request, copy)); }
      return r;
    })));
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // no-cache: revalidate with the server so a deploy is picked up immediately instead of after the HTTP cache expires
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
