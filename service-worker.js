const CACHE_NAME = 'car-radio-v6.15';
const MAX_RUNTIME_IMAGES = 100;
const FILES_TO_CACHE = [
    './',
    'index.html',
    'config.js',
    'car-style.css',
    'map-style.css',
    'car-app.js',
    'map-app.js',
    'manifest.json',
    'radio-icon-192.png',
    'radio-icon-512.png',
    'images/poster4.png',
    'images/stop-button-2.png',
    'images/car-icon.png',
    'images/bg-shinny.jpg',
];
const CORE_URLS = new Set(FILES_TO_CACHE.map((file) => new URL(file, self.registration.scope).href));
const IMAGE_PATH = new URL('images/', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(FILES_TO_CACHE);
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((key) => key.startsWith('car-radio-') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    // Streams, maps, APIs and local settings use normal HTTP caching, not permanent app storage.
    if (url.origin !== self.location.origin || url.pathname.endsWith('/config.local.js')) return;
    const isImage = request.destination === 'image' && url.pathname.startsWith(IMAGE_PATH);
    if (!CORE_URLS.has(url.href) && !isImage) return;
    event.respondWith(cacheAsset(request, isImage));
});

async function cacheAsset(request, isImage) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
        try {
            await cache.put(request, response.clone());
            if (isImage) await trimImages(cache);
        } catch {
            // A full cache must not prevent a successful network response.
        }
    }
    return response;
}

async function trimImages(cache) {
    const keys = await cache.keys();
    const runtime = keys.filter(
        (request) => !CORE_URLS.has(request.url) && new URL(request.url).pathname.startsWith(IMAGE_PATH),
    );
    await Promise.all(
        runtime
            .slice(0, Math.max(0, runtime.length - MAX_RUNTIME_IMAGES))
            .map((request) => cache.delete(request)),
    );
}
