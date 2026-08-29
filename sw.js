// SDGMart Service Worker
// - Caches static assets (cache-first); JS/JSX/CSS/HTML use network-first so
//   updates during development are picked up on reload.
// - Listens for `push` events and shows native OS notifications.
// - On notification click, focuses an existing tab or opens the target URL.
const CACHE_NAME = 'sdgmart-v93-audit-mediums';
const STATIC_ASSETS = [
  '/SDGMart.html',
  '/manifest.json',
  '/icons/icon-192.png?v=69',
  '/icons/icon-512.png?v=69',
  '/icons/apple-touch-icon.png?v=69',
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

  // API responses are NEVER cached. CacheStorage is per-origin, not per-user,
  // and signing out only cleared sessionStorage — so on a shared phone (routine
  // in this market) user A's order history, addresses and phone number could be
  // replayed to user B the next time the network dropped. Because these users
  // are frequently offline, that replay branch was the common path, not a rare
  // one. Network-only: a failed API call must surface as a failure the app can
  // report, not as someone else's stale data presented as current.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Public, non-personal payloads stay network-first with a cache fallback.
  if (url.pathname === '/data/products.js' || isCode) {
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

// Sign-out cache wipe. The page posts { type: 'sdg-clear-cache' } when a user
// signs out, so nothing from their session can outlive the handover.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdg-clear-cache') return;
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
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
