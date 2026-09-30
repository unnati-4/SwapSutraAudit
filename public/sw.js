/*
 * SwapSutra service worker — notifications only (30 Sep 2026).
 *
 * SwapSutra is no longer a PWA: no install, no manifest, no offline
 * cache. This file stays for one reason: browsers deliver web-push
 * notifications (swap requests, chats, badges, the daily book updates)
 * only through a service worker. So it does exactly two things:
 *
 *   1. Clears everything the old app-shell worker cached (swapsutra-cache-v1…v7)
 *      and takes over at once, so returning visitors are never stuck on an
 *      old copy of the site.
 *   2. Shows push notifications and opens the right page when one is tapped.
 *
 * There is deliberately NO 'fetch' handler: every page, script and image
 * comes straight from the network, like any normal website.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key).catch(() => false))))
      .catch(() => null)
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  let data = {
    title: 'SwapSutra',
    message: 'You have a new update on SwapSutra.',
    targetUrl: '/',
    tag: 'swapsutra-notification'
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.message = event.data.text() || data.message;
    }
  }

  const options = {
    body: data.message || 'New activity on SwapSutra',
    icon: '/swapsutra-logo.png',
    image: data.image || undefined,
    tag: data.tag || 'swapsutra-notification',
    // Every tag is one event (daily pushes carry the date), so a repeat of
    // the same tag is the same event arriving twice (server push + the open
    // site) — replace it without ringing again.
    renotify: false,
    data: {
      targetUrl: data.targetUrl || '/',
      entityId: data.entityId || null,
      type: data.type || 'general'
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    vibrate: [100, 50, 100]
  };

  event.waitUntil(self.registration.showNotification(data.title || 'SwapSutra', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const notificationData = event.notification.data || {};
  const targetUrl = notificationData.targetUrl || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('postMessage' in client) {
            client.postMessage({
              type: 'SWAPSUTRA_NOTIFICATION_NAVIGATE',
              targetUrl,
              notificationData
            });
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
