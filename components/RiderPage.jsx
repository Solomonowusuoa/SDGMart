// RiderPage — what a user with role='rider' sees after login.
// - Toggle Online/Offline
// - When online, browser geolocation is sampled every 15s and POSTed to /api/rider/location
// - Shows assigned orders sorted by nearest-neighbor route, with status buttons
const RiderPage = ({ currentUser, onLogout }) => {
  const isMobile = useMobile();
  const [online, setOnline] = React.useState(false);
  const [orders, setOrders] = React.useState([]);
  const [loc, setLoc] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [mapOpen, setMapOpen] = React.useState({});
  const watchIdRef = React.useRef(null);
  const pingTimerRef = React.useRef(null);

  const refreshOrders = React.useCallback(async () => {
    try {
      const r = await apiFetch('/api/rider/orders');
      if (r.ok) setOrders(await r.json());
    } catch (_) {}
  }, []);

  // Push current location to server
  const pushLocation = React.useCallback(async (lat, lng) => {
    try {
      await apiFetch('/api/rider/location', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
    } catch (_) {}
  }, []);

  // Toggle online state on the server
  const setOnlineServer = async (next) => {
    try {
      await apiFetch('/api/rider/online', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ online: next }),
      });
      setOnline(next);
      if (next) refreshOrders();
    } catch (_) {}
  };

  // While online, watch GPS and ping every 15s
  React.useEffect(() => {
    if (!online) {
      if (watchIdRef.current != null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
      return;
    }
    if (!navigator.geolocation) { setErr('Geolocation not supported.'); return; }
    let lastSent = 0;
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setLoc(next);
        const now = Date.now();
        if (now - lastSent > 14000) { pushLocation(next.lat, next.lng); lastSent = now; }
      },
      e => setErr(e.code === 1 ? 'Permission denied. Allow location to go online.' : 'Could not get your location.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    // Periodic forced ping + order refresh every 15s
    pingTimerRef.current = setInterval(() => {
      if (loc) pushLocation(loc.lat, loc.lng);
      refreshOrders();
    }, 15000);
    return () => {
      if (watchIdRef.current != null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
      if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    };
  }, [online]);

  React.useEffect(() => { refreshOrders(); }, [refreshOrders]);

  const updateStatus = async (orderId, status) => {
    const r = await apiFetch(`/api/rider/orders/${orderId}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (r.ok) refreshOrders();
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      {/* Top bar */}
      <header style={{ background: 'var(--white)', borderBottom: '1px solid var(--cream-dark)', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700 }}>🛵 Rider Hub</div>
          <div style={{ fontSize: 12, color: 'var(--warm-gray)' }}>Hi {currentUser.name}</div>
        </div>
        <button onClick={onLogout}
          style={{ background: 'transparent', color: 'var(--warm-gray)', border: '1px solid var(--cream-dark)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? '16px' : '24px' }}>
        {/* Online toggle */}
        <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{online ? '🟢 You are Online' : '⚫ You are Offline'}</div>
              <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>
                {online ? 'Sharing your location with HQ. Orders nearby will be assigned to you.' : 'Go online to start receiving deliveries.'}
              </div>
            </div>
            <button onClick={() => setOnlineServer(!online)}
              style={{
                background: online ? '#C0392B' : 'var(--sage)', color: '#fff',
                borderRadius: 999, padding: '12px 22px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
              }}>
              {online ? 'Go Offline' : 'Go Online'}
            </button>
          </div>
          {loc && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--warm-gray)' }}>
              📍 {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} (±{Math.round(loc.accuracy)}m)
            </div>
          )}
          {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-red)' }}>{err}</div>}
        </div>

        {/* Assigned orders queue */}
        <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700 }}>Your Route ({orders.length})</h2>
            <button onClick={refreshOrders} style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 600, background: 'transparent', border: 'none' }}>↻ Refresh</button>
          </div>
          {orders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--warm-gray)', fontSize: 13 }}>
              No orders assigned yet. Go online to start receiving them.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {orders.map((o, i) => (
                <div key={o.id} style={{ border: '1px solid var(--cream-dark)', borderRadius: 10, padding: 14, background: i === 0 ? '#FFFAF0' : 'var(--white)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {i === 0 && <span style={{ background: 'var(--sage)', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 10, marginRight: 6 }}>NEXT</span>}
                      {window.orderCode(o.id)}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--warm-gray)', textTransform: 'uppercase', fontWeight: 600 }}>{o.status}</span>
                  </div>
                  {/* Customer + contact (tap to call) */}
                  <div style={{ fontSize: 13, marginBottom: 4 }}>
                    <strong>{o.customer || o.customerName || 'Customer'}</strong>
                    {(o.phone || o.customerPhone) && <> · <a href={`tel:${o.phone || o.customerPhone}`} style={{ color: 'var(--sage-dark)', fontWeight: 700, textDecoration: 'none' }}>📞 {o.phone || o.customerPhone}</a></>}
                  </div>
                  {o.neighborhood && <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 4 }}>🏘 {o.neighborhood}{o.address ? ` · ${o.address}` : ''}</div>}
                  {o.deliverySlot && <div style={{ fontSize: 12, color: 'var(--sage-dark)', fontWeight: 700, marginBottom: 4 }}>📅 Scheduled: {o.deliveryDate || ''} · {o.deliverySlot}</div>}
                  {/* Itemised list so the rider knows what to deliver */}
                  {Array.isArray(o.items) && o.items.length > 0 && (
                    <div style={{ background: 'var(--cream)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{o.items.length} item{o.items.length === 1 ? '' : 's'}</div>
                      {o.items.map((it, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '1px 0' }}>
                          <span>{it.qty || 1}× {it.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Payment status — what to collect */}
                  <div style={{ marginBottom: 6 }}>
                    {o.paid
                      ? <span style={{ background: '#1A1A1A', color: '#fff', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>✓ PAID ONLINE — collect nothing</span>
                      : <span style={{ background: '#FFF4E0', color: '#7A5A00', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>💵 COLLECT GHS {Number(o.total || 0).toFixed(2)} CASH</span>}
                  </div>
                  {o.surpriseExtra && <div style={{ fontSize: 12, color: '#9B2D60', marginBottom: 6 }}>🎁 Include: {o.surpriseExtra}</div>}
                  {o.location && o.location.lat != null ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>
                        📍 {o.location.address || `${o.location.lat.toFixed(5)}, ${o.location.lng.toFixed(5)}`}
                      </div>
                      {/* Map auto-shows for the NEXT order; others have a toggle to keep things light */}
                      {(i === 0 || mapOpen[o.id]) ? (
                        <DestinationMap location={o.location} height={180} />
                      ) : (
                        <button onClick={() => setMapOpen(m => ({ ...m, [o.id]: true }))}
                          style={{ fontSize: 12, fontWeight: 700, color: 'var(--sage-dark)', background: 'var(--cream)', borderRadius: 6, padding: '6px 12px' }}>
                          🗺 Show map
                        </button>
                      )}
                      <a target="_blank" rel="noopener" href={`https://www.google.com/maps/dir/?api=1&destination=${o.location.lat},${o.location.lng}`}
                        style={{ display: 'inline-block', marginTop: 8, background: '#1A73E8', color: '#fff', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
                        🧭 Navigate with Google Maps
                      </a>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--accent-red)', marginBottom: 8 }}>⚠ No map pin — call the customer for directions.</div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700 }}>GHS {Number(o.total || 0).toFixed(2)}</div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    {o.status === 'assigned' && (
                      <button onClick={() => updateStatus(o.id, 'in_transit')}
                        style={{ flex: 1, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '9px', fontWeight: 700, fontSize: 12 }}>
                        Start Delivery
                      </button>
                    )}
                    {o.status === 'in_transit' && (
                      <button onClick={() => updateStatus(o.id, 'delivered')}
                        style={{ flex: 1, background: '#27AE60', color: '#fff', borderRadius: 8, padding: '9px', fontWeight: 700, fontSize: 12 }}>
                        Mark Delivered
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { RiderPage });
