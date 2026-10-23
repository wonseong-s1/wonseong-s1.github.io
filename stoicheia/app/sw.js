// Offline-first: cache the whole app on install, serve from cache, refresh in the background.
const CACHE = 'stoicheia-v3';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'corpus.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'fonts/gentium-400-greek.woff2', 'fonts/gentium-400-greekext.woff2', 'fonts/gentium-400-latin.woff2',
  'fonts/notosans-400-greek.woff2', 'fonts/notosans-400-latin.woff2', 'fonts/notosans-700-greek.woff2', 'fonts/notosans-700-latin.woff2',
  'fonts/gentium-700-greek.woff2', 'fonts/gentium-700-greekext.woff2', 'fonts/gentium-700-latin.woff2',
  ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'].map((b) => `books/${b}.js`),
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
