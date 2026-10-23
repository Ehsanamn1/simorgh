const CACHE_NAME = 'medar-shell-v7';
const PRECACHE_ASSETS = []; // Replaced by the Vite build plugin with the core home-route dependency graph.
const scopeURL = new URL(self.registration.scope);
// Notification routes are emitted as app-relative paths by the Worker. Resolve
// them against this installation's scope so /madar/ hosting stays in-scope.
const normalizeAppHref = raw => {
  const fallback = new URL('app/home', scopeURL);
  if (typeof raw !== 'string' || !raw.startsWith('/app/') || raw.startsWith('//')) {
    return fallback.pathname + fallback.search + fallback.hash;
  }
  const target = new URL(raw.slice(1), scopeURL);
  if (target.origin !== self.location.origin || !target.pathname.startsWith(scopeURL.pathname)) {
    return fallback.pathname + fallback.search + fallback.hash;
  }
  return target.pathname + target.search + target.hash;
};
const isLocal = url => url.origin === self.location.origin && url.href.startsWith(scopeURL.href);
const isSensitiveAPI = url => ['/auth/v1/', '/rest/v1/', '/storage/v1/'].some(part => url.pathname.includes(part));
const assetExtensions = ['.js', '.css', '.svg', '.webmanifest', '.woff', '.woff2', '.png', '.jpg', '.jpeg', '.webp'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.add(new Request(scopeURL.href, { cache: 'reload' }));
      // Cache the home-route chunks while online so an already-opened app can
      // navigate back to its operational home screen without a network request.
      await Promise.allSettled(PRECACHE_ASSETS.map(asset => {
        const url = new URL(asset, scopeURL);
        if (url.origin !== self.location.origin || !url.href.startsWith(scopeURL.href)) return Promise.resolve();
        return cache.add(new Request(url.href, { cache: 'reload' }));
      }));
    }).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => (key.startsWith('simorgh-shell-') || key.startsWith('medar-shell-')) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isLocal(url) || isSensitiveAPI(url)) return;

  if (request.mode === 'navigate') {
    const navigationURL = new URL(request.url);
    // Query strings may contain transient search/filter state; cache the path, not user-entered query data.
    navigationURL.search = '';
    navigationURL.hash = '';
    const navigationKey = new Request(navigationURL.href, { method: 'GET' });
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' })).then(response => {
        if (response.ok && response.type === 'basic') {
          void caches.open(CACHE_NAME).then(cache => Promise.all([
            cache.put(scopeURL.href, response.clone()),
            cache.put(navigationKey, response.clone())
          ]));
        }
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(navigationKey)) || (await cache.match(scopeURL.href)) || Response.error();
      })
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


self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.slice(0, 180) : 'اعلان جدید مدار';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 500) : '';
  const rawHref = typeof payload.href === 'string' ? payload.href : '';
  const href = normalizeAppHref(rawHref);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    data: { href },
    tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 180) : undefined,
    renotify: false,
    badge: new URL('favicon.svg', scopeURL).pathname
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.href;
  const href = normalizeAppHref(raw);
  const target = new URL(href, self.location.origin);
  if (target.origin !== self.location.origin || !target.pathname.startsWith(scopeURL.pathname)) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if ('focus' in client && new URL(client.url).origin === target.origin) {
        if ('navigate' in client) await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  }));
});
