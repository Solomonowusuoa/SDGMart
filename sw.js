// SDGMart Service Worker
// - Caches static assets (cache-first); JS/JSX/CSS/HTML use network-first so
//   updates during development are picked up on reload.
// - Listens for `push` events and shows native OS notifications.
// - On notification click, focuses an existing tab or opens the target URL.
const CACHE_NAME = 'sdgmart-v28-tamale-humor';
const STATIC_ASSETS = [
  '/SDGMart.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isCode = /\.(jsx|js|css|html)$/.test(url.pathname) || url.pathname === '/' || url.pathname === '/SDGMart.html';
  if (url.pathname.startsWith('/api/') || url.pathname === '/data/products.js' || isCode) {
    event.respondWith(
      fetch(request)
        .then(res => { try { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); } catch (_) {} return res; })
        .catch(() => caches.match(request))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(res => {
      if (!res || res.status !== 200 || res.type === 'opaque') return res;
      try { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, clone)); } catch (_) {}
      return res;
    }))
  );
});

// ── Web Push ──────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: 'SDGMart', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'SDGMart';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'sdgmart',
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If a SDGMart tab is already open, focus it and send a message to navigate
    for (const c of allClients) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          c.focus();
          c.postMessage({ type: 'sdgmart-navigate', url: targetUrl });
          return;
        }
      } catch (_) {}
    }
    // Otherwise open a new window
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
