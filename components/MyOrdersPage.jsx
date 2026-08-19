// MyOrdersPage — past orders + recurring orders + cancel/report/reorder actions
// Guests: no server-side order history — show the orders remembered in
// localStorage (saved with a signed track token at checkout) instead.
const GuestOrdersView = ({ setPage, openTracking }) => {
  const isMobile = useMobile();
  const [codeInput, setCodeInput] = React.useState('');
  const [codeErr, setCodeErr] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  let guestOrders = [];
  try { guestOrders = JSON.parse(localStorage.getItem('sdgmart_guest_orders') || '[]'); } catch (_) {}

  // Accept a portable tracking code ("SDG-00030-<token>", with or without the
  // full link around it), verify it against the server, remember it on this
  // device, then open live tracking.
  const trackByCode = async () => {
    setCodeErr('');
    const m = codeInput.trim().match(/SDG-?0*(\d+)[-\s]+([0-9a-f]{16,24})/i)
      || codeInput.trim().match(/[?&]track=(\d+)&t=([0-9a-f]{16,24})/i);
    if (!m) { setCodeErr('That doesn\'t look like a tracking code. It looks like: SDG-00030-a1b2c3d4e5… (from your order confirmation or WhatsApp).'); return; }
    const id = parseInt(m[1], 10), token = m[2].toLowerCase();
    setChecking(true);
    try {
      const r = await fetch(`/api/orders/${id}/tracking?t=${encodeURIComponent(token)}`);
      if (r.status === 410) { setCodeErr('This tracking code has expired (order delivered more than 7 days ago).'); return; }
      if (!r.ok) { setCodeErr('Tracking code not recognised — check for typos, or WhatsApp us for help.'); return; }
      try {
        const list = JSON.parse(localStorage.getItem('sdgmart_guest_orders') || '[]').filter(o => String(o.id) !== String(id));
        list.unshift({ id, code: window.orderCode(id), token, at: new Date().toISOString() });
        localStorage.setItem('sdgmart_guest_orders', JSON.stringify(list.slice(0, 10)));
      } catch (_) {}
      openTracking(id);
    } catch (_) { setCodeErr('Network error — please try again.'); }
    finally { setChecking(false); }
  };

  const copyCode = async (o) => {
    const full = `${o.code}-${o.token}`;
    try { await navigator.clipboard.writeText(full); alert('Tracking code copied:\n' + full); }
    catch (_) { window.prompt('Copy your tracking code:', full); }
  };

  return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 24px', fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)', minHeight: '60vh' }}>
        <button onClick={() => setPage('home')}
          style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--rd-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back to home</button>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: '-.03em', margin: '0 0 6px' }}>Track Your Order</h1>
        <p style={{ fontSize: 13.5, color: 'var(--rd-muted)', marginBottom: 20 }}>Orders you placed on this device. Sign up to keep your full order history across devices.</p>

        {/* Track by code — works on ANY device */}
        <div style={{ border: '1px solid var(--rule-2)', padding: '16px 18px', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>Have a tracking code?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <input
              value={codeInput}
              onChange={e => { setCodeInput(e.target.value); if (codeErr) setCodeErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') trackByCode(); }}
              placeholder="e.g. SDG-00030-a1b2c3d4e5f6…"
              style={{ flex: '1 1 220px', padding: '11px 14px', border: '1px solid var(--border-input)', borderRight: 'none', fontFamily: 'var(--f-mono)', fontSize: 13, outline: 'none', background: '#fff', color: 'var(--ink)' }}
            />
            <button onClick={trackByCode} disabled={checking}
              style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '11px 20px', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', opacity: checking ? .6 : 1 }}>{checking ? 'Checking…' : 'Track'}</button>
          </div>
          {codeErr && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--accent)', marginTop: 8, lineHeight: 1.5 }}>{codeErr}</div>}
          <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginTop: 8 }}>The code is on your order confirmation screen and in the WhatsApp copy of your order. It works on any device until 7 days after delivery.</div>
        </div>
        {guestOrders.length === 0 ? (
          <div style={{ border: '1px dashed var(--border-input)', padding: 30, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 24, color: 'var(--ink)' }}>No orders on this device yet.</div>
            <div style={{ fontSize: 12.5, color: 'var(--rd-muted)', marginTop: 8 }}>Placed one elsewhere or need help? <a href="https://wa.me/233504082555?text=Hi!%20I%20would%20like%20to%20track%20my%20SDGMart%20order." target="_blank" rel="noopener" style={{ color: 'var(--accent)', fontWeight: 600 }}>WhatsApp us</a> with your order code.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {guestOrders.map(o => (
              <div key={o.id} style={{ border: '1px solid var(--rule-2)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontWeight: 500, fontSize: 13.5 }}>{o.code}</div>
                  <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>{new Date(o.at).toLocaleString()} · GHS {Number(o.total || 0).toFixed(2)}</div>
                </div>
                <button onClick={() => copyCode(o)} title="Copy tracking code (use it on any device)"
                  style={{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '8px 14px', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Copy code</button>
                <button onClick={() => openTracking(o.id)}
                  style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '8px 16px', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Track →</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
};

// Wrapper: route guests to the local-orders view, members to full history.
// (Separate components so each keeps a consistent hook order.)
const MyOrdersPage = (props) => {
  let isGuest = true;
  try {
    const u = JSON.parse(sessionStorage.getItem('sdgmart_user') || 'null');
    isGuest = !(u && u.token && u.role !== 'guest');
  } catch (_) {}
  return isGuest ? <GuestOrdersView {...props} /> : <SignedInOrdersView {...props} />;
};

const SignedInOrdersView = ({ setPage, openTracking, setCart }) => {
  const isMobile = useMobile();
  const [orders, setOrders] = React.useState(null);
  const [recurring, setRecurring] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [issueFor, setIssueFor] = React.useState(null);
  const [issue, setIssue] = React.useState({ issueType: 'missing', description: '' });

  const load = () => {
    apiFetch('/api/me/orders')
      .then(r => r.ok ? r.json() : [])
      .then(setOrders)
      .catch(() => setErr('Could not load your orders.'));
    apiFetch('/api/me/recurring')
      .then(r => r.ok ? r.json() : [])
      .then(setRecurring)
      .catch(() => setRecurring([]));
  };
  React.useEffect(load, []);

  const toggleRecurring = async (id, active) => {
    await apiFetch(`/api/me/recurring/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
    setRecurring(prev => (prev || []).map(r => r.id === id ? { ...r, active } : r));
  };
  const deleteRecurring = async (id) => {
    if (!window.confirm('Cancel this recurring order? You can always re-create it at checkout.')) return;
    await apiFetch(`/api/me/recurring/${id}`, { method: 'DELETE' });
    setRecurring(prev => (prev || []).filter(r => r.id !== id));
  };

  const cancelOrder = async (id) => {
    const reason = window.prompt('Why are you cancelling? (optional)') || '';
    const r = await apiFetch(`/api/me/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
    const data = await r.json();
    if (!r.ok) { alert(data.error || 'Could not cancel'); return; }
    load();
  };

  const reorder = (o) => {
    const items = Array.isArray(o.items) ? o.items : [];
    // Match each old item against current PRODUCTS to skip out-of-stock and update prices
    const products = window.PRODUCTS || [];
    const skipped = [];
    const newCart = [];
    items.forEach(it => {
      const fresh = products.find(p => p.id === it.id);
      if (!fresh || (fresh.stock || 0) <= 0) { skipped.push(it.name); return; }
      newCart.push({ ...fresh, qty: it.qty || 1 });
    });
    if (newCart.length === 0) {
      alert('None of these items are currently in stock — sorry!');
      return;
    }
    setCart(newCart);
    if (skipped.length) alert(`Reordered ${newCart.length} item${newCart.length === 1 ? '' : 's'}. Skipped (out of stock): ${skipped.join(', ')}`);
    setPage('checkout');
  };

  // Copy a shareable, works-on-any-device tracking code + live link. Handy for
  // Family Mode: send it to whoever's receiving the delivery.
  const shareTrackingCode = async (o) => {
    const code = `${window.orderCode(o.id)}-${o.trackToken}`;
    const url = `${window.location.origin}/?track=${o.id}&t=${o.trackToken}`;
    const text = `Track my SDGMart order ${window.orderCode(o.id)} live: ${url}\n(or enter code ${code} on the Track Order page)`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Track my SDGMart order', text }); return; }
      await navigator.clipboard.writeText(text);
      alert('Tracking link copied — paste it to whoever should follow the delivery.');
    } catch (_) { window.prompt('Copy your tracking link:', text); }
  };

  const downloadReceipt = (o) => {
    if (!window.generateReceiptPDF) { alert('PDF engine still loading — try again in a moment.'); return; }
    const items = Array.isArray(o.items) ? o.items : [];
    window.generateReceiptPDF({
      orderId: window.orderCode(o.id),
      date: o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB'),
      items: items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal: o.subtotal,
      discount: o.discount,
      loyaltyUsed: o.loyaltyUsed,
      delivery: o.deliveryFee != null ? o.deliveryFee : o.delivery,
      total: o.total,
      neighborhood: o.neighborhood,
      recipient: o.recipientName || o.customerName,
      phone: o.recipientPhone || o.customerPhone,
      location: (o.location && o.location.address) || o.address || '',
      payMethod: o.paymentMethod,
      surpriseExtra: o.surpriseExtra,
    });
  };

  const reportIssue = async () => {
    if (!issue.description.trim()) return;
    const r = await apiFetch(`/api/me/orders/${issueFor}/report-issue`, {
      method: 'POST', body: JSON.stringify(issue),
    });
    if (!r.ok) { alert('Could not submit — please try again'); return; }
    setIssueFor(null);
    setIssue({ issueType: 'missing', description: '' });
    alert("Thanks — your report has been sent. We'll reach out soon.");
  };

  const statusBadge = (s) => {
    const map = {
      queued: ['var(--surface-warm)', 'var(--warn-ink)', 'Queued', '1px solid var(--rule-2)'],
      assigned: ['var(--ink)', '#fff', 'Assigned', 'none'],
      in_transit: ['var(--ink)', '#fff', 'Out for delivery', 'none'],
      delivered: ['var(--ink)', '#fff', 'Delivered', 'none'],
      cancelled: ['var(--rule-2)', 'var(--rd-muted)', 'Cancelled', 'none'],
      Pending: ['var(--surface-warm)', 'var(--rd-muted)', 'Pending', '1px solid var(--rule-2)'],
    };
    const [bg, color, label, border] = map[s] || ['var(--surface-warm)', 'var(--rd-muted)', s, '1px solid var(--rule-2)'];
    return <span style={{ background: bg, color, border, padding: '3px 10px', fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>;
  };

  const ageMin = (o) => (Date.now() - new Date(o.createdAt).getTime()) / 60000;
  const canCancel = (o) => o.status === 'queued' && ageMin(o) < 15;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 24px', fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)', minHeight: '60vh' }}>
      <button onClick={() => setPage('home')}
        style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--rd-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>← Back to home</button>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: '-.03em', margin: '0 0 20px' }}>My Orders</h1>
      {err && <div style={{ color: 'var(--accent)', marginBottom: 14 }}>{err}</div>}

      {/* Recurring orders block */}
      {Array.isArray(recurring) && recurring.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 10 }}>Auto-reorders</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recurring.map(r => (
              <div key={r.id} style={{ border: '1px solid var(--rule-2)', background: r.active ? '#fff' : 'var(--surface-warm)', padding: 14, display: 'flex', alignItems: 'center', gap: 12, opacity: r.active ? 1 : .8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Every {r.cadenceDays} day{r.cadenceDays === 1 ? '' : 's'} · {Array.isArray(r.items) ? r.items.length : 0} item{(Array.isArray(r.items) ? r.items.length : 0) === 1 ? '' : 's'}
                    {!r.active && <span style={{ marginLeft: 8, fontFamily: 'var(--f-mono)', fontSize: 10.5, textTransform: 'uppercase', color: 'var(--rd-muted)' }}>(paused)</span>}
                  </div>
                  <div style={{ marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--rd-muted)' }}>Next: {r.nextRunAt ? new Date(r.nextRunAt).toLocaleDateString() : '—'}</div>
                </div>
                <button onClick={() => toggleRecurring(r.id, !r.active)} style={{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '7px 12px', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{r.active ? 'Pause' : 'Resume'}</button>
                <button onClick={() => deleteRecurring(r.id)} style={{ background: 'none', color: 'var(--accent)', border: 'none', cursor: 'pointer', padding: '7px 12px', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Cancel</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {orders === null ? (
        <div style={{ color: 'var(--rd-muted)' }}>Loading…</div>
      ) : orders.length === 0 ? (
        <div style={{ border: '1px solid var(--rule-2)', padding: 32, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 24, color: 'var(--ink)' }}>You haven't placed any orders yet.</div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setPage('home')} style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '12px 20px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>Start shopping →</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orders.map(o => (
            <div key={o.id} style={{ border: '1px solid var(--rule-2)', padding: 16 }}>
              <div onClick={() => o.status !== 'cancelled' && openTracking(o.id)}
                style={{ cursor: o.status !== 'cancelled' ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontWeight: 500, fontSize: 13.5 }}>{window.orderCode(o.id)}</span>
                    {statusBadge(o.status)}
                    {o.priority && <span style={{ fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '2px 7px' }}>Priority</span>}
                    {o.surpriseExtra && <span style={{ fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '2px 7px' }}>Free extra</span>}
                  </div>
                  <div style={{ marginTop: 6, fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--rd-muted)' }}>
                    {new Date(o.createdAt).toLocaleString()} · GHS {Number(o.total || 0).toFixed(2)} · {Array.isArray(o.items) ? o.items.length : 0} item{(Array.isArray(o.items) ? o.items.length : 0) === 1 ? '' : 's'}
                  </div>
                  {Array.isArray(o.items) && o.items.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--rd-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.items.slice(0, 3).map(it => `${it.qty || 1}× ${it.name}`).join(', ')}{o.items.length > 3 ? `, +${o.items.length - 3} more` : ''}
                    </div>
                  )}
                  {o.surpriseExtra && <div style={{ marginTop: 4, fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--accent)' }}>{o.surpriseExtra}</div>}
                  {o.cancelReason && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--rd-muted)', fontStyle: 'italic' }}>Cancelled: {o.cancelReason}</div>}
                </div>
                <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', flexShrink: 0, borderBottom: o.status !== 'cancelled' ? '1px solid var(--accent)' : 'none', paddingBottom: 1 }}>
                  {o.status === 'delivered' ? 'View →' : o.status === 'cancelled' ? '' : 'Track →'}
                </div>
              </div>

              {/* Per-order actions */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {(() => {
                  const act = { background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' };
                  return (<>
                    <button onClick={() => reorder(o)} style={{ ...act, color: 'var(--ink)' }}>Order again</button>
                    <button onClick={() => downloadReceipt(o)} style={{ ...act, color: 'var(--ink)' }}>Receipt</button>
                    {o.trackToken && o.status !== 'delivered' && o.status !== 'cancelled' && (
                      <button onClick={() => shareTrackingCode(o)} title="Copy a track-on-any-device link to share" style={{ ...act, color: 'var(--ink)' }}>Share tracking</button>
                    )}
                    {canCancel(o) && <button onClick={() => cancelOrder(o.id)} style={{ ...act, color: 'var(--accent)' }}>Cancel order</button>}
                    {o.status === 'delivered' && <button onClick={() => setIssueFor(o.id)} style={{ ...act, color: 'var(--accent)' }}>Report a problem</button>}
                  </>);
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Report-issue modal */}
      {issueFor && (
        <div onClick={() => setIssueFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--rule-2)', padding: 24, maxWidth: 460, width: '100%', fontFamily: 'var(--f-ui)', color: 'var(--ink)' }}>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 12 }}>Report a problem</h2>
            <p style={{ fontSize: 13, color: 'var(--rd-muted)', marginBottom: 14 }}>Order {window.orderCode(issueFor)}. Tell us what went wrong and we'll reach out.</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[['missing','Missing item'],['damaged','Damaged/bad'],['wrong','Wrong item'],['other','Other']].map(([v,l]) => (
                <button key={v} onClick={() => setIssue(s => ({ ...s, issueType: v }))}
                  style={{ fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '7px 12px', border: `1px solid ${issue.issueType === v ? 'var(--ink)' : 'var(--border-input)'}`, background: issue.issueType === v ? 'var(--ink)' : '#fff', color: issue.issueType === v ? '#fff' : 'var(--rd-muted)', cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
            <textarea value={issue.description} onChange={e => setIssue(s => ({ ...s, description: e.target.value }))}
              placeholder="What happened? (the more detail the better)"
              rows={4}
              style={{ width: '100%', padding: 12, border: '1px solid var(--border-input)', fontFamily: 'var(--f-ui)', fontSize: 13, resize: 'vertical', marginBottom: 14, outline: 'none', color: 'var(--ink)', background: '#fff' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={reportIssue} disabled={!issue.description.trim()}
                style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '12px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600, opacity: issue.description.trim() ? 1 : .5 }}>
                Submit report
              </button>
              <button onClick={() => setIssueFor(null)}
                style={{ background: 'transparent', color: 'var(--rd-muted)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '12px 16px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { MyOrdersPage });
