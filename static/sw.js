// ── Service Worker — Mon Coach Garmin Dashboard
const CACHE = 'garmin-v5';

// Seuls les assets vraiment stables sont mis en cache
const STATIC_CACHE = [
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// Ces fichiers changent souvent → toujours réseau, jamais cache
const NO_CACHE = ['/static/app.js', '/static/style.css', '/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC_CACHE))
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
  const url = new URL(e.request.url);

  // API & repas → réseau uniquement
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/static/meals/')) {
    return;
  }

  // app.js, style.css, page HTML → toujours réseau (pas de cache)
  if (NO_CACHE.includes(url.pathname) || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/static/manifest.json'))
    );
    return;
  }

  // Autres static (icônes, Chart.js, fonts) → cache d'abord
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          caches.open(CACHE).then(c => c.put(e.request, response.clone()));
        }
        return response;
      });
    })
  );
});
