/* global self, URL */
/* Medar Web Push service worker. Push is shown only for explicitly subscribed devices. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0,120) : 'مدار';
  const body = typeof data.body === 'string' ? data.body.slice(0,500) : '';
  const href = typeof data.href === 'string' && data.href.startsWith('/app/') ? data.href : '/app/home';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: './medar-icon.svg',
    badge: './medar-icon.svg',
    tag: typeof data.tag === 'string' ? data.tag.slice(0,120) : undefined,
    data: { href },
    dir: 'rtl',
    lang: 'fa',
    renotify: false,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const href = event.notification.data && typeof event.notification.data.href === 'string' && event.notification.data.href.startsWith('/app/')
    ? event.notification.data.href : '/app/home';
  event.waitUntil((async () => {
    const target = new URL(href.replace(/^\//,''), self.registration.scope).toString();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
