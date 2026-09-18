/* Irene's Puzzle Box - service worker (offline + installable)
   IMPORTANT: bump CACHE (v3 -> v4 ...) whenever any cached file changes;
   the new content is picked up on the next visit. */
const CACHE = 'ire-pbox-v4';
const FILES = [
  './',
  'index.html',
  'css/common.css',
  'js/common.js',
  'games/starbattle/star.html',
  'games/starbattle/star.css',
  'games/starbattle/star.js',
  'games/starbattle/bank.js',
  'games/sudoku/sudoku.html',
  'games/sudoku/sudoku.css',
  'games/sudoku/sudoku.js',
  'assets/app-icon.png',
  'assets/irene.png',
  'assets/handrix.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // Navigations (HTML pages): NETWORK-FIRST, so opening the site always shows the
  // fresh lobby; cache is only used when offline. Static assets stay cache-first.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
