// OrderTrackingPage — live order tracking for customers.
// Polls /api/orders/:id/tracking every 8s. Shows:
//  - queued (no rider yet) → "Waiting for the 2 PM dispatch / your priority slot"
//  - assigned + queueAhead > 0 → "Completing another delivery nearby" + position
//  - assigned + queueAhead === 0 → "You are NEXT — ETA based on distance"
//  - in_transit → live map with rider's blinking position
//  - delivered → success state
const OrderTrackingPage = ({ orderId, currentUser, setPage }) => {
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
      const r = await apiFetch(`/api/orders/${orderId}/tracking`);
      if (!r.ok) { setErr('Could not load tracking info.'); return; }
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
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotifPermission(p);
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
  let primaryMsg, secondaryMsg, accent = 'var(--sage)';
  if (status === 'queued') {
    primaryMsg = o.priority ? '⭐ Priority queued for tomorrow at 2 PM' : '🕑 Queued for the 2 PM dispatch';
    secondaryMsg = 'A rider will be assigned when the dispatch starts.';
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
    accent = '#27AE60';
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
        <div style={{ fontSize: 12, color: 'var(--warm-gray)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Order #{String(o.id).slice(-6)}</div>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 700, marginTop: 4, color: accent }}>{primaryMsg}</h1>
        <div style={{ fontSize: 14, color: 'var(--warm-gray)', marginTop: 6, lineHeight: 1.5 }}>{secondaryMsg}</div>

        {/* Notification permission CTA */}
        {notifPermission === 'default' && (
          <div style={{ marginTop: 14, background: 'var(--cream)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12 }}>🔔 Get notified when your rider is on the way</div>
            <button onClick={requestNotifPermission}
              style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700 }}>
              Enable notifications
            </button>
          </div>
        )}

        {/* Map */}
        <div style={{ marginTop: 18 }}>
          <div ref={mapContainerRef} style={{ height: 340, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--cream-dark)' }} />
        </div>

        {/* Order summary */}
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--warm-gray)' }}>
          <div>📍 <strong style={{ color: 'var(--warm-black)' }}>{o.location?.address || o.address || o.neighborhood}</strong></div>
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
