// ── Service Worker — Mon Coach Garmin Dashboard
const CACHE = 'garmin-v7';

// Seuls les assets vraiment stables sont mis en cache (externes, icônes)
const STATIC_CACHE = [
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Supprimer TOUS les anciens caches (y compris garmin-v6 et versions précédentes)
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

  // Page HTML → toujours réseau (pour que le template Flask soit toujours frais)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/static/manifest.json'))
    );
    return;
  }

  // JS et CSS → réseau d'abord (ils ont un ?v=hash en URL → cache-busting natif)
  if (url.pathname.startsWith('/static/js/') || url.pathname.startsWith('/static/css/') ||
      url.pathname === '/static/style.css') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Autres static (icônes, Chart.js) → cache d'abord
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
