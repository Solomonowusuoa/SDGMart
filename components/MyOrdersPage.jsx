// MyOrdersPage — past orders + recurring orders + cancel/report/reorder actions
const MyOrdersPage = ({ setPage, openTracking, setCart }) => {
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
    alert('Thanks — your report has been sent. We will reach out on WhatsApp soon.');
  };

  const statusBadge = (s) => {
    const map = {
      queued: ['#C8923A', 'Queued'],
      assigned: ['#3879BF', 'Assigned'],
      in_transit: ['var(--sage)', 'Out for delivery'],
      delivered: ['#1A1A1A', 'Delivered'],
      cancelled: ['#888', 'Cancelled'],
      Pending: ['var(--warm-gray)', 'Pending'],
    };
    const [bg, label] = map[s] || ['var(--warm-gray)', s];
    return <span style={{ background: bg, color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>;
  };

  const ageMin = (o) => (Date.now() - new Date(o.createdAt).getTime()) / 60000;
  const canCancel = (o) => o.status === 'queued' && ageMin(o) < 15;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: isMobile ? 16 : 28 }}>
      <button onClick={() => setPage('home')}
        style={{ fontSize: 13, color: 'var(--warm-gray)', fontWeight: 600, background: 'transparent', marginBottom: 14 }}>
        ← Back to home
      </button>
      <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 18 }}>My Orders</h1>
      {err && <div style={{ color: 'var(--accent-red)', marginBottom: 14 }}>{err}</div>}

      {/* Recurring orders block */}
      {Array.isArray(recurring) && recurring.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>🔁 Auto-reorders</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recurring.map(r => (
              <div key={r.id} style={{ background: r.active ? 'var(--white)' : 'var(--cream)', borderRadius: 10, padding: 14, boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 12, opacity: r.active ? 1 : .65, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    Every {r.cadenceDays} day{r.cadenceDays === 1 ? '' : 's'} · {Array.isArray(r.items) ? r.items.length : 0} item{(Array.isArray(r.items) ? r.items.length : 0) === 1 ? '' : 's'}
                    {!r.active && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--warm-gray)' }}>(paused)</span>}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-gray)' }}>
                    Next: {r.nextRunAt ? new Date(r.nextRunAt).toLocaleDateString() : '—'}
                  </div>
                </div>
                <button onClick={() => toggleRecurring(r.id, !r.active)} style={{ fontSize: 12, fontWeight: 700, background: 'var(--cream)', color: 'var(--warm-gray)', borderRadius: 8, padding: '6px 12px' }}>
                  {r.active ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button onClick={() => deleteRecurring(r.id)} style={{ fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--accent-red)', borderRadius: 8, padding: '6px 12px' }}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {orders === null ? (
        <div style={{ color: 'var(--warm-gray)' }}>Loading…</div>
      ) : orders.length === 0 ? (
        <div style={{ background: 'var(--white)', borderRadius: 12, padding: 32, textAlign: 'center', color: 'var(--warm-gray)', boxShadow: 'var(--shadow)' }}>
          You haven't placed any orders yet.
          <div style={{ marginTop: 14 }}>
            <button onClick={() => setPage('home')} style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13 }}>Start shopping →</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orders.map(o => (
            <div key={o.id} style={{ background: 'var(--white)', borderRadius: 12, padding: 14, boxShadow: 'var(--shadow)' }}>
              <div onClick={() => o.status !== 'cancelled' && openTracking(o.id)}
                style={{ cursor: o.status !== 'cancelled' ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{window.orderCode(o.id)}</span>
                    {statusBadge(o.status)}
                    {o.priority && <span style={{ background: '#FFF4E0', color: '#7A5A00', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>⭐ Priority</span>}
                    {o.surpriseExtra && <span style={{ background: '#FCE4F0', color: '#9B2D60', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>🎁 Free extra</span>}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-gray)' }}>
                    {new Date(o.createdAt).toLocaleString()} · GHS {Number(o.total || 0).toFixed(2)} · {Array.isArray(o.items) ? o.items.length : 0} item{(Array.isArray(o.items) ? o.items.length : 0) === 1 ? '' : 's'}
                  </div>
                  {Array.isArray(o.items) && o.items.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-black)', opacity: .8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.items.slice(0, 3).map(it => `${it.qty || 1}× ${it.name}`).join(', ')}{o.items.length > 3 ? `, +${o.items.length - 3} more` : ''}
                    </div>
                  )}
                  {o.surpriseExtra && <div style={{ marginTop: 4, fontSize: 12, color: '#9B2D60', fontStyle: 'italic' }}>🎁 {o.surpriseExtra}</div>}
                  {o.cancelReason && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-gray)', fontStyle: 'italic' }}>Cancelled: {o.cancelReason}</div>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 700, flexShrink: 0 }}>
                  {o.status === 'delivered' ? 'View →' : o.status === 'cancelled' ? '' : 'Track →'}
                </div>
              </div>

              {/* Per-order actions */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--cream-dark)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => reorder(o)}
                  style={{ fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6, background: 'var(--cream)', color: 'var(--sage-dark)' }}>
                  🔁 Order again
                </button>
                <button onClick={() => downloadReceipt(o)}
                  style={{ fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6, background: 'var(--cream)', color: 'var(--warm-black)' }}>
                  📄 Receipt
                </button>
                {canCancel(o) && (
                  <button onClick={() => cancelOrder(o.id)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6, background: 'rgba(192,57,43,.08)', color: 'var(--accent-red)' }}>
                    ✕ Cancel order
                  </button>
                )}
                {o.status === 'delivered' && (
                  <button onClick={() => setIssueFor(o.id)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6, background: 'rgba(192,57,43,.08)', color: 'var(--accent-red)' }}>
                    ⚠ Report a problem
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Report-issue modal */}
      {issueFor && (
        <div onClick={() => setIssueFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 460, width: '100%' }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginBottom: 14 }}>Report a problem</h2>
            <p style={{ fontSize: 13, color: 'var(--warm-gray)', marginBottom: 14 }}>Order {window.orderCode(issueFor)}. Tell us what went wrong and we'll reach out.</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[['missing','Missing item'],['damaged','Damaged/bad'],['wrong','Wrong item'],['other','Other']].map(([v,l]) => (
                <button key={v} onClick={() => setIssue(s => ({ ...s, issueType: v }))}
                  style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: issue.issueType === v ? 'var(--sage)' : 'var(--cream)', color: issue.issueType === v ? '#fff' : 'var(--warm-gray)' }}>
                  {l}
                </button>
              ))}
            </div>
            <textarea value={issue.description} onChange={e => setIssue(s => ({ ...s, description: e.target.value }))}
              placeholder="What happened? (the more detail the better)"
              rows={4}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 14, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={reportIssue} disabled={!issue.description.trim()}
                style={{ flex: 1, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13, opacity: issue.description.trim() ? 1 : .5 }}>
                Submit report
              </button>
              <button onClick={() => setIssueFor(null)}
                style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 13 }}>
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
