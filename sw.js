// SDGMart Service Worker — cache-first for static assets, network-first for API
const CACHE_NAME = 'sdgmart-v14-tracking-ui';
const STATIC_ASSETS = [
  '/SDGMart.html',
  '/tweaks-panel.jsx',
  '/App.jsx',
  '/hooks.js',
  '/responsive.css',
  '/components/Header.jsx',
  '/components/HomePage.jsx',
  '/components/CategoryPage.jsx',
  '/components/ProductPage.jsx',
  '/components/CartDrawer.jsx',
  '/components/CheckoutPage.jsx',
  '/components/SquadPage.jsx',
  '/components/AdminPage.jsx',
  '/components/LoginPage.jsx',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for API, dynamic data, and any source code (JSX/JS/CSS/HTML)
  // so that updates during development are picked up on reload.
  const isCode = /\.(jsx|js|css|html)$/.test(url.pathname) || url.pathname === '/' || url.pathname === '/SDGMart.html';
  if (url.pathname.startsWith('/api/') || url.pathname === '/data/products.js' || isCode) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else (static files, fonts, CDN scripts)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      });
    })
  );
});
