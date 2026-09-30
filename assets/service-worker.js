const CACHE_NAME = 'stepfield-shell-v3';
const SHELL = [
  './',
  './index.html',
  './main.js',
  './styles.css',
  './manifest.webmanifest',
  './favicon.ico',
  './icons/stepfield-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('stepfield-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// Network first, so a new deploy is picked up on the next load; the cache is the offline fallback.
// Build output is not content-hashed, so cache-first would pin visitors to an old main.js.
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
  } else if (['script', 'style', 'image', 'manifest'].includes(request.destination)) {
    event.respondWith(networkFirst(request, request));
  }
});

function networkFirst(request, cacheKey) {
  return fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
    }
    return response;
  }).catch(() => caches.match(cacheKey));
}
