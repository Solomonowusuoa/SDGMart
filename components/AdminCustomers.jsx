const AdminCustomers = ({ isMobile }) => {
  const [search, setSearch] = React.useState('');
  const [query, setQuery] = React.useState({ search: '', sort: 'newest', page: 1 });
  const [refresh, setRefresh] = React.useState(0);
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(q => q.search === search.trim() ? q : { ...q, search: search.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [search]);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const params = new URLSearchParams({ ...query, pageSize: 25 });
    apiFetch('/api/admin/customers?' + params).then(async response => {
      if (!response.ok) throw new Error('Could not load customers. Please try again.');
      return response.json();
    }).then(data => {
      if (!cancelled) {
        if (query.page > 1 && !data.customers.length && data.total > 0) {
          setQuery(q => ({ ...q, page: Math.ceil(data.total / data.pageSize) }));
        } else setResult(data);
      }
    }).catch(e => { if (!cancelled) { setError(e.message); setResult(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, refresh]);
  const date = value => value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const control = { padding: '10px 12px', border: '1px solid var(--cream-dark)', borderRadius: 8, background: 'var(--white)', fontSize: 13 };
  const cell = { padding: '14px 16px', textAlign: 'left' };
  const contact = customer => <><strong>{customer.name || 'Unnamed customer'}</strong><div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 4 }}>Customer #{customer.id}</div><div style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{customer.email || 'No email'}</div><div style={{ marginTop: 4, color: 'var(--warm-gray)' }}>{customer.phone || 'No phone provided'}</div></>;
  return (
    <section aria-labelledby="customers-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h1 id="customers-heading" style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700 }}>Customers</h1>
        <button style={control} disabled={loading} onClick={() => setRefresh(n => n + 1)}>↻ Refresh</button>
      </div>
      <p style={{ color: 'var(--warm-gray)', fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>Everyone currently registered as a customer, including those who have not ordered yet. Spend counts delivered orders only; order counts and last order exclude cancellations.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <input type="search" aria-label="Search customers" placeholder="Search name, email or phone" value={search} maxLength={100}
          onChange={e => setSearch(e.target.value)} style={{ ...control, flex: '1 1 240px', minWidth: 0 }} />
        <select aria-label="Sort customers" value={query.sort} onChange={e => setQuery(q => ({ ...q, sort: e.target.value, page: 1 }))} style={control}>
          <option value="newest">Newest registrations</option><option value="oldest">Oldest registrations</option><option value="name">Name A–Z</option>
        </select>
      </div>
      {error && <div role="alert" style={{ padding: 20, background: '#FFF2EF', borderRadius: 10 }}>{error} <button onClick={() => setRefresh(n => n + 1)} style={{ fontWeight: 700, textDecoration: 'underline' }}>Retry</button></div>}
      {loading && <p role="status" style={{ padding: 20, color: 'var(--warm-gray)' }}>Loading customers…</p>}
      {!loading && !error && result && <>
        <p role="status" style={{ marginBottom: 14, fontSize: 13, color: 'var(--warm-gray)' }}>{result.total} {query.search ? 'matching' : 'registered'} customer{result.total === 1 ? '' : 's'}</p>
        {!result.customers.length ? <div style={{ padding: 30, borderRadius: 12, background: 'var(--cream-dark)', textAlign: 'center' }}>{query.search ? 'No customers match your search.' : 'No customers have registered yet.'}</div> :
          isMobile ? <div style={{ display: 'grid', gap: 12 }}>{result.customers.map(c => <article key={c.id} style={{ padding: 18, borderRadius: 12, background: 'var(--white)', boxShadow: 'var(--shadow)', fontSize: 13 }}>
            {contact(c)}
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: 16 }}>
              <dt>Registered</dt><dd>{date(c.createdAt)}</dd><dt>Orders</dt><dd>{c.orders} ({c.deliveredOrders} delivered)</dd>
              <dt>Delivered spend</dt><dd>GHS {Number(c.totalSpent).toFixed(2)}</dd><dt>Last order</dt><dd>{date(c.lastOrderAt)}</dd>
            </dl>
          </article>)}</div> : <div style={{ overflowX: 'auto', background: 'var(--white)', borderRadius: 12, boxShadow: 'var(--shadow)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'var(--cream-dark)' }}>{['Customer / contact', 'Registered', 'Orders', 'Delivered spend', 'Last order'].map(label => <th key={label} scope="col" style={cell}>{label}</th>)}</tr></thead>
              <tbody>{result.customers.map(c => <tr key={c.id} style={{ borderTop: '1px solid var(--cream-dark)', verticalAlign: 'top' }}>
                <td style={cell}>{contact(c)}</td><td style={{ ...cell, whiteSpace: 'nowrap' }}>{date(c.createdAt)}</td>
                <td style={cell}><strong>{c.orders}</strong><div style={{ color: 'var(--warm-gray)', fontSize: 12, marginTop: 4 }}>{c.deliveredOrders} delivered</div></td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>GHS {Number(c.totalSpent).toFixed(2)}</td><td style={{ ...cell, whiteSpace: 'nowrap' }}>{date(c.lastOrderAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        {result.total > result.pageSize && <nav aria-label="Customer pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
          <button style={control} disabled={query.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>Previous</button>
          <span style={{ fontSize: 13 }}>Page {result.page} of {Math.ceil(result.total / result.pageSize)}</span>
          <button style={control} disabled={query.page * result.pageSize >= result.total} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>Next</button>
        </nav>}
      </>}
    </section>
  );
};
Object.assign(window, { AdminCustomers });
