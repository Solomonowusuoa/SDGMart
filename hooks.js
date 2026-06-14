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

Object.assign(window, { useMobile, apiFetch, subscribeToPush, unsubscribeFromPush });
