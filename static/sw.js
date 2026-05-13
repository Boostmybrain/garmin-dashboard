// ── Service Worker — Mon Coach Garmin Dashboard
const CACHE = 'garmin-v2';
const STATIC = [
  '/',
  '/static/style.css',
  '/static/app.js',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap',
];

// ── INSTALL : mise en cache des ressources statiques
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE : nettoyer les anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH : stratégie intelligente par type de requête
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API → réseau uniquement (pas de cache)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/static/meals/')) {
    return;
  }

  // Ressources statiques → cache d'abord, réseau en fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && (url.pathname.startsWith('/static/') || url.origin !== location.origin)) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline : retourner la page principale depuis le cache
        if (e.request.mode === 'navigate') return caches.match('/');
      });
    })
  );
});
