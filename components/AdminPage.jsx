// AdminPage — full admin dashboard. Auth is now handled at the LoginPage; we
// only get here if the signed-in user has role === 'admin'.
const AdminPage = ({ setPage, onLogout, currentUser, setCurrentUser }) => {
  const [adminTab, setAdminTab] = React.useState('overview');
  const isMobile = useMobile();
  const [products, setProducts] = React.useState(window.PRODUCTS.map(p => ({ ...p })));
  const [orders, setOrders] = React.useState([]);
  const [ordersLoading, setOrdersLoading] = React.useState(false);
  const [newProduct, setNewProduct] = React.useState({ name:'', category: window.CATEGORIES[0], price:'', unit:'', bestBefore:'', stock:'', description:'' });
  const [editingId, setEditingId] = React.useState(null);
  const [editDraft, setEditDraft] = React.useState(null);
  const [smsText, setSmsText] = React.useState('');
  const [smsSent, setSmsSent] = React.useState(false);
  // Force the Security tab to open if a password change is required
  React.useEffect(() => {
    if (currentUser && currentUser.mustChangePassword) setAdminTab('security');
  }, [currentUser]);
  const [pwForm, setPwForm] = React.useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = React.useState({ type: '', text: '' });
  const submitPwChange = async () => {
    setPwMsg({ type: '', text: '' });
    if (pwForm.next !== pwForm.confirm) { setPwMsg({ type: 'err', text: 'Passwords do not match' }); return; }
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok) { setPwMsg({ type: 'err', text: data.error || 'Failed' }); return; }
      // Update stored token + clear mustChangePassword flag locally
      if (setCurrentUser) setCurrentUser(prev => ({ ...prev, token: data.token, mustChangePassword: false }));
      setPwForm({ current: '', next: '', confirm: '' });
      setPwMsg({ type: 'ok', text: '✓ Password changed. All other sessions signed out.' });
    } catch (_) {
      setPwMsg({ type: 'err', text: 'Network error' });
    }
  };

  // Load live data from API on mount.
  React.useEffect(() => {
    apiFetch('/api/products')
      .then(r => r.json())
      .then(data => setProducts(data))
      .catch(() => {});
    setOrdersLoading(true);
    apiFetch('/api/orders')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setOrders((data || []).map(o => ({
          ...o,
          items: Array.isArray(o.items)
            ? o.items.map(i => `${i.name} x${i.qty}`).join(', ')
            : o.items,
          date: o.createdAt ? o.createdAt.slice(0, 10) : '',
        })));
      })
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, []);

  const revenue = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + (o.total || 0), 0);
  const pending = orders.filter(o => o.status === 'Pending').length;
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const stockValue = products.reduce((s, p) => s + p.price * p.stock, 0);
  const expiringSoon = products.filter(p => {
    const d = Math.ceil((new Date(p.bestBefore) - new Date()) / (86400000));
    return d <= 60 && d > 0;
  });

  // Neighborhood route batching (live orders)
  const byNeighborhood = orders.filter(o => o.status === 'Pending').reduce((acc, o) => {
    if (!acc[o.neighborhood]) acc[o.neighborhood] = [];
    acc[o.neighborhood].push(o);
    return acc;
  }, {});

  const statusColor = { 'Delivered': 'var(--sage)', 'Out for Delivery': 'var(--accent-gold)', 'Pending': 'var(--accent-red)' };

  const updateOrderStatus = async (id, status) => {
    try {
      await apiFetch(`/api/orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    } catch (_) {}
  };

  const addProduct = async () => {
    if (!newProduct.name || !newProduct.price) return;
    try {
      const res = await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          ...newProduct,
          price: parseFloat(newProduct.price),
          stock: parseInt(newProduct.stock) || 0,
          bestseller: false,
        }),
      });
      const saved = await res.json();
      setProducts(prev => [...prev, saved]);
      window.PRODUCTS = [...window.PRODUCTS, saved];
    } catch (_) {
      // Fallback: local state only
      const p = { ...newProduct, id: Date.now(), price: parseFloat(newProduct.price), stock: parseInt(newProduct.stock)||0, bestseller: false };
      setProducts(prev => [...prev, p]);
    }
    setNewProduct({ name:'', category: window.CATEGORIES[0], price:'', unit:'', bestBefore:'', stock:'', description:'' });
  };

  const removeProduct = async (id) => {
    try {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    } catch (_) {}
    setProducts(prev => prev.filter(p => p.id !== id));
    window.PRODUCTS = window.PRODUCTS.filter(p => p.id !== id);
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditDraft({
      name: p.name || '',
      category: p.category || window.CATEGORIES[0],
      price: p.price != null ? String(p.price) : '',
      unit: p.unit || '',
      stock: p.stock != null ? String(p.stock) : '',
      bestBefore: p.bestBefore || '',
      description: p.description || '',
      bestseller: !!p.bestseller,
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };
  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    const payload = {
      name: editDraft.name,
      category: editDraft.category,
      price: parseFloat(editDraft.price) || 0,
      unit: editDraft.unit,
      bestBefore: editDraft.bestBefore,
      stock: parseInt(editDraft.stock) || 0,
      description: editDraft.description,
      bestseller: !!editDraft.bestseller,
    };
    try {
      const res = await apiFetch(`/api/products/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const saved = await res.json();
      setProducts(prev => prev.map(p => p.id === editingId ? saved : p));
      window.PRODUCTS = window.PRODUCTS.map(p => p.id === editingId ? saved : p);
    } catch (_) {
      // Optimistic local update if API fails
      setProducts(prev => prev.map(p => p.id === editingId ? { ...p, ...payload } : p));
    }
    cancelEdit();
  };
  const setEditField = (k, v) => setEditDraft(d => ({ ...d, [k]: v }));

  const tabs = [
    ['overview','📊 Overview'],['orders','📦 Orders'],['inventory','🏪 Inventory'],
    ['expiry','⏰ Expiry'],['routes','🗺 Routes'],['comms','📣 Comms'],['metrics','📈 Metrics'],
    ['security','🔐 Security'],
  ];

  const inputS = { width:'100%', padding:'9px 12px', borderRadius:8, border:'1.5px solid var(--cream-dark)', fontSize:13, outline:'none', background:'var(--white)' };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100vh', background: 'var(--cream)' }}>
      {/* Sidebar — desktop */}
      {!isMobile && (
        <aside style={{ width: 220, background: 'var(--sage-dark)', color: '#fff', padding: '24px 0', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
          <div style={{ padding: '0 20px 24px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700 }}>SDGMart Admin</div>
            <div style={{ fontSize: 11, opacity: .6, marginTop: 4 }}>Owner Dashboard</div>
          </div>
          <nav style={{ padding: '12px 12px' }}>
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setAdminTab(id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: adminTab === id ? 700 : 500, background: adminTab === id ? 'rgba(255,255,255,.15)' : 'transparent', color: '#fff', marginBottom: 2, transition: 'background .15s' }}>
                {label}
              </button>
            ))}
          </nav>
          <div style={{ padding: '12px 20px', marginTop: 'auto' }}>
            <button onClick={onLogout || (() => setPage('home'))} style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>🚪 Sign out</button>
          </div>
        </aside>
      )}

      {/* Mobile top nav bar */}
      {isMobile && (
        <div style={{ background: 'var(--sage-dark)', color: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 700 }}>SDGMart Admin</div>
            <button onClick={onLogout || (() => setPage('home'))} style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', fontWeight: 600 }}>🚪 Sign out</button>
          </div>
          <div style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
            <div style={{ display: 'flex', gap: 0, minWidth: 'max-content', padding: '8px 12px' }}>
              {tabs.map(([id, label]) => (
                <button key={id} onClick={() => setAdminTab(id)}
                  style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: adminTab === id ? 700 : 500, background: adminTab === id ? 'rgba(255,255,255,.2)' : 'transparent', color: '#fff', whiteSpace: 'nowrap', transition: 'background .15s' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <main style={{ flex: 1, padding: isMobile ? '16px' : '28px 32px', overflow: 'auto' }}>

        {/* OVERVIEW */}
        {adminTab === 'overview' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Dashboard Overview</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 18, marginBottom: 32 }}>
              {[
                ['Total Revenue', `GHS ${revenue.toFixed(2)}`, '💰', 'var(--sage)'],
                ['Pending Orders', pending, '📦', 'var(--accent-gold)'],
                ['Total Stock Units', totalStock.toLocaleString(), '🏪', 'var(--sage-light)'],
                ['Stock Value', `GHS ${stockValue.toFixed(0)}`, '📊', 'var(--sage-dark)'],
                ['Expiring Soon', expiringSoon.length + ' products', '⏰', 'var(--accent-red)'],
                ['Active Products', products.length, '✅', '#5B7FA6'],
              ].map(([label, val, icon, color]) => (
                <div key={label} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '20px', boxShadow: 'var(--shadow)', borderLeft: `4px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--warm-gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700, marginTop: 6, color }}>{val}</div>
                    </div>
                    <span style={{ fontSize: 24 }}>{icon}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent orders */}
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginBottom: 14 }}>Recent Orders</h2>
            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--cream-dark)' }}>
                    {['Order ID','Customer','Neighborhood','Items','Total','Status','Date'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 12, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={o.id} style={{ borderTop: '1px solid var(--cream-dark)', background: i % 2 === 0 ? 'var(--white)' : 'var(--cream)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--sage-dark)' }}>{o.id}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>{o.customer}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--warm-gray)' }}>{o.neighborhood}</td>
                      <td style={{ padding: '12px 16px', color: 'var(--warm-gray)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.items}</td>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>GHS {o.total.toFixed(2)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ background: `${statusColor[o.status]}22`, color: statusColor[o.status], borderRadius: 20, padding: '3px 10px', fontWeight: 700, fontSize: 11 }}>{o.status}</span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--warm-gray)' }}>{o.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ORDERS */}
        {adminTab === 'orders' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Orders</h1>
            {ordersLoading && <div style={{ color: 'var(--warm-gray)', marginBottom: 16 }}>Loading orders…</div>}
            {orders.length === 0 && !ordersLoading && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--warm-gray)' }}>
                <div style={{ fontSize: 40 }}>📦</div>
                <div style={{ fontWeight: 700, marginTop: 12 }}>No orders yet</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Orders placed through the site will appear here</div>
              </div>
            )}
            {orders.length > 0 && (
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--cream-dark)' }}>
                      {['Order ID','Customer','Neighborhood','Total','Status','Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 12, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <tr key={o.id} style={{ borderTop: '1px solid var(--cream-dark)', background: i%2===0?'var(--white)':'var(--cream)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--sage-dark)' }}>{o.id}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{o.customer}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--warm-gray)' }}>{o.neighborhood}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>GHS {(o.total || 0).toFixed(2)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <select value={o.status}
                            onChange={e => updateOrderStatus(o.id, e.target.value)}
                            style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 10px', border: 'none', background: `${statusColor[o.status] || 'var(--warm-gray)'}22`, color: statusColor[o.status] || 'var(--warm-gray)', cursor: 'pointer' }}>
                            {['Pending','Out for Delivery','Delivered'].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <a href={`https://wa.me/233504082555?text=Update on order ${o.id}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, fontWeight: 700, color: '#25D366' }}>WhatsApp</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* INVENTORY */}
        {adminTab === 'inventory' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Inventory Management</h1>

            {/* Add product form */}
            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)', marginBottom: 28 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 18 }}>Add New Product</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
                {[['name','Product Name','text'],['price','Price (GHS)','number'],['unit','Unit (e.g. 1kg)','text'],['stock','Stock Qty','number'],['bestBefore','Best Before Date','date']].map(([k,label,type]) => (
                  <div key={k}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>{label}</label>
                    <input type={type} value={newProduct[k]} onChange={e => setNewProduct(p => ({...p,[k]:e.target.value}))} style={inputS} />
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>Category</label>
                  <select value={newProduct.category} onChange={e => setNewProduct(p => ({...p,category:e.target.value}))} style={{...inputS,appearance:'none'}}>
                    {window.CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>Description</label>
                  <input value={newProduct.description} onChange={e => setNewProduct(p => ({...p,description:e.target.value}))} style={inputS} placeholder="Short product description" />
                </div>
              </div>
              <button onClick={addProduct} style={{ marginTop: 16, background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '11px 24px', fontWeight: 700, fontSize: 13 }}>+ Add Product</button>
            </div>

            {/* Products list */}
            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>All Products ({products.length})</span>
                <span style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Total Stock Value: <strong>GHS {products.reduce((s,p)=>s+p.price*p.stock,0).toFixed(2)}</strong></span>
              </div>
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--cream-dark)', zIndex: 1 }}>
                    <tr>
                      {['Name','Category','Price','Unit','Stock','Best Before','Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => {
                      const d = Math.ceil((new Date(p.bestBefore) - new Date()) / 86400000);
                      const editing = editingId === p.id;
                      const cellEdit = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', fontSize: 12, outline: 'none', background: 'var(--white)' };
                      if (editing) return (
                        <tr key={p.id} style={{ borderTop: '1px solid var(--cream-dark)', background: 'rgba(232,150,10,.08)' }}>
                          <td style={{ padding: '8px' }}>
                            <input value={editDraft.name} onChange={e => setEditField('name', e.target.value)} style={cellEdit} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <select value={editDraft.category} onChange={e => setEditField('category', e.target.value)} style={cellEdit}>
                              {window.CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input type="number" step="0.01" value={editDraft.price} onChange={e => setEditField('price', e.target.value)} style={{ ...cellEdit, width: 80 }} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input value={editDraft.unit} onChange={e => setEditField('unit', e.target.value)} style={{ ...cellEdit, width: 70 }} placeholder="1kg" />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input type="number" value={editDraft.stock} onChange={e => setEditField('stock', e.target.value)} style={{ ...cellEdit, width: 70 }} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <input type="date" value={editDraft.bestBefore} onChange={e => setEditField('bestBefore', e.target.value)} style={{ ...cellEdit, width: 130 }} />
                          </td>
                          <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                            <button onClick={saveEdit} style={{ fontSize: 11, color: '#fff', fontWeight: 700, background: 'var(--sage)', borderRadius: 6, padding: '5px 10px', marginRight: 6 }}>Save</button>
                            <button onClick={cancelEdit} style={{ fontSize: 11, color: 'var(--warm-gray)', fontWeight: 700, background: 'var(--cream)', borderRadius: 6, padding: '5px 10px' }}>Cancel</button>
                          </td>
                        </tr>
                      );
                      return (
                        <tr key={p.id} style={{ borderTop: '1px solid var(--cream-dark)', background: i%2===0?'var(--white)':'var(--cream)' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.name}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--warm-gray)' }}>{p.category}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 700 }}>GHS {Number(p.price).toFixed(2)}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--warm-gray)' }}>{p.unit}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontWeight: 700, color: p.stock < 10 ? 'var(--accent-red)' : 'var(--warm-black)' }}>{p.stock}</span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ color: d <= 30 ? 'var(--accent-red)' : d <= 60 ? 'var(--accent-gold)' : 'var(--warm-gray)', fontWeight: d <= 60 ? 700 : 400 }}>
                              {p.bestBefore ? new Date(p.bestBefore).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <button onClick={() => startEdit(p)} style={{ fontSize: 11, color: 'var(--sage-dark)', fontWeight: 700, marginRight: 12 }}>Edit</button>
                            <button onClick={() => removeProduct(p.id)} style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 700 }}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* EXPIRY */}
        {adminTab === 'expiry' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Expiry Management</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 24 }}>Products within 60 days of expiry are automatically discounted via Clearance Corner.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
              {expiringSoon.sort((a,b) => new Date(a.bestBefore) - new Date(b.bestBefore)).map(p => {
                const d = Math.ceil((new Date(p.bestBefore) - new Date()) / 86400000);
                const disc = d <= 30 ? 15 : 10;
                return (
                  <div key={p.id} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '18px 20px', boxShadow: 'var(--shadow)', borderLeft: `4px solid ${d <= 30 ? 'var(--accent-red)' : 'var(--accent-gold)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>{p.category} · {p.unit}</div>
                      </div>
                      <span style={{ background: d <= 30 ? 'rgba(192,57,43,.1)' : 'rgba(212,160,23,.15)', color: d <= 30 ? 'var(--accent-red)' : '#8B6914', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                        {d} days
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
                      <span style={{ color: 'var(--warm-gray)' }}>Original: <strong>GHS {p.price.toFixed(2)}</strong></span>
                      <span style={{ color: 'var(--sage-dark)', fontWeight: 700 }}>Clearance: GHS {(p.price*(1-disc/100)).toFixed(2)} (-{disc}%)</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 6 }}>BB: {new Date(p.bestBefore).toLocaleDateString('en-GB')} · Stock: {p.stock}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ROUTES */}
        {adminTab === 'routes' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Route Batching</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 24 }}>Pending orders grouped by neighborhood for efficient delivery routing.</p>
            {Object.entries(byNeighborhood).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--warm-gray)' }}>No pending orders</div>
            ) : Object.entries(byNeighborhood).map(([neighborhood, nOrders]) => (
              <div key={neighborhood} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', boxShadow: 'var(--shadow)', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <h3 style={{ fontWeight: 700, fontSize: 17 }}>📍 {neighborhood}</h3>
                    <div style={{ fontSize: 13, color: 'var(--warm-gray)', marginTop: 2 }}>{nOrders.length} order{nOrders.length > 1 ? 's' : ''} · GHS {nOrders.reduce((s,o)=>s+o.total,0).toFixed(2)} total</div>
                  </div>
                  <button style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 12 }}>Assign Rider</button>
                </div>
                {nOrders.map(o => (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--cream)', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 700 }}>{o.id}</span>
                    <span style={{ color: 'var(--warm-gray)' }}>{o.customer}</span>
                    <span style={{ fontWeight: 700 }}>GHS {o.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* COMMS */}
        {adminTab === 'comms' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Customer Communications</h1>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, alignItems: 'start' }}>
              {/* SMS/Email blast */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)' }}>
                <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Send SMS / WhatsApp Blast</h2>
                <textarea value={smsText} onChange={e => setSmsText(e.target.value)}
                  placeholder="Type your message to all customers..." rows={5}
                  style={{ ...inputS, resize: 'vertical', marginBottom: 14, padding: '12px 14px' }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <a href={`https://wa.me/233504082555?text=${encodeURIComponent(smsText)}`} target="_blank" rel="noreferrer"
                    style={{ flex: 1, background: '#25D366', color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13, textAlign: 'center', textDecoration: 'none' }}>
                    WhatsApp
                  </a>
                  <button onClick={() => { setSmsSent(true); setTimeout(()=>setSmsSent(false),3000); }}
                    style={{ flex: 1, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13 }}>
                    {smsSent ? '✓ Sent!' : 'Send SMS'}
                  </button>
                </div>
              </div>

              {/* Client list */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)' }}>
                <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Customer Info</h2>
                {[...new Set(orders.map(o=>o.customer))].map((c, i) => (
                  <div key={c} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: i%2===0?'var(--cream)':'var(--white)', borderRadius: 8, marginBottom: 4 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c}</div>
                      <div style={{ fontSize: 11, color: 'var(--warm-gray)' }}>{orders.find(o=>o.customer===c)?.neighborhood}</div>
                    </div>
                    <a href={`https://wa.me/233504082555`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, fontWeight: 700, color: '#25D366' }}>WhatsApp</a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* METRICS */}
        {adminTab === 'metrics' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Success Metrics</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
              {[
                { label: 'Viral Growth (Squad Orders)', value: 22, target: 20, unit: '%', icon: '🤝', desc: 'Orders from Group Buying links', color: 'var(--sage)' },
                { label: 'User Retention (30-day)', value: 47, target: 50, unit: '%', icon: '🔄', desc: 'Users returning within 30 days', color: '#5B7FA6' },
                { label: 'Waste Reduction', value: 96, target: 100, unit: '%', icon: '♻️', desc: 'Goods cleared before expiry', color: 'var(--accent-gold)' },
              ].map(m => {
                const pct = Math.min(100, (m.value / m.target) * 100);
                const met = m.value >= m.target;
                return (
                  <div key={m.label} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--warm-gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{m.label}</div>
                        <div style={{ fontFamily: 'var(--font-head)', fontSize: 36, fontWeight: 700, color: met ? m.color : 'var(--warm-black)' }}>{m.value}{m.unit}</div>
                        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>Target: {m.target}{m.unit}</div>
                      </div>
                      <span style={{ fontSize: 28 }}>{m.icon}</span>
                    </div>
                    <div style={{ background: 'var(--cream-dark)', borderRadius: 30, height: 8, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ height: '100%', borderRadius: 30, background: m.color, width: `${pct}%`, transition: 'width 1s ease' }} />
                    </div>
                    <div style={{ fontSize: 12, color: met ? m.color : 'var(--warm-gray)', fontWeight: met ? 700 : 400 }}>
                      {met ? '✓ Target met! ' : `${m.target - m.value}${m.unit} to go · `}{m.desc}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Revenue chart */}
            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)', marginTop: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Revenue (Last 7 Days)</h2>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140 }}>
                {[80,140,95,210,175,220,190].map((v, i) => {
                  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
                  const max = 220;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sage-dark)' }}>GHS {v}</div>
                      <div style={{ width: '100%', background: i===5?'var(--sage)':'var(--sage-light)', borderRadius: '4px 4px 0 0', height: `${(v/max)*100}px`, opacity: i===5?1:.75, transition: 'height .5s' }} />
                      <div style={{ fontSize: 10, color: 'var(--warm-gray)', fontWeight: 600 }}>{days[i]}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SECURITY */}
        {adminTab === 'security' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Security</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 24 }}>Change your password. Changing it signs out every other browser/device immediately.</p>

            {currentUser && currentUser.mustChangePassword && (
              <div style={{ background: 'rgba(232,150,10,.12)', border: '1px solid rgba(232,150,10,.4)', borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
                <strong style={{ color: '#8B6914' }}>⚠️ Default password in use.</strong>
                <span style={{ color: 'var(--warm-gray)', marginLeft: 8, fontSize: 13 }}>Please choose a new password below before doing anything else.</span>
              </div>
            )}

            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px', boxShadow: 'var(--shadow)', maxWidth: 480 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 18 }}>Change Password</h2>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Current Password</label>
              <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', marginBottom: 14, background: 'var(--white)' }} />

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>New Password</label>
              <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', marginBottom: 6, background: 'var(--white)' }} />
              <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginBottom: 14 }}>Min 8 characters, with at least one letter and one number.</div>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }}>Confirm New Password</label>
              <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', marginBottom: 14, background: 'var(--white)' }} />

              {pwMsg.text && (
                <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13,
                  background: pwMsg.type === 'ok' ? 'rgba(78,139,63,.12)' : 'rgba(192,57,43,.08)',
                  color: pwMsg.type === 'ok' ? 'var(--sage-dark)' : 'var(--accent-red)' }}>
                  {pwMsg.text}
                </div>
              )}

              <button onClick={submitPwChange}
                style={{ background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '12px 24px', fontWeight: 700, fontSize: 14 }}>
                Change Password
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

Object.assign(window, { AdminPage });
