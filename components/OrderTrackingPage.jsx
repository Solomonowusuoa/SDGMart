// OrderTrackingPage — live order tracking for customers.
// Polls /api/orders/:id/tracking every 8s. Shows:
//  - queued (no rider yet) → "Waiting for the 12 PM dispatch / your priority slot"
//  - assigned + queueAhead > 0 → "Completing another delivery nearby" + position
//  - assigned + queueAhead === 0 → "You are NEXT — ETA based on distance"
//  - in_transit → "Out for delivery" + distance-based ETA
//  - delivered → success state
const OrderTrackingPage = ({ orderId, currentUser, setPage, setCart }) => {
  const isMobile = useMobile();
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [notifPermission, setNotifPermission] = React.useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const wasNextRef = React.useRef(false);
  const wasInTransitRef = React.useRef(false);

  const poll = React.useCallback(async () => {
    try {
      // Guests authenticate with the signed track token — from localStorage
      // (saved at checkout / code entry) or from a shared ?track=..&t=.. link.
      let token = '';
      const mine = window.readGuestOrders().find(o => String(o.id) === String(orderId));
      if (mine && mine.token) token = mine.token;
      if (!token) {
        const urlT = new URLSearchParams(window.location.search).get('t');
        if (urlT && new URLSearchParams(window.location.search).get('track') === String(orderId)) token = urlT;
      }
      const r = await apiFetch(`/api/orders/${orderId}/tracking${token ? `?t=${encodeURIComponent(token)}` : ''}`);
      if (r.status === 410) { setErr('This tracking code has expired (order delivered more than 7 days ago).'); return; }
      if (!r.ok) { setErr('Could not load tracking info.'); return; }
      const t = await r.json();
      setData(t);
      // Arrived via a shared link on a new device → remember the order here too.
      // Recorded AFTER parsing, so the entry carries the real total and
      // placement time instead of a zero and the moment the link was opened.
      if (token) {
        window.rememberGuestOrder(orderId, token, {
          total: t && t.order ? t.order.total : null,
          placedAt: t && t.order ? t.order.createdAt : null,
          status: t && t.order ? t.order.status : null,
        });
      }
      // Trigger notifications on transitions
      const nowNext = t.queueAhead === 0 && t.order.status === 'assigned';
      if (nowNext && !wasNextRef.current) {
        wasNextRef.current = true;
        notify('You are next!', 'Your rider is heading to you now.');
      }
      const nowTransit = t.order.status === 'in_transit';
      if (nowTransit && !wasInTransitRef.current) {
        wasInTransitRef.current = true;
        notify('Out for delivery', 'Your rider has started your delivery.');
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
    // 8s meant ~37 database round-trips per minute per watching customer, and a
    // delivery window has many watching at once. Status changes are minutes
    // apart, so 25s loses nothing perceptible (D-03). The server also caches
    // each order's tracking response for a few seconds.
    const t = setInterval(poll, 25000);
    return () => clearInterval(t);
  }, [poll]);

  // The live map used to live here. It never drew on a cold load: only
  // MapPicker lazy-loads Leaflet, so arriving from a push notification or a
  // shared tracking link left window.L undefined and this effect returned at
  // its first line — and on an order with no pinned location it returned
  // anyway. Either way the customer got an empty bordered box. That space now
  // shows what is actually in the order, which is useful on every order.

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
      <div style={{ maxWidth: 600, margin: '60px auto', padding: 24, textAlign: 'center', fontFamily: 'var(--f-ui)', color: 'var(--rd-body)' }}>
        {err}
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setPage('home')} style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '11px 20px', fontFamily: 'var(--f-ui)', fontWeight: 600, fontSize: 14 }}>← Home</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div style={{ textAlign: 'center', padding: 60, fontFamily: 'var(--f-ui)', color: 'var(--rd-muted)' }}>Loading tracking…</div>;
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
  let primaryMsg, secondaryMsg, accent = 'var(--accent)';
  if (status === 'queued') {
    if (o.deliverySlot) {
      primaryMsg = `Scheduled · ${o.deliverySlot}`;
      secondaryMsg = `We'll deliver on ${fmtDeliveryDate(o.deliveryDate)} during your ${o.deliverySlot} slot. A rider is assigned closer to the time.`;
    } else {
      primaryMsg = o.priority ? 'Priority — queued for tomorrow at 12 PM' : 'Queued for the 12 PM dispatch';
      secondaryMsg = 'A rider will be assigned when the dispatch starts.';
    }
  } else if (status === 'assigned' && data.queueAhead > 0) {
    primaryMsg = `${data.queueAhead} ${data.queueAhead === 1 ? 'delivery' : 'deliveries'} ahead of you`;
    secondaryMsg = `${data.rider?.name || 'Your rider'} is completing another delivery nearby — you're #${data.queuePosition} in their route.`;
  } else if (status === 'assigned' && data.queueAhead === 0) {
    primaryMsg = `You're next — ETA ~${estimatedMinutes || '?'} min`;
    secondaryMsg = `${data.rider?.name || 'Your rider'} is heading to you now.`;
  } else if (status === 'in_transit') {
    primaryMsg = `Out for delivery — ETA ~${estimatedMinutes || '?'} min`;
    secondaryMsg = `${data.rider?.name || 'Your rider'} is on the way.`;
  } else if (status === 'delivered') {
    primaryMsg = 'Delivered';
    secondaryMsg = o.deliveredAt ? `Completed at ${new Date(o.deliveredAt).toLocaleTimeString()}` : 'Thanks for ordering with SDGMart!';
    accent = 'var(--ink)';
  } else {
    primaryMsg = status; secondaryMsg = '';
  }
  // Status strip — only the two milestones the DB actually timestamps
  // (order placed = createdAt, delivered = deliveredAt). Live progress is
  // already conveyed by the status heading + map above.
  const fmtT = (ts) => { try { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const steps = [
    { label: 'Order placed', time: o.createdAt ? fmtT(o.createdAt) : '', done: true },
    { label: 'Delivered', time: o.deliveredAt ? fmtT(o.deliveredAt) : '', done: status === 'delivered' },
  ];

  const footLbl = { fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rd-muted)' };
  const orderItems = Array.isArray(o.items) ? o.items : [];
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 24px', fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)', minHeight: '60vh' }}>
      <button onClick={() => setPage('home')}
        style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--rd-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back to home</button>

      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>Order {window.orderCode(o.id)}</div>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: isMobile ? 28 : 36, fontWeight: 700, letterSpacing: '-.028em', margin: '6px 0 4px', color: accent }}>{primaryMsg}</h1>
      <div style={{ fontSize: 14, color: 'var(--rd-body)', lineHeight: 1.5, maxWidth: 560 }}>{secondaryMsg}</div>

      {/* 4-step status strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)', marginTop: 24 }}>
        {steps.map((s) => {
          const top = s.done ? 'var(--ink)' : 'var(--rule-2)';
          return (
            <div key={s.label} style={{ background: '#fff', padding: '14px 14px 16px', borderTop: `3px solid ${top}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: s.done ? 'var(--ink)' : 'var(--rd-faint)', lineHeight: 1.25 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--rd-faint)', marginTop: 6 }}>{s.time || (s.done ? 'Done' : '—')}</div>
            </div>
          );
        })}
      </div>

      {/* Notification CTA — only while active */}
      {status !== 'delivered' && notifPermission === 'default' && (
        <div style={{ marginTop: 16, border: '1px solid var(--rule-2)', background: 'var(--surface-warm)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13 }}>Get notified when your rider is on the way</div>
          <button onClick={requestNotifPermission}
            style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '9px 16px', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Enable</button>
        </div>
      )}

      {/* Delivered → thank-you, else live map */}
      {status === 'delivered' ? (
        <div style={{ marginTop: 18, border: '1px solid var(--rule-2)', padding: '26px 22px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 26, color: 'var(--ink)' }}>Thank you for ordering with SDGMart.</div>
          <div style={{ fontSize: 13, color: 'var(--rd-muted)', marginTop: 6 }}>We hope everything arrived just right.</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            <button onClick={reorder} style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '12px 20px', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Order again</button>
            <button onClick={() => setPage('orders')} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '12px 20px', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>My orders</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <div style={{ border: '1px solid var(--rule-2)', background: '#fff' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--rule-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <span style={footLbl}>Your order</span>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--rd-muted)' }}>
                {orderItems.length} {orderItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            {orderItems.length === 0 ? (
              <div style={{ padding: '16px', fontSize: 13, color: 'var(--rd-muted)' }}>
                We couldn't load the item list for this order. Your order total is shown below.
              </div>
            ) : (
              <div>
                {orderItems.map((it, n) => (
                  <div key={n} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--rule-2)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                        {it.name}{it.birthdayGift ? ' 🎁' : ''}
                      </div>
                      {it.unit && <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginTop: 2 }}>{it.unit}</div>}
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--rd-muted)' }}>×{it.qty || 1}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                        {Number(it.price) === 0 ? 'Free' : `GHS ${(Number(it.price || 0) * (it.qty || 1)).toFixed(2)}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {o.subtotal != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--rd-body)' }}>
                  <span>Subtotal</span><span>GHS {Number(o.subtotal).toFixed(2)}</span>
                </div>
              )}
              {Number(o.discount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--rd-body)' }}>
                  <span>Discount</span><span>− GHS {Number(o.discount).toFixed(2)}</span>
                </div>
              )}
              {Number(o.loyaltyUsed) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--rd-body)' }}>
                  <span>Loyalty applied</span><span>− GHS {Number(o.loyaltyUsed).toFixed(2)}</span>
                </div>
              )}
              {o.deliveryFee != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--rd-body)' }}>
                  <span>Delivery</span><span>{Number(o.deliveryFee) === 0 ? 'Free' : `GHS ${Number(o.deliveryFee).toFixed(2)}`}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--rule-2)', marginTop: 4, paddingTop: 8 }}>
                <span style={footLbl}>Total</span>
                <span style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 800, letterSpacing: '-.02em' }}>GHS {Number(o.total || 0).toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--rd-muted)' }}>
                {o.paid ? 'Paid online' : 'Pay the rider on delivery'}
                {o.paymentMethod ? ` · ${o.paymentMethod}` : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer: Address / Delivery / Order total */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)', marginTop: 18 }}>
        <div style={{ background: '#fff', padding: '14px 16px' }}>
          <div style={footLbl}>Address</div>
          <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4 }}>{o.location?.address || o.address || o.neighborhood}</div>
        </div>
        <div style={{ background: '#fff', padding: '14px 16px' }}>
          <div style={footLbl}>Delivery</div>
          <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4 }}>{o.deliveryDate ? `${fmtDeliveryDate(o.deliveryDate)}${o.deliverySlot ? ` · ${o.deliverySlot}` : ''}` : (status === 'delivered' ? 'Completed' : 'Today from 12 PM')}{data.rider ? ` · ${data.rider.name}` : ''}</div>
        </div>
        <div style={{ background: '#fff', padding: '14px 16px' }}>
          <div style={footLbl}>Order total</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginTop: 2 }}>GHS {Number(o.total || 0).toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { OrderTrackingPage });
