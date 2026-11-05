/* Service worker: keeps the game's files cached so it can be installed and
 * played offline. Only registered on https (or localhost). Bump VERSION when
 * the file list changes; game files are fetched fresh when online and fall
 * back to the cache offline. */
const VERSION = 'dicedelve-v1';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/rng.js', './js/rules.js', './js/levelgen.js', './js/game.js', './js/render.js', './js/audio.js', './js/ui.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates arrive), cache as the offline fallback. The
// Google font is cached as it is fetched.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
