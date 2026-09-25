// Service worker: l'app funziona anche offline (es. in palestra senza campo).
// File dell'app: prima la rete (così gli aggiornamenti arrivano subito), poi la cache.
// Librerie esterne (Tailwind, icone, font): prima la cache, aggiornata in background.
const CACHE = 'workout-v2.6.3';
const APP_SHELL = [
  './',
  './index.html',
  './js/app.js',
  './js/foods.js',
  './js/share.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' = scarica i file freschi dal server, non dalla cache HTTP del browser
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // 'no-cache': chiede sempre al server se il file è cambiato (GitHub Pages altrimenti
    // lascia usare la copia in cache per 10 minuti e gli aggiornamenti arrivano in ritardo)
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
