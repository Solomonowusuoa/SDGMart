// OrderTrackingPage — live order tracking for customers.
// Polls /api/orders/:id/tracking every 8s. Shows:
//  - queued (no rider yet) → "Waiting for the 12 PM dispatch / your priority slot"
//  - assigned + queueAhead > 0 → "Completing another delivery nearby" + position
//  - assigned + queueAhead === 0 → "You are NEXT — ETA based on distance"
//  - in_transit → live map with rider's blinking position
//  - delivered → success state
const OrderTrackingPage = ({ orderId, currentUser, setPage, setCart }) => {
  const isMobile = useMobile();
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [notifPermission, setNotifPermission] = React.useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const wasNextRef = React.useRef(false);
  const wasInTransitRef = React.useRef(false);

  // Map refs
  const mapContainerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const customerMarkerRef = React.useRef(null);
  const riderMarkerRef = React.useRef(null);
  const routeLineRef = React.useRef(null);

  const poll = React.useCallback(async () => {
    try {
      // Guests authenticate with the signed track token — from localStorage
      // (saved at checkout / code entry) or from a shared ?track=..&t=.. link.
      let token = '';
      try {
        const g = JSON.parse(localStorage.getItem('sdgmart_guest_orders') || '[]');
        const mine = g.find(o => String(o.id) === String(orderId));
        if (mine && mine.token) token = mine.token;
      } catch (_) {}
      if (!token) {
        const urlT = new URLSearchParams(window.location.search).get('t');
        if (urlT && new URLSearchParams(window.location.search).get('track') === String(orderId)) token = urlT;
      }
      const r = await apiFetch(`/api/orders/${orderId}/tracking${token ? `?t=${encodeURIComponent(token)}` : ''}`);
      if (r.status === 410) { setErr('This tracking code has expired (order delivered more than 7 days ago).'); return; }
      if (!r.ok) { setErr('Could not load tracking info.'); return; }
      // Arrived via a shared link on a new device → remember the order here too.
      if (token) {
        try {
          const list = JSON.parse(localStorage.getItem('sdgmart_guest_orders') || '[]');
          if (!list.some(o => String(o.id) === String(orderId))) {
            list.unshift({ id: Number(orderId), code: window.orderCode(orderId), token, at: new Date().toISOString() });
            localStorage.setItem('sdgmart_guest_orders', JSON.stringify(list.slice(0, 10)));
          }
        } catch (_) {}
      }
      const t = await r.json();
      setData(t);
      // Trigger notifications on transitions
      const nowNext = t.queueAhead === 0 && t.order.status === 'assigned';
      if (nowNext && !wasNextRef.current) {
        wasNextRef.current = true;
        notify('🛵 You are next!', 'Your rider is heading to you now.');
      }
      const nowTransit = t.order.status === 'in_transit';
      if (nowTransit && !wasInTransitRef.current) {
        wasInTransitRef.current = true;
        notify('📦 Out for delivery', 'Your rider has started your delivery.');
      }
    } catch (_) { setErr('Network error.'); }
  }, [orderId]);

  // Browser notification helper
  const notify = (title, body) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `order-${orderId}` }); } catch (_) {}
    // Optional: small beep
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200);
    } catch (_) {}
  };

  const requestNotifPermission = async () => {
    // Try real Web Push first (background notifications even when tab closed).
    // Falls back to in-page Notification permission if push isn't supported.
    const ok = await window.subscribeToPush();
    setNotifPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
    if (!ok && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      setNotifPermission(p);
    }
  };

  // Poll every 8 seconds
  React.useEffect(() => {
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [poll]);

  // Init/update map when we have data
  React.useEffect(() => {
    if (!data || !mapContainerRef.current || !window.L) return;
    const customerLoc = data.order.location;
    const riderLoc = data.rider && data.rider.lat != null ? { lat: data.rider.lat, lng: data.rider.lng } : null;
    if (!customerLoc) return;
    if (!mapRef.current) {
      mapRef.current = window.L.map(mapContainerRef.current).setView([customerLoc.lat, customerLoc.lng], 15);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(mapRef.current);
    }
    // Customer marker (house pin)
    if (!customerMarkerRef.current) {
      customerMarkerRef.current = window.L.marker([customerLoc.lat, customerLoc.lng])
        .addTo(mapRef.current).bindPopup('Your delivery spot');
    }
    // Rider marker (motorcycle)
    if (riderLoc) {
      const riderIcon = window.L.divIcon({
        className: 'rider-marker',
        html: '<div style="background:#1A1A1A;color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);font-size:18px;">🛵</div>',
        iconSize: [34, 34], iconAnchor: [17, 17],
      });
      if (!riderMarkerRef.current) {
        riderMarkerRef.current = window.L.marker([riderLoc.lat, riderLoc.lng], { icon: riderIcon })
          .addTo(mapRef.current).bindPopup(`${data.rider.name}`);
      } else {
        riderMarkerRef.current.setLatLng([riderLoc.lat, riderLoc.lng]);
      }
      // Draw a line between rider and customer
      if (routeLineRef.current) routeLineRef.current.remove();
      routeLineRef.current = window.L.polyline(
        [[riderLoc.lat, riderLoc.lng], [customerLoc.lat, customerLoc.lng]],
        { color: '#1A1A1A', weight: 2, dashArray: '6,8', opacity: .7 }
      ).addTo(mapRef.current);
      // Fit bounds to include both
      mapRef.current.fitBounds([
        [riderLoc.lat, riderLoc.lng], [customerLoc.lat, customerLoc.lng],
      ], { padding: [40, 40], maxZoom: 16 });
    }
  }, [data]);

  // Cleanup map on unmount
  React.useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  // Rough straight-line ETA assuming 25 km/h average (Tamale traffic)
  const estimatedMinutes = (() => {
    if (!data || !data.rider || !data.order.location || data.rider.lat == null) return null;
    const R = 6371, toRad = d => d * Math.PI / 180;
    const a = data.rider, b = data.order.location;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    const km = 2 * R * Math.asin(Math.sqrt(x));
    return Math.max(2, Math.round((km / 25) * 60));
  })();

  if (err) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', padding: 24, textAlign: 'center', color: 'var(--accent-red)' }}>
        {err}
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setPage('home')} style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13 }}>← Home</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--warm-gray)' }}>Loading tracking…</div>;
  }

  const o = data.order;
  const status = o.status;
  const fmtDeliveryDate = (ymd) => {
    if (!ymd) return '';
    const t = new Date().toISOString().slice(0, 10);
    const tm = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (ymd === t) return 'Today';
    if (ymd === tm) return 'Tomorrow';
    try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); } catch (_) { return ymd; }
  };
  const reorder = () => {
    const items = Array.isArray(o.items) ? o.items : [];
    const products = window.PRODUCTS || [];
    const newCart = [];
    items.forEach(it => { const f = products.find(p => p.id === it.id); if (f && (f.stock || 0) > 0) newCart.push({ ...f, qty: it.qty || 1 }); });
    if (!newCart.length) { alert('None of these items are in stock right now — sorry!'); return; }
    if (setCart) setCart(newCart);
    setPage('checkout');
  };
  let primaryMsg, secondaryMsg, accent = 'var(--sage)';
  if (status === 'queued') {
    if (o.deliverySlot) {
      primaryMsg = `🗓 Scheduled · ${o.deliverySlot}`;
      secondaryMsg = `We'll deliver on ${fmtDeliveryDate(o.deliveryDate)} during your ${o.deliverySlot} slot. A rider is assigned closer to the time.`;
    } else {
      primaryMsg = o.priority ? '⭐ Priority — queued for tomorrow at 12 PM' : '🕑 Queued for the 12 PM dispatch';
      secondaryMsg = 'A rider will be assigned when the dispatch starts.';
    }
    accent = '#C8923A';
  } else if (status === 'assigned' && data.queueAhead > 0) {
    primaryMsg = `${data.queueAhead} ${data.queueAhead === 1 ? 'delivery' : 'deliveries'} ahead of you`;
    secondaryMsg = `${data.rider?.name || 'Your rider'} is completing another delivery nearby — you're #${data.queuePosition} in their route.`;
    accent = '#3879BF';
  } else if (status === 'assigned' && data.queueAhead === 0) {
    primaryMsg = `🛵 You're next — ETA ~${estimatedMinutes || '?'} min`;
    secondaryMsg = `${data.rider?.name || 'Your rider'} is heading to you now.`;
    accent = 'var(--sage)';
  } else if (status === 'in_transit') {
    primaryMsg = `📦 Out for delivery — ETA ~${estimatedMinutes || '?'} min`;
    secondaryMsg = `${data.rider?.name || 'Your rider'} is on the way.`;
    accent = 'var(--sage)';
  } else if (status === 'delivered') {
    primaryMsg = '✅ Delivered';
    secondaryMsg = o.deliveredAt ? `Completed at ${new Date(o.deliveredAt).toLocaleTimeString()}` : 'Thanks for ordering with SDGMart!';
    accent = '#1A1A1A';
  } else {
    primaryMsg = status; secondaryMsg = '';
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? 16 : 28 }}>
      <button onClick={() => setPage('home')}
        style={{ fontSize: 13, color: 'var(--warm-gray)', fontWeight: 600, background: 'transparent', border: 'none', marginBottom: 14, cursor: 'pointer' }}>
        ← Back to home
      </button>

      <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Order {window.orderCode(o.id)}</div>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 700, marginTop: 4, color: accent }}>{primaryMsg}</h1>
        <div style={{ fontSize: 14, color: 'var(--warm-gray)', marginTop: 6, lineHeight: 1.5 }}>{secondaryMsg}</div>

        {/* Notification permission CTA — only while the order is still active */}
        {status !== 'delivered' && notifPermission === 'default' && (
          <div style={{ marginTop: 14, background: 'var(--cream)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12 }}>🔔 Get notified when your rider is on the way</div>
            <button onClick={requestNotifPermission}
              style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700 }}>
              Enable notifications
            </button>
          </div>
        )}

        {/* Delivered → thank-you + reorder instead of the live map */}
        {status === 'delivered' ? (
          <div style={{ marginTop: 18, background: 'var(--cream)', borderRadius: 12, padding: '22px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>🎉</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginTop: 6 }}>Thank you for ordering with SDGMart!</div>
            <div style={{ fontSize: 13, color: 'var(--warm-gray)', marginTop: 4 }}>We hope everything arrived just right. 🙏</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={reorder} style={{ background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>🔁 Order again</button>
              <button onClick={() => setPage('orders')} style={{ background: 'var(--white)', color: 'var(--warm-black)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>📦 My orders</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 18 }}>
            <div ref={mapContainerRef} style={{ height: 340, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--cream-dark)' }} />
          </div>
        )}

        {/* Order summary */}
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--warm-gray)' }}>
          <div>📍 <strong style={{ color: 'var(--warm-black)' }}>{o.location?.address || o.address || o.neighborhood}</strong></div>
          {status !== 'delivered' && o.deliveryDate && (
            <div style={{ marginTop: 4 }}>📅 Delivery: <strong style={{ color: 'var(--warm-black)' }}>{fmtDeliveryDate(o.deliveryDate)}{o.deliverySlot ? ` · ${o.deliverySlot}` : ''}</strong></div>
          )}
          <div style={{ marginTop: 4 }}>💰 GHS {Number(o.total || 0).toFixed(2)}</div>
          {data.rider && (
            <div style={{ marginTop: 4 }}>
              🛵 Rider: <strong style={{ color: 'var(--warm-black)' }}>{data.rider.name}</strong>
              {data.rider.lastSeen && <span style={{ marginLeft: 8, fontSize: 11 }}>(updated {Math.max(1, Math.round((Date.now() - data.rider.lastSeen) / 1000))}s ago)</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { OrderTrackingPage });
