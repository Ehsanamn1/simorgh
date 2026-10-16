const CACHE_NAME = 'simorgh-shell-v7';
const scopeURL = new URL(self.registration.scope);
const isLocal = url => url.origin === self.location.origin && url.href.startsWith(scopeURL.href);
const isSensitiveAPI = url => ['/auth/v1/', '/rest/v1/', '/storage/v1/'].some(part => url.pathname.includes(part));
const assetExtensions = ['.js', '.css', '.svg', '.webmanifest', '.woff', '.woff2', '.png', '.jpg', '.jpeg', '.webp'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(new Request(scopeURL.href, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('simorgh-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isLocal(url) || isSensitiveAPI(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' })).then(response => {
        if (response.ok) void caches.open(CACHE_NAME).then(cache => cache.put(scopeURL.href, response.clone()));
        return response;
      }).catch(async () => (await caches.match(scopeURL.href)) || Response.error())
    );
    return;
  }
  if (!assetExtensions.some(extension => url.pathname.endsWith(extension))) return;
  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok && response.type === 'basic') void caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    });
  }));
});
