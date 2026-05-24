// MyOrdersPage — list of the signed-in user's orders + their recurring orders.
const MyOrdersPage = ({ setPage, openTracking }) => {
  const isMobile = useMobile();
  const [orders, setOrders] = React.useState(null);
  const [recurring, setRecurring] = React.useState(null);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    apiFetch('/api/me/orders')
      .then(r => r.ok ? r.json() : [])
      .then(setOrders)
      .catch(() => setErr('Could not load your orders.'));
    apiFetch('/api/me/recurring')
      .then(r => r.ok ? r.json() : [])
      .then(setRecurring)
      .catch(() => setRecurring([]));
  }, []);

  const toggleRecurring = async (id, active) => {
    await apiFetch(`/api/me/recurring/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
    setRecurring(prev => (prev || []).map(r => r.id === id ? { ...r, active } : r));
  };
  const deleteRecurring = async (id) => {
    if (!window.confirm('Cancel this recurring order? You can always re-create it at checkout.')) return;
    await apiFetch(`/api/me/recurring/${id}`, { method: 'DELETE' });
    setRecurring(prev => (prev || []).filter(r => r.id !== id));
  };

  const statusBadge = (s) => {
    const map = {
      queued: ['#C8923A', 'Queued'],
      assigned: ['#3879BF', 'Assigned'],
      in_transit: ['var(--sage)', 'Out for delivery'],
      delivered: ['#27AE60', 'Delivered'],
      Pending: ['var(--warm-gray)', 'Pending'],
    };
    const [bg, label] = map[s] || ['var(--warm-gray)', s];
    return <span style={{ background: bg, color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>;
  };

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: isMobile ? 16 : 28 }}>
      <button onClick={() => setPage('home')}
        style={{ fontSize: 13, color: 'var(--warm-gray)', fontWeight: 600, background: 'transparent', border: 'none', marginBottom: 14 }}>
        ← Back to home
      </button>
      <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 18 }}>My Orders</h1>
      {err && <div style={{ color: 'var(--accent-red)', marginBottom: 14 }}>{err}</div>}

      {/* Recurring orders block — only shown when there's at least one */}
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
                  {Array.isArray(r.items) && r.items.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-black)', opacity: .8 }}>
                      {r.items.slice(0, 3).map(it => `${it.qty || 1}× ${it.name}`).join(', ')}{r.items.length > 3 ? `, +${r.items.length - 3} more` : ''}
                    </div>
                  )}
                </div>
                <button onClick={() => toggleRecurring(r.id, !r.active)}
                  style={{ fontSize: 12, fontWeight: 700, background: 'var(--cream)', color: 'var(--warm-gray)', borderRadius: 8, padding: '6px 12px' }}>
                  {r.active ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button onClick={() => deleteRecurring(r.id)}
                  style={{ fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--accent-red)', borderRadius: 8, padding: '6px 12px' }}>
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
            <div key={o.id} onClick={() => openTracking(o.id)}
              style={{ background: 'var(--white)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow)'; }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>#{String(o.id).slice(-6)}</span>
                  {statusBadge(o.status)}
                  {o.priority && <span style={{ background: '#FFF4E0', color: '#7A5A00', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>⭐ Priority</span>}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-gray)' }}>
                  {new Date(o.createdAt).toLocaleString()} · GHS {Number(o.total || 0).toFixed(2)} · {Array.isArray(o.items) ? o.items.length : 0} item{(Array.isArray(o.items) ? o.items.length : 0) === 1 ? '' : 's'}
                </div>
                {Array.isArray(o.items) && o.items.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-black)', opacity: .8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.items.slice(0, 3).map(it => `${it.qty || 1}× ${it.name}`).join(', ')}{o.items.length > 3 ? `, +${o.items.length - 3} more` : ''}
                  </div>
                )}
                <div style={{ marginTop: 2, fontSize: 12, color: 'var(--warm-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📍 {(o.location && o.location.address) || o.neighborhood || '—'}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 700 }}>
                {o.status === 'delivered' ? 'View →' : 'Track →'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

Object.assign(window, { MyOrdersPage });
