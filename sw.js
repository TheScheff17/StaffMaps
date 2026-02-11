const CACHE_NAME = 'tacmap-v1';
const CACHE_VERSION = 1;

// Core app files - always cache these
const CORE_ASSETS = [
  './',
  './tacmap-v8.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// Tile cache - separate, size-limited
const TILE_CACHE = 'tacmap-tiles-v1';
const MAX_TILE_CACHE = 2000; // max cached tiles

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Tile requests - cache-first with network fallback
  if (isTileRequest(url)) {
    event.respondWith(tileCacheFirst(event.request));
    return;
  }

  // PeerJS / WebRTC signaling - always network
  if (url.hostname.includes('peerjs') || url.pathname.includes('peer')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Core app files - cache-first, update in background
  event.respondWith(staleWhileRevalidate(event.request));
});

// Detect tile server requests
function isTileRequest(url) {
  const tileHosts = [
    'tile.openstreetmap.org',
    'tiles.stadiamaps.com',
    'server.arcgisonline.com',
    'basemap.nationalmap.gov',
    'mt0.google.com', 'mt1.google.com', 'mt2.google.com', 'mt3.google.com',
    'tile.opentopomap.org',
    'stamen-tiles.a.ssl.fastly.net'
  ];
  return tileHosts.some(h => url.hostname.includes(h)) ||
         url.pathname.match(/\/\d+\/\d+\/\d+/); // z/x/y pattern
}

// Cache-first for tiles
async function tileCacheFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone and cache
      cache.put(request, response.clone());
      // Prune if too many
      trimTileCache(cache);
    }
    return response;
  } catch (e) {
    // Offline and not cached - return transparent tile
    return new Response('', { status: 404, statusText: 'Offline' });
  }
}

// Stale-while-revalidate for app files
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('TacMap is offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Keep tile cache under limit (LRU-ish: delete oldest)
async function trimTileCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILE_CACHE) {
    const toDelete = keys.length - MAX_TILE_CACHE + 100; // delete 100 extra for headroom
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// Listen for messages from main app
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearTileCache') {
    caches.delete(TILE_CACHE);
  }
});
