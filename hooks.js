// ── Client error reporting (audit F-05) ─────────────────────────────────
// Thirty-one catches in the client swallowed their error entirely, four of
// them on the checkout screen where the result changes what the customer is
// offered. Where a failure genuinely is recoverable and the UI degrades
// honestly, it still belongs in the error log rather than nowhere.
//
// Declared here because the bundle is a plain concatenation into one scope
// (see buildAppBundle), so this hoists for every component file.
//
// Deliberately fire-and-forget and never throws: a reporting failure must not
// become a second error on top of the first.
function reportClientError(what, err) {
  try {
    console.warn(what, err);
    const message = String(what) + ': ' + String((err && err.message) || err || 'unknown');
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.slice(0, 500),
        stack: String((err && err.stack) || '').slice(0, 2000),
        path: (typeof location !== 'undefined' && location.pathname) || '',
      }),
    }).catch(() => {});
  } catch (_) { /* reporting must never throw */ }
}

// Global hooks — loaded before any component, available on window

// Human-friendly order code derived from the real DB order id, e.g. SDG-00017.
// Used on receipts, My Orders, admin, and tracking so the same code is shown
// everywhere and always maps back to a real order.
function orderCode(id) {
  if (id == null || id === '') return '—';
  const s = String(id);
  // If it's already an SDG- code, keep it; otherwise pad the numeric id.
  if (/^SDG-/i.test(s)) return s;
  return 'SDG-' + s.replace(/\D/g, '').padStart(5, '0');
}
if (typeof window !== 'undefined') window.orderCode = orderCode;

function useMobile(breakpoint) {
  breakpoint = breakpoint || 768;
  const [mobile, setMobile] = React.useState(
    typeof window !== 'undefined' && window.innerWidth <= breakpoint
  );
  React.useEffect(() => {
    const check = () => setMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return mobile;
}

// Auth-aware fetch wrapper. Reads the session token from sessionStorage
// (App.jsx writes it there alongside the user object) and adds it as a
// Bearer header on every request. Use this everywhere instead of bare fetch
// when calling /api/* endpoints that require authentication.
function apiFetch(url, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  try {
    const raw = sessionStorage.getItem('sdgmart_user');
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.token) headers.set('Authorization', 'Bearer ' + obj.token);
    }
  } catch (_) {}
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, Object.assign({}, opts, { headers }));
}

// ── Web Push subscription helpers ──────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Subscribe this device to Web Push. Idempotent — safe to call multiple
// times. Returns true on success. Requires SW registration and a user
// gesture (the first call will trigger the Notification permission prompt).
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return false;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) return false;
    const { publicKey } = await keyRes.json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const r = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return r.ok;
  } catch (e) {
    console.warn('Push subscribe failed:', e);
    return false;
  }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiFetch('/api/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch (_) {}
}

// Connectivity. The app is installable, ships a service worker, and targets
// customers on intermittent mobile data — but nothing ever checked whether the
// device was actually online (F-03). Reads fell back silently to whatever was
// cached, so the app looked current while showing data of unknown age, and
// writes failed into empty catches.
function useOnline() {
  const [online, setOnline] = React.useState(
    () => (typeof navigator === 'undefined' || navigator.onLine === undefined ? true : navigator.onLine),
  );
  React.useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

Object.assign(window, { useMobile, useOnline, apiFetch, subscribeToPush, unsubscribeFromPush });

// ── Guest order list (localStorage: sdgmart_guest_orders) ────────────────
// The Track Your Order screen lists the orders this device knows about. It was
// written once and never refreshed, and the three places that wrote it did not
// agree on the fields:
//
//   checkout        → { id, code, token, total, at }
//   track-by-code   → { id, code, token, at }          ← no total
//   shared link     → { id, code, token, at }          ← no total
//
// so an order first seen by code or by a shared link listed as "GHS 0.00", and
// `at` was the moment this device happened to save it rather than when the
// order was placed — which is why the list and the tracking screen disagreed on
// both the time and the amount for the same order.
//
// These keep one shape (placedAt + total, from the server where we have it),
// and refresh() re-reads each order so entries already saved the old way heal
// themselves instead of staying wrong forever.
const GUEST_ORDERS_KEY = 'sdgmart_guest_orders';
const GUEST_ORDERS_MAX = 10;

function readGuestOrders() {
  try {
    const list = JSON.parse(localStorage.getItem(GUEST_ORDERS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}

function writeGuestOrders(list) {
  try { localStorage.setItem(GUEST_ORDERS_KEY, JSON.stringify(list.slice(0, GUEST_ORDERS_MAX))); }
  catch (_) { /* private mode / quota — the list is a convenience, not the record */ }
}

// Upsert one order. `fields` may carry total/placedAt/status; anything absent
// keeps whatever was stored before rather than blanking it.
function rememberGuestOrder(id, token, fields) {
  const list = readGuestOrders();
  const i = list.findIndex(o => String(o.id) === String(id));
  const prev = i >= 0 ? list[i] : {};
  const merged = {
    ...prev,
    id: Number(id),
    code: window.orderCode(id),
    token: token || prev.token || '',
    at: prev.at || new Date().toISOString(),   // when THIS device saved it
    ...Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v != null)),
  };
  if (i >= 0) list.splice(i, 1);
  list.unshift(merged);
  writeGuestOrders(list);
  return merged;
}

// Pull the current total/placed time/status for every remembered order.
// Silent on failure: an offline device keeps showing what it already had.
async function refreshGuestOrders() {
  const list = readGuestOrders();
  if (!list.length) return list;
  await Promise.all(list.map(async (o) => {
    if (!o || !o.token) return;
    try {
      const r = await fetch(`/api/orders/${o.id}/tracking?t=${encodeURIComponent(o.token)}`);
      if (!r.ok) return;                       // 401/404/410 — leave the entry alone
      const t = await r.json();
      const ord = t && t.order;
      if (!ord) return;
      if (ord.total != null) o.total = ord.total;
      if (ord.createdAt) o.placedAt = ord.createdAt;
      if (ord.status) o.status = ord.status;
    } catch (_) { /* offline — keep the cached values */ }
  }));
  writeGuestOrders(list);
  return list;
}

Object.assign(window, { readGuestOrders, writeGuestOrders, rememberGuestOrder, refreshGuestOrders });
