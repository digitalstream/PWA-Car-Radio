const CACHE_NAME = 'car-radio-v5.1'; // map rotating marker correct.

const FILES_TO_CACHE = [
  './',
  'index.html',
  'car-style.css',
  'car-app.js',
  'manifest.json',
  'images/posterradio-blue-round.png',
  'images/stop-button-2.png',
  'images/car-icon.png',
  'images/bg-shinny.jpg'
  // Note: We don't cache channel logos manually here. 
  // We let the dynamic cache handle them as they are loaded.
];

// --- INSTALL: Cache Core Assets ---
self.addEventListener('install', evt => {
  console.log('[SW] Installing...');
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// --- ACTIVATE: Clean Old Caches ---
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

// --- FETCH: The Logic ---
self.addEventListener('fetch', evt => {
    
    // 1. IGNORE STREAMS (Never cache audio or API calls)
    if (
        evt.request.url.includes('.m3u8') ||
        evt.request.url.includes('.aac') ||
        evt.request.url.includes('/api/radio/stream/') ||
        evt.request.url.includes('s-recursive-proxy.ashx')
    ) {
        return; // Bypass SW, go direct to network
    }

    // 2. NETWORK FIRST (For API Channel List & Metadata)
    // We want fresh song info and channel updates.
    if (
        evt.request.url.includes('/api/radio') || 
        evt.request.url.includes('nominatim') // GPS Address
    ) {
        evt.respondWith(
            fetch(evt.request).catch(() => caches.match(evt.request))
        );
        return;
    }

    // 3. CACHE FIRST (For Images, CSS, JS)
    // This handles all your Channel Logos automatically!
    evt.respondWith(
        caches.match(evt.request).then(cacheRes => {
            return cacheRes || fetch(evt.request).then(networkRes => {
                // If we fetched a new image, save it for next time
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(evt.request, networkRes.clone());
                    return networkRes;
                });
            });
        })
    );
});