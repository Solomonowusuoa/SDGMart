// ── Tiny dependency-free charts (inline SVG) ─────────────────────────────
// Bars chart: array of { date|name, value }. Highlights the max bar.
const MiniBars = ({ data, height = 120, color = '#1A1A1A', valueFmt }) => {
  if (!data || !data.length) return <div style={{ fontSize: 13, color: 'var(--warm-gray)', padding: 20 }}>No data yet.</div>;
  const max = Math.max(1, ...data.map(d => d.value));
  const W = 100, barGap = 1.5;
  const bw = (W - barGap * (data.length - 1)) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${height / 3}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height / 3);
        const x = i * (bw + barGap);
        return <rect key={i} x={x} y={(height / 3) - h} width={bw} height={h} rx={0.6}
          fill={d.value === max ? color : '#C9C4BA'}>
          <title>{(d.date || d.name) + ': ' + (valueFmt ? valueFmt(d.value) : d.value)}</title>
        </rect>;
      })}
    </svg>
  );
};

// Horizontal ranked list with proportional bars
const RankBars = ({ data, color = '#1A1A1A', valueFmt }) => {
  if (!data || !data.length) return <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>No data yet.</div>;
  const max = Math.max(1, ...data.map(d => d.qty != null ? d.qty : d.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d, i) => {
        const v = d.qty != null ? d.qty : d.value;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 130, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
            <div style={{ flex: 1, background: 'var(--cream-dark)', borderRadius: 4, height: 18, position: 'relative', overflow: 'hidden' }}>
              <div style={{ width: `${(v / max) * 100}%`, background: color, height: '100%', borderRadius: 4 }} />
            </div>
            <div style={{ width: 46, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{valueFmt ? valueFmt(v) : v}</div>
          </div>
        );
      })}
    </div>
  );
};

const StatCard = ({ label, value, sub, accent }) => (
  <div style={{ background: 'var(--white)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--shadow)', borderTop: `3px solid ${accent || '#1A1A1A'}` }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>{sub}</div>}
  </div>
);

// AdminPage — full admin dashboard. Auth is now handled at the LoginPage; we
// only get here if the signed-in user has role === 'admin'.
const AdminPage = ({ setPage, onLogout, currentUser, setCurrentUser }) => {
  const [adminTab, setAdminTab] = React.useState('overview');
  const isMobile = useMobile();
  const [products, setProducts] = React.useState(window.PRODUCTS.map(p => ({ ...p })));
  const [orders, setOrders] = React.useState([]);
  const [ordersLoading, setOrdersLoading] = React.useState(false);
  const [newProduct, setNewProduct] = React.useState({ name:'', category: window.CATEGORIES[0], price:'', unit:'', bestBefore:'', stock:'', description:'', img:'' });
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);
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

  // ── CSV export (Excel-openable) ──
  // Quotes every cell + escapes embedded quotes, prepends a UTF-8 BOM so
  // Excel reads accents/symbols correctly. Triggers a file download.
  const exportCSV = (filename, headers, rows) => {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [headers.map(esc).join(',')];
    rows.forEach(r => lines.push(r.map(esc).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const exportSales = () => {
    const headers = ['Order ID','Date','Status','Customer','Phone','Neighborhood','Items','Item Count','Subtotal (GHS)','Discount (GHS)','Loyalty Used (GHS)','Delivery (GHS)','Total (GHS)','Payment','Priority'];
    const rows = orders.map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itemStr = items.map(i => `${i.qty || 1}x ${i.name}`).join('; ');
      return [
        o.id,
        o.createdAt ? new Date(o.createdAt).toLocaleString('en-GB') : '',
        o.status || '',
        o.customerName || o.customer || '',
        o.customerPhone || o.phone || '',
        o.neighborhood || '',
        itemStr,
        items.length,
        Number(o.subtotal || 0).toFixed(2),
        Number(o.discount || 0).toFixed(2),
        Number(o.loyaltyUsed || 0).toFixed(2),
        Number(o.deliveryFee != null ? o.deliveryFee : o.delivery || 0).toFixed(2),
        Number(o.total || 0).toFixed(2),
        o.paymentMethod || o.payMethod || '',
        o.priority ? 'Yes' : 'No',
      ];
    });
    exportCSV(`SDGMart-sales-${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
  };

  const exportInventory = () => {
    const headers = ['Product ID','Name','Category','Unit','Price (GHS)','Stock','Low-Stock Alert','Stock Value (GHS)','Best Before','Bestseller'];
    const rows = products.map(p => [
      p.id, p.name, p.category, p.unit || '',
      Number(p.price || 0).toFixed(2),
      p.stock != null ? p.stock : 0,
      p.lowStockThreshold != null ? p.lowStockThreshold : 5,
      (Number(p.price || 0) * Number(p.stock || 0)).toFixed(2),
      p.bestBefore || '',
      p.bestseller ? 'Yes' : 'No',
    ]);
    exportCSV(`SDGMart-inventory-${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
  };
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
    loadOrders();
  }, []);

  const loadOrders = React.useCallback(() => {
    setOrdersLoading(true);
    apiFetch('/api/orders')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setOrders((data || []).map(o => ({
          ...o,
          // Keep items as the raw array — the Orders tab UI needs it
          items: Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch (_) { return []; } })() : []),
          date: o.createdAt ? String(o.createdAt).slice(0, 10) : '',
        })));
      })
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, []);

  // Status checks support both legacy capitalised and new lowercase enum values
  const isDelivered = (s) => s === 'delivered' || s === 'Delivered';
  const isPending = (s) => s === 'queued' || s === 'pending' || s === 'Pending';
  const revenue = orders.filter(o => isDelivered(o.status)).reduce((s, o) => s + (Number(o.total) || 0), 0);
  const pending = orders.filter(o => isPending(o.status)).length;
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const stockValue = products.reduce((s, p) => s + p.price * p.stock, 0);
  const expiringSoon = products.filter(p => {
    const d = Math.ceil((new Date(p.bestBefore) - new Date()) / (86400000));
    return d <= 60 && d > 0;
  });

  // Neighborhood route batching (live orders)
  const byNeighborhood = orders.filter(o => isPending(o.status)).reduce((acc, o) => {
    if (!acc[o.neighborhood]) acc[o.neighborhood] = [];
    acc[o.neighborhood].push(o);
    return acc;
  }, {});

  // Status palette covers both the new lowercase enum (queued/assigned/in_transit/delivered/cancelled)
  // and the legacy capitalised values left over from earlier orders.
  const statusColor = {
    queued: '#C8923A', assigned: '#3879BF', in_transit: '#1A1A1A', delivered: '#1A1A1A', cancelled: '#888',
    Pending: '#C8923A', 'Out for Delivery': '#1A1A1A', Delivered: '#1A1A1A',
  };
  const statusLabel = {
    queued: 'Queued', assigned: 'Assigned', in_transit: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  };
  const STATUS_OPTIONS = ['queued','assigned','in_transit','delivered','cancelled'];

  const updateOrderStatus = async (id, status) => {
    try {
      await apiFetch(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    } catch (_) {}
  };

  const deleteOrder = async (id) => {
    if (!window.confirm(`Permanently delete order ${window.orderCode(id)}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/orders/${id}`, { method: 'DELETE' });
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (_) {}
  };

  // Orders tab filter + search state
  const [orderFilter, setOrderFilter] = React.useState('all');
  const [orderSearch, setOrderSearch] = React.useState('');
  const [orderDetail, setOrderDetail] = React.useState(null); // currently expanded order id

  const filteredOrders = React.useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter(o => {
      if (orderFilter !== 'all') {
        const s = String(o.status || '').toLowerCase();
        // Match both 'pending' (legacy) and 'queued'
        if (orderFilter === 'queued' && !(s === 'queued' || s === 'pending')) return false;
        if (orderFilter !== 'queued' && s !== orderFilter) return false;
      }
      if (!q) return true;
      return String(o.id).toLowerCase().includes(q)
        || String(o.customerName || o.customer || '').toLowerCase().includes(q)
        || String(o.customerPhone || o.phone || '').toLowerCase().includes(q)
        || String(o.neighborhood || '').toLowerCase().includes(q);
    });
  }, [orders, orderFilter, orderSearch]);

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
    setNewProduct({ name:'', category: window.CATEGORIES[0], price:'', unit:'', bestBefore:'', stock:'', description:'', img:'' });
  };

  // Downscale + re-encode an image in the browser before upload. Caps the
  // longest edge at maxEdge px and re-encodes as JPEG, shrinking a typical
  // phone photo (2-5 MB) to ~80-150 KB. Saves Supabase storage + egress.
  const compressImage = (file, maxEdge = 900, quality = 0.82) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxEdge || height > maxEdge) {
          if (width >= height) { height = Math.round(height * maxEdge / width); width = maxEdge; }
          else { width = Math.round(width * maxEdge / height); height = maxEdge; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        // White backdrop so transparent PNGs don't turn black as JPEG
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // Shared photo-upload helper: compress in-browser → POST → returns URL
  const uploadPhoto = async (file) => {
    if (!file) return null;
    if (!/^image\//.test(file.type)) { alert('Please choose an image file.'); return null; }
    setUploadingPhoto(true);
    try {
      let dataUrl;
      try {
        dataUrl = await compressImage(file);
      } catch (_) {
        // Fallback: send the original if canvas compression fails, with a size guard
        if (file.size > 1.5 * 1024 * 1024) { alert('Image too large and could not be compressed. Try a smaller photo.'); return null; }
        dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      }
      const r = await apiFetch('/api/admin/upload-image', { method: 'POST', body: JSON.stringify({ dataUrl }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Upload failed'); return null; }
      return d.url;
    } finally { setUploadingPhoto(false); }
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
      lowStockThreshold: p.lowStockThreshold != null ? String(p.lowStockThreshold) : '5',
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
      lowStockThreshold: editDraft.lowStockThreshold !== '' && editDraft.lowStockThreshold != null ? parseInt(editDraft.lowStockThreshold) : 5,
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
    ['overview','📊 Overview'],['dashboard','📈 Dashboard'],['orders','📦 Orders'],['inventory','🏪 Inventory'],
    ['expiry','⏰ Expiry'],['routes','🗺 Routes'],['riders','🛵 Riders'],
    ['promotions','⚡ Promotions'],['requests','🛒 Requests'],['issues','🚨 Issues'],
    ['analytics','🔎 Analytics'],['leaderboard','🏆 Leaderboard'],['comms','📣 Comms'],
    ['errors','🐞 Errors'],['settings','⚙️ Settings'],['security','🔐 Security'],
  ];

  // ── Dashboard / metrics state ──
  const [metrics, setMetrics] = React.useState(null);
  const [metricsDays, setMetricsDays] = React.useState(30);
  const loadMetrics = React.useCallback(() => {
    apiFetch(`/api/admin/metrics?days=${metricsDays}`).then(r => r.ok ? r.json() : null).then(setMetrics).catch(() => {});
  }, [metricsDays]);
  React.useEffect(() => { if (adminTab === 'dashboard') loadMetrics(); }, [adminTab, loadMetrics]);

  // ── Leaderboard state ──
  const [leaders, setLeaders] = React.useState([]);
  const loadLeaders = React.useCallback(() => {
    apiFetch('/api/admin/leaderboard?limit=15').then(r => r.ok ? r.json() : []).then(setLeaders).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'leaderboard') loadLeaders(); }, [adminTab, loadLeaders]);

  // ── Errors state ──
  const [errorLogs, setErrorLogs] = React.useState([]);
  const loadErrors = React.useCallback(() => {
    apiFetch('/api/admin/errors').then(r => r.ok ? r.json() : []).then(setErrorLogs).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'errors') loadErrors(); }, [adminTab, loadErrors]);

  // ── Settings tab state ──
  const [settings, setSettings] = React.useState({ showFreshness: false });
  const [settingsSaved, setSettingsSaved] = React.useState('');
  const loadSettings = React.useCallback(() => {
    apiFetch('/api/admin/settings').then(r => r.ok ? r.json() : {}).then(s => setSettings({ showFreshness: !!s.showFreshness })).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'settings') loadSettings(); }, [adminTab, loadSettings]);
  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await apiFetch('/api/admin/settings', { method: 'POST', body: JSON.stringify(patch) });
    setSettingsSaved('Saved — reload the storefront to see changes');
    setTimeout(() => setSettingsSaved(''), 3000);
  };

  // ── Promotions tab state ──
  const [promos, setPromos] = React.useState([]);
  const [newPromo, setNewPromo] = React.useState({ title: '', description: '', productIds: [], discountPercent: 15, startsAt: '', endsAt: '' });
  const loadPromos = React.useCallback(() => {
    apiFetch('/api/admin/promotions').then(r => r.ok ? r.json() : []).then(setPromos).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'promotions') loadPromos(); }, [adminTab, loadPromos]);

  // ── Product requests tab state ──
  const [requests, setRequests] = React.useState([]);
  const [reqFilter, setReqFilter] = React.useState('new');
  const loadRequests = React.useCallback(() => {
    const q = reqFilter === 'all' ? '' : `?status=${reqFilter}`;
    apiFetch('/api/admin/product-requests' + q).then(r => r.ok ? r.json() : []).then(setRequests).catch(() => {});
  }, [reqFilter]);
  React.useEffect(() => { if (adminTab === 'requests') loadRequests(); }, [adminTab, loadRequests]);
  const updateRequest = async (id, patch) => {
    await apiFetch(`/api/admin/product-requests/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    loadRequests();
  };

  // ── Issues tab state ──
  const [issues, setIssues] = React.useState([]);
  const loadIssues = React.useCallback(() => {
    apiFetch('/api/admin/issue-reports').then(r => r.ok ? r.json() : []).then(setIssues).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'issues') loadIssues(); }, [adminTab, loadIssues]);
  const resolveIssue = async (id) => {
    const note = window.prompt('Resolution note (optional):') || '';
    await apiFetch(`/api/admin/issue-reports/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ note }) });
    loadIssues();
  };

  // Payments tab — admin sets per-telco merchant numbers shown to customers at checkout
  const [momoCfg, setMomoCfg] = React.useState({ mtn: '', telecel: '', at: '', name: '' });
  const [momoSavedAt, setMomoSavedAt] = React.useState('');
  const loadMomo = React.useCallback(() => {
    fetch('/api/momo/numbers').then(r => r.ok ? r.json() : {}).then(d => setMomoCfg({ mtn: d.mtn || '', telecel: d.telecel || '', at: d.at || '', name: d.name || '' })).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'payments') loadMomo(); }, [adminTab, loadMomo]);
  const saveMomo = async () => {
    const r = await apiFetch('/api/admin/momo/numbers', { method: 'POST', body: JSON.stringify(momoCfg) });
    if (r.ok) { setMomoSavedAt(new Date().toLocaleTimeString()); setTimeout(() => setMomoSavedAt(''), 2500); }
  };

  // Search analytics state — only loaded when the tab opens
  const [topQueries, setTopQueries] = React.useState(null);
  const [unmatched, setUnmatched] = React.useState(null);
  const [analyticsDays, setAnalyticsDays] = React.useState(30);
  const loadAnalytics = React.useCallback(() => {
    apiFetch(`/api/admin/search/top?days=${analyticsDays}`).then(r => r.ok ? r.json() : []).then(setTopQueries).catch(() => setTopQueries([]));
    apiFetch(`/api/admin/search/unmatched?days=${analyticsDays}`).then(r => r.ok ? r.json() : []).then(setUnmatched).catch(() => setUnmatched([]));
  }, [analyticsDays]);
  React.useEffect(() => { if (adminTab === 'analytics') loadAnalytics(); }, [adminTab, loadAnalytics]);

  // Riders tab state
  const [riders, setRiders] = React.useState([]);
  const [newRider, setNewRider] = React.useState({ name: '', email: '', phone: '', password: '' });
  const [riderErr, setRiderErr] = React.useState('');
  const loadRiders = React.useCallback(() => {
    apiFetch('/api/admin/riders').then(r => r.ok ? r.json() : []).then(setRiders).catch(() => {});
  }, []);
  React.useEffect(() => { if (adminTab === 'riders') { loadRiders(); const t = setInterval(loadRiders, 10000); return () => clearInterval(t); } }, [adminTab, loadRiders]);
  // Riders are also needed in the Orders tab for manual assignment
  React.useEffect(() => { if (adminTab === 'orders') loadRiders(); }, [adminTab, loadRiders]);

  const assignOrderToRider = async (orderId, riderId) => {
    await apiFetch(`/api/admin/orders/${orderId}/assign`, { method: 'POST', body: JSON.stringify({ riderId: riderId || null }) });
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, riderId: riderId || null, status: riderId ? 'assigned' : 'queued' } : o));
  };
  const createRider = async () => {
    setRiderErr('');
    if (!newRider.name || !newRider.email || !newRider.password) { setRiderErr('Name, email and password required'); return; }
    const r = await apiFetch('/api/admin/riders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRider) });
    const d = await r.json();
    if (!r.ok) { setRiderErr(d.error || 'Failed to create rider'); return; }
    setNewRider({ name: '', email: '', phone: '', password: '' });
    loadRiders();
  };

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
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700 }}>Orders</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
                  Showing <strong>{filteredOrders.length}</strong> of {orders.length} total
                </span>
                <button onClick={exportSales} disabled={orders.length === 0}
                  style={{ fontSize: 12, fontWeight: 700, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '8px 14px', opacity: orders.length === 0 ? .5 : 1 }}>
                  ⬇ Export to Excel
                </button>
              </div>
            </div>

            {/* Filter chips + search */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
              {[['all','All'],['queued','Queued'],['assigned','Assigned'],['in_transit','Out for delivery'],['delivered','Delivered'],['cancelled','Cancelled']].map(([k, label]) => (
                <button key={k} onClick={() => setOrderFilter(k)}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999,
                    background: orderFilter === k ? 'var(--sage)' : 'var(--cream)',
                    color: orderFilter === k ? '#fff' : 'var(--warm-gray)',
                    border: orderFilter === k ? 'none' : '1px solid var(--cream-dark)',
                  }}>{label}</button>
              ))}
              <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)}
                placeholder="Search by ID, name, phone, or area…"
                style={{ flex: 1, minWidth: 180, padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 13, outline: 'none', background: 'var(--white)' }} />
              <button onClick={loadOrders} title="Refresh"
                style={{ background: 'var(--cream)', color: 'var(--warm-gray)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 12 }}>↻</button>
            </div>

            {ordersLoading && <div style={{ color: 'var(--warm-gray)', marginBottom: 16 }}>Loading orders…</div>}
            {filteredOrders.length === 0 && !ordersLoading && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--warm-gray)' }}>
                <div style={{ fontSize: 40 }}>📦</div>
                <div style={{ fontWeight: 700, marginTop: 12 }}>{orders.length === 0 ? 'No orders yet' : 'No orders match your filter'}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  {orders.length === 0 ? 'Orders placed through the site will appear here' : 'Try a different filter or clear the search'}
                </div>
              </div>
            )}

            {filteredOrders.length > 0 && (
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {filteredOrders.map((o, i) => {
                  const expanded = String(orderDetail) === String(o.id);
                  const statusKey = String(o.status || 'queued').toLowerCase();
                  const itemsArr = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch (_) { return []; } })() : []);
                  return (
                    <div key={o.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--cream-dark)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--sage-dark)' }}>{window.orderCode(o.id)}</span>
                            <span style={{ background: `${statusColor[statusKey] || 'var(--warm-gray)'}22`, color: statusColor[statusKey] || 'var(--warm-gray)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                              {statusLabel[statusKey] || o.status}
                            </span>
                            {o.priority && <span style={{ background: '#FFF4E0', color: '#7A5A00', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>⭐ Priority</span>}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-gray)' }}>
                            {o.customerName || o.customer || '—'} · {o.customerPhone || o.phone || 'no phone'} · {o.neighborhood || '—'}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 11, color: 'var(--warm-gray)' }}>
                            {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
                            {o.deliveryDate ? ` · delivery ${o.deliveryDate}` : ''}
                            · {itemsArr.length} item{itemsArr.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14, minWidth: 100, textAlign: 'right' }}>GHS {Number(o.total || 0).toFixed(2)}</div>
                        {/* Rider assignment — only meaningful before delivery/cancel */}
                        {!['delivered','cancelled'].includes(statusKey) && (
                          <select value={o.riderId || ''} onChange={e => assignOrderToRider(o.id, e.target.value ? parseInt(e.target.value) : null)}
                            title="Assign a rider"
                            style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '6px 10px', border: `1px solid ${o.riderId ? 'var(--sage)' : '#C8923A'}`, background: o.riderId ? 'rgba(0,0,0,.03)' : '#FFF8E8' }}>
                            <option value="">🛵 Unassigned</option>
                            {riders.map(r => <option key={r.id} value={r.id}>{r.name}{r.online ? ' 🟢' : ''}</option>)}
                          </select>
                        )}
                        <select value={statusKey} onChange={e => updateOrderStatus(o.id, e.target.value)}
                          style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '6px 10px', border: '1px solid var(--cream-dark)', background: 'var(--white)' }}>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusLabel[s] || s}</option>)}
                        </select>
                        <button onClick={() => setOrderDetail(expanded ? null : o.id)}
                          style={{ fontSize: 11, fontWeight: 700, color: 'var(--sage-dark)', background: 'var(--cream)', borderRadius: 8, padding: '6px 10px' }}>
                          {expanded ? 'Hide ▴' : 'Details ▾'}
                        </button>
                        <a href={`https://wa.me/${String(o.customerPhone || o.phone || '233504082555').replace(/\D/g,'').replace(/^0/, '233')}?text=${encodeURIComponent(`Hi ${o.customerName || o.customer || ''}, regarding your SDGMart order ${window.orderCode(o.id)} —`)}`}
                          target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, fontWeight: 700, color: '#25D366', padding: '6px 4px' }}>WhatsApp</a>
                        <button onClick={() => deleteOrder(o.id)} title="Delete order"
                          style={{ fontSize: 14, color: 'var(--accent-red)', background: 'transparent', padding: '6px 4px' }}>🗑</button>
                      </div>
                      {expanded && (
                        <div style={{ padding: '0 18px 18px', background: 'var(--cream)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, paddingTop: 14 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Address</div>
                              <div style={{ fontSize: 13 }}>{(o.location && o.location.address) || o.address || o.recipientAddress || '—'}</div>
                              {o.location && o.location.lat && (
                                <a href={`https://www.google.com/maps?q=${o.location.lat},${o.location.lng}`} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 700, marginTop: 4, display: 'inline-block' }}>📍 Open in Maps</a>
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Payment</div>
                              <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span>{o.paymentMethod || o.payMethod || 'cash'}</span>
                                {o.paid
                                  ? <span style={{ background: '#1A1A1A', color: '#fff', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>✓ PAID</span>
                                  : <span style={{ background: '#FFF4E0', color: '#7A5A00', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>COLLECT ON DELIVERY</span>}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Breakdown</div>
                              <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Subtotal GHS {Number(o.subtotal || 0).toFixed(2)}</div>
                              {Number(o.discount || 0) > 0 && <div style={{ fontSize: 13, color: 'var(--sage)' }}>Squad discount −GHS {Number(o.discount).toFixed(2)}</div>}
                              {Number(o.loyaltyUsed || 0) > 0 && <div style={{ fontSize: 13, color: '#7A5A00' }}>Loyalty −GHS {Number(o.loyaltyUsed).toFixed(2)}</div>}
                              <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Delivery GHS {Number(o.deliveryFee || o.delivery || 0).toFixed(2)}</div>
                            </div>
                          </div>
                          {/* Surprise extra — admin can attach a free gift / note that the customer sees on their order */}
                          <div style={{ marginTop: 14, padding: '10px 12px', background: '#FCE4F0', border: '1px solid #F4A8C8', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#9B2D60', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>🎁 Surprise extra (free gift / handwritten note)</div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input defaultValue={o.surpriseExtra || ''} placeholder="e.g. Free Fan Ice on a hot day — enjoy!"
                                onBlur={async (e) => {
                                  const v = e.target.value;
                                  if (v === (o.surpriseExtra || '')) return;
                                  await apiFetch(`/api/admin/orders/${o.id}/surprise`, { method: 'POST', body: JSON.stringify({ note: v }) });
                                  o.surpriseExtra = v; // optimistic
                                }}
                                style={{ flex: 1, minWidth: 220, padding: '8px 12px', borderRadius: 6, border: '1px solid #F4A8C8', background: '#fff', fontSize: 13, outline: 'none' }} />
                              <span style={{ fontSize: 11, color: '#9B2D60' }}>Saves on blur</span>
                            </div>
                          </div>

                          {itemsArr.length > 0 && (
                            <div style={{ marginTop: 14 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Items</div>
                              <div style={{ background: 'var(--white)', borderRadius: 8, overflow: 'hidden' }}>
                                {itemsArr.map((it, idx) => (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderTop: idx === 0 ? 'none' : '1px solid var(--cream-dark)', fontSize: 13 }}>
                                    <span>{it.qty || 1}× {it.name}</span>
                                    <span style={{ fontWeight: 700 }}>GHS {(Number(it.price || 0) * Number(it.qty || 1)).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Photo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {newProduct.img && <img src={newProduct.img} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--cream-dark)' }} />}
                    <label style={{ background: 'var(--cream)', color: 'var(--sage-dark)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      {uploadingPhoto ? 'Uploading…' : (newProduct.img ? 'Replace photo' : '📷 Upload photo')}
                      <input type="file" accept="image/*" hidden disabled={uploadingPhoto}
                        onChange={async e => { const url = await uploadPhoto(e.target.files[0]); if (url) setNewProduct(p => ({ ...p, img: url })); e.target.value = ''; }} />
                    </label>
                    {newProduct.img && (
                      <button onClick={() => setNewProduct(p => ({ ...p, img: '' }))} style={{ fontSize: 12, color: 'var(--accent-red)', fontWeight: 700 }}>Remove</button>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--warm-gray)' }}>JPG or PNG, max 1.5 MB</span>
                  </div>
                </div>
              </div>
              <button onClick={addProduct} style={{ marginTop: 16, background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '11px 24px', fontWeight: 700, fontSize: 13 }}>+ Add Product</button>
            </div>

            {/* Products list */}
            {/* Low-stock alert banner */}
            {(() => {
              const lowStock = products.filter(p => Number(p.stock || 0) <= Number(p.lowStockThreshold != null ? p.lowStockThreshold : 5));
              if (lowStock.length === 0) return null;
              return (
                <div style={{ background: '#FFF4E0', border: '1px solid #F0C674', borderRadius: 12, padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 22 }}>⚠️</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#7A5A00', fontSize: 14 }}>
                      {lowStock.length} product{lowStock.length === 1 ? ' is' : 's are'} low on stock
                    </div>
                    <div style={{ fontSize: 12, color: '#7A5A00', marginTop: 4, opacity: .85 }}>
                      {lowStock.slice(0, 5).map(p => `${p.name} (${p.stock})`).join(' · ')}{lowStock.length > 5 ? ` · +${lowStock.length - 5} more` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#7A5A00', marginTop: 6, opacity: .7 }}>
                      Edit any product below to adjust its custom low-stock threshold (default: 5)
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>All Products ({products.length})</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Total Stock Value: <strong>GHS {products.reduce((s,p)=>s+p.price*p.stock,0).toFixed(2)}</strong></span>
                  <button onClick={exportInventory}
                    style={{ fontSize: 12, fontWeight: 700, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '7px 12px' }}>
                    ⬇ Export to Excel
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--cream-dark)', zIndex: 1 }}>
                    <tr>
                      {['Name','Category','Price','Unit','Stock','Alert ≤','Best Before','Actions'].map(h => (
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
                            <input type="number" min="0" value={editDraft.lowStockThreshold} onChange={e => setEditField('lowStockThreshold', e.target.value)}
                              title="Show low-stock alert when units drop to this number or below"
                              style={{ ...cellEdit, width: 60 }} />
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
                            {(() => {
                              const th = p.lowStockThreshold != null ? p.lowStockThreshold : 5;
                              const isLow = Number(p.stock || 0) <= Number(th);
                              return (
                                <span style={{ fontWeight: 700, color: isLow ? 'var(--accent-red)' : 'var(--warm-black)' }}>
                                  {p.stock}{isLow && p.stock > 0 ? ' ⚠' : ''}{p.stock === 0 ? ' (sold out)' : ''}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--warm-gray)', fontSize: 12 }}>
                            {p.lowStockThreshold != null ? p.lowStockThreshold : 5}
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

        {/* ANALYTICS — search query insights */}
        {adminTab === 'analytics' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700 }}>Search Analytics</h1>
              <div style={{ display: 'flex', gap: 6 }}>
                {[7, 30, 90].map(d => (
                  <button key={d} onClick={() => setAnalyticsDays(d)}
                    style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: analyticsDays === d ? 'var(--sage)' : 'var(--cream)', color: analyticsDays === d ? '#fff' : 'var(--warm-gray)' }}>
                    Last {d} days
                  </button>
                ))}
                <button onClick={loadAnalytics} title="Refresh"
                  style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: 'var(--cream)', color: 'var(--warm-gray)' }}>↻</button>
              </div>
            </div>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 24 }}>
              What customers are searching for. <strong>Unmatched</strong> queries (zero results) are the highest-signal — they tell you what products to stock next.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
              {/* Top queries */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🔝</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>Top searches</span>
                </div>
                {topQueries === null ? (
                  <div style={{ padding: '20px', color: 'var(--warm-gray)', fontSize: 13 }}>Loading…</div>
                ) : topQueries.length === 0 ? (
                  <div style={{ padding: '20px', color: 'var(--warm-gray)', fontSize: 13 }}>No searches in this window yet.</div>
                ) : (
                  <div>
                    {topQueries.map((q, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--cream-dark)', fontSize: 13 }}>
                        <span style={{ flex: 1 }}>{i + 1}. <strong>{q.query}</strong></span>
                        <span style={{ background: 'var(--cream)', color: 'var(--warm-gray)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{q.count}×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Unmatched queries */}
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🚫</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>Unmatched searches</span>
                  <span style={{ fontSize: 11, color: 'var(--warm-gray)', marginLeft: 'auto' }}>(zero results)</span>
                </div>
                {unmatched === null ? (
                  <div style={{ padding: '20px', color: 'var(--warm-gray)', fontSize: 13 }}>Loading…</div>
                ) : unmatched.length === 0 ? (
                  <div style={{ padding: '20px', color: 'var(--warm-gray)', fontSize: 13 }}>Nice — every search found something!</div>
                ) : (
                  <div>
                    {unmatched.map((q, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--cream-dark)', fontSize: 13 }}>
                        <span style={{ flex: 1 }}>{i + 1}. <strong>{q.query}</strong></span>
                        <span style={{ background: 'rgba(192,57,43,.1)', color: 'var(--accent-red)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{q.count} miss{q.count === 1 ? '' : 'es'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PROMOTIONS — flash sales / weekly drops */}
        {adminTab === 'promotions' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Promotions</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 20 }}>Create flash sales. Customers see a banner + sale badges on featured products. When you publish, every push subscriber gets a notification.</p>

            <div style={{ background: 'var(--white)', borderRadius: 12, padding: '20px 22px', boxShadow: 'var(--shadow)', marginBottom: 22 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, marginBottom: 14 }}>New promotion</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                <input value={newPromo.title} onChange={e => setNewPromo(p => ({ ...p, title: e.target.value }))} placeholder="Title (e.g. Friday Drop)" style={inputS} />
                <input type="number" min="1" max="90" value={newPromo.discountPercent} onChange={e => setNewPromo(p => ({ ...p, discountPercent: e.target.value }))} placeholder="Discount %" style={inputS} />
                <input type="datetime-local" value={newPromo.startsAt} onChange={e => setNewPromo(p => ({ ...p, startsAt: e.target.value }))} style={inputS} />
                <input type="datetime-local" value={newPromo.endsAt} onChange={e => setNewPromo(p => ({ ...p, endsAt: e.target.value }))} style={inputS} />
                <input value={newPromo.description} onChange={e => setNewPromo(p => ({ ...p, description: e.target.value }))} placeholder="Short description" style={{ ...inputS, gridColumn: '1/-1' }} />
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Products on sale (Ctrl+click to multi-select)</label>
                  <select multiple value={newPromo.productIds.map(String)} onChange={e => setNewPromo(p => ({ ...p, productIds: Array.from(e.target.selectedOptions).map(o => parseInt(o.value)) }))}
                    style={{ ...inputS, height: 140 }}>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} — GHS {Number(p.price).toFixed(2)}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={async () => {
                if (!newPromo.title || !newPromo.startsAt || !newPromo.endsAt) { alert('Title, start, and end are required'); return; }
                const r = await apiFetch('/api/admin/promotions', { method: 'POST', body: JSON.stringify({
                  ...newPromo,
                  startsAt: new Date(newPromo.startsAt).toISOString(),
                  endsAt: new Date(newPromo.endsAt).toISOString(),
                })});
                if (!r.ok) { const d = await r.json(); alert(d.error || 'Failed'); return; }
                setNewPromo({ title: '', description: '', productIds: [], discountPercent: 15, startsAt: '', endsAt: '' });
                loadPromos();
              }} style={{ marginTop: 14, background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '11px 24px', fontWeight: 700, fontSize: 13 }}>
                Save as draft
              </button>
            </div>

            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, marginBottom: 12 }}>All promotions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {promos.length === 0 ? (
                <div style={{ color: 'var(--warm-gray)', fontSize: 13, padding: 20, background: 'var(--cream)', borderRadius: 10, textAlign: 'center' }}>No promotions yet.</div>
              ) : promos.map(p => {
                const now = new Date();
                const live = p.published && new Date(p.startsAt) <= now && new Date(p.endsAt) >= now;
                return (
                  <div key={p.id} style={{ background: 'var(--white)', borderRadius: 10, padding: '14px 16px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14 }}>{p.title}</strong>
                        <span style={{ background: '#E03A2B', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>-{p.discountPercent}%</span>
                        {live && <span style={{ background: 'var(--sage)', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>LIVE</span>}
                        {p.published && !live && <span style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{new Date(p.startsAt) > now ? 'SCHEDULED' : 'ENDED'}</span>}
                        {!p.published && <span style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>DRAFT</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 4 }}>
                        {Array.isArray(p.productIds) ? p.productIds.length : 0} product{(p.productIds || []).length === 1 ? '' : 's'} · {new Date(p.startsAt).toLocaleString()} → {new Date(p.endsAt).toLocaleString()}
                      </div>
                      {Array.isArray(p.productIds) && p.productIds.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--warm-black)', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {p.productIds.map(pid => {
                            const prod = products.find(x => x.id === pid);
                            return <span key={pid} style={{ background: 'var(--cream)', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>{prod ? prod.name : '#' + pid}</span>;
                          })}
                        </div>
                      )}
                      {p.pushSent && <div style={{ fontSize: 11, color: 'var(--sage)', marginTop: 4 }}>✓ Push notification sent</div>}
                    </div>
                    {!p.published && (
                      <button onClick={async () => {
                        if (!window.confirm(`Publish "${p.title}"? This will send a push notification to all subscribers and the sale will appear on the homepage.`)) return;
                        await apiFetch(`/api/admin/promotions/${p.id}/publish`, { method: 'POST' });
                        loadPromos();
                      }} style={{ fontSize: 12, fontWeight: 700, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '8px 14px' }}>
                        🚀 Publish + Notify
                      </button>
                    )}
                    <button onClick={async () => {
                      if (!window.confirm('Delete this promotion?')) return;
                      await apiFetch(`/api/admin/promotions/${p.id}`, { method: 'DELETE' });
                      loadPromos();
                    }} style={{ fontSize: 12, color: 'var(--accent-red)', fontWeight: 700, padding: '8px 10px' }}>
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* REQUESTS — customers asking for items we don't stock */}
        {adminTab === 'requests' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Product Requests</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 18 }}>Customers asking for things you don't stock yet. Tap WhatsApp to reach out, then mark the request as contacted / found / dismissed.</p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {[['new','New'],['contacted','Contacted'],['found','Found'],['dismissed','Dismissed'],['all','All']].map(([k, l]) => (
                <button key={k} onClick={() => setReqFilter(k)}
                  style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: reqFilter === k ? 'var(--sage)' : 'var(--cream)', color: reqFilter === k ? '#fff' : 'var(--warm-gray)' }}>
                  {l}
                </button>
              ))}
            </div>

            {requests.length === 0 ? (
              <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 30, textAlign: 'center', color: 'var(--warm-gray)', fontSize: 14 }}>
                No requests in this filter.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {requests.map(r => {
                  const waNum = String(r.whatsappNumber || '').replace(/\D/g,'').replace(/^0/, '233');
                  const wa = `https://wa.me/${waNum}?text=${encodeURIComponent(`Hi ${r.name}, this is SDGMart — about your request for "${r.productName}":`)}`;
                  const statusColor = { new: '#C8923A', contacted: '#3879BF', found: 'var(--sage)', dismissed: '#888' }[r.status] || '#888';
                  return (
                    <div key={r.id} style={{ background: 'var(--white)', borderRadius: 10, padding: '14px 16px', boxShadow: 'var(--shadow)', opacity: r.status === 'dismissed' ? .6 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14 }}>{r.productName}</strong>
                        <span style={{ background: `${statusColor}22`, color: statusColor, borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          {r.status}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--warm-gray)', marginLeft: 'auto' }}>{new Date(r.createdAt).toLocaleString()}</span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--warm-gray)' }}>
                        From <strong style={{ color: 'var(--warm-black)' }}>{r.name}</strong>
                        {r.userId && <span style={{ marginLeft: 6, fontSize: 11, opacity: .7 }}>(registered customer)</span>}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--warm-gray)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {r.whatsappNumber && <span>💬 {r.whatsappNumber}{r.contactWhatsapp ? ' ✓' : ''}</span>}
                        {r.callNumber && <span>📞 {r.callNumber}{r.contactCall ? ' ✓' : ''}</span>}
                        <span style={{ opacity: .7 }}>prefers: {[r.contactWhatsapp && 'WhatsApp', r.contactCall && 'call'].filter(Boolean).join(' & ') || 'either'}</span>
                      </div>
                      {r.notes && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--cream)', borderRadius: 6, fontSize: 13, lineHeight: 1.5, fontStyle: 'italic' }}>{r.notes}</div>}
                      <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.whatsappNumber && <a href={wa} target="_blank" rel="noreferrer"
                          style={{ background: '#25D366', color: '#fff', fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 6, textDecoration: 'none' }}>
                          💬 WhatsApp
                        </a>}
                        {r.callNumber && <a href={`tel:${r.callNumber}`}
                          style={{ background: 'var(--sage)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 6, textDecoration: 'none' }}>
                          📞 Call
                        </a>}
                        {r.status === 'new' && (
                          <button onClick={() => updateRequest(r.id, { status: 'contacted' })} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 6, background: 'var(--cream)', color: 'var(--warm-gray)' }}>
                            Mark contacted
                          </button>
                        )}
                        {r.status !== 'found' && (
                          <button onClick={() => updateRequest(r.id, { status: 'found' })} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 6, background: 'var(--cream)', color: 'var(--sage-dark)' }}>
                            ✓ Found / fulfilled
                          </button>
                        )}
                        {r.status !== 'dismissed' && (
                          <button onClick={() => updateRequest(r.id, { status: 'dismissed' })} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 6, background: 'transparent', color: 'var(--accent-red)' }}>
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ISSUES — customer-reported problems on delivered orders */}
        {adminTab === 'issues' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 14 }}>Customer Issues</h1>
            {issues.length === 0 ? (
              <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 30, textAlign: 'center', color: 'var(--warm-gray)', fontSize: 14 }}>
                ✨ No reported issues. Keep it up!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {issues.map(i => (
                  <div key={i.id} style={{ background: 'var(--white)', borderRadius: 10, padding: '14px 16px', boxShadow: 'var(--shadow)', opacity: i.resolved ? .6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>Order {window.orderCode(i.orderId)}</strong>
                      <span style={{ background: 'rgba(192,57,43,.1)', color: 'var(--accent-red)', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{i.issueType}</span>
                      {i.resolved && <span style={{ background: 'var(--sage)', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>RESOLVED</span>}
                      <span style={{ fontSize: 11, color: 'var(--warm-gray)', marginLeft: 'auto' }}>{new Date(i.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>{i.description}</div>
                    {i.resolvedNote && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warm-gray)', fontStyle: 'italic' }}>Note: {i.resolvedNote}</div>}
                    {!i.resolved && (
                      <button onClick={() => resolveIssue(i.id)} style={{ marginTop: 10, fontSize: 12, fontWeight: 700, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '7px 14px' }}>
                        Mark resolved
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DASHBOARD — operational metrics + charts */}
        {adminTab === 'dashboard' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700 }}>Dashboard</h1>
              <div style={{ display: 'flex', gap: 6 }}>
                {[7, 30, 90].map(d => (
                  <button key={d} onClick={() => setMetricsDays(d)}
                    style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: metricsDays === d ? 'var(--sage)' : 'var(--cream)', color: metricsDays === d ? '#fff' : 'var(--warm-gray)' }}>
                    {d}d
                  </button>
                ))}
                <button onClick={loadMetrics} style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: 'var(--cream)', color: 'var(--warm-gray)' }}>↻</button>
              </div>
            </div>

            {!metrics ? (
              <div style={{ color: 'var(--warm-gray)', fontSize: 14 }}>Loading metrics…</div>
            ) : (
              <>
                {/* KPI cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 24 }}>
                  <StatCard label="Revenue (delivered)" value={`GHS ${metrics.totals.revenue.toFixed(0)}`} sub={`${metrics.totals.delivered} delivered`} accent="#1A1A1A" />
                  <StatCard label="Orders" value={metrics.totals.orders} sub={`last ${metrics.days} days`} accent="#3879BF" />
                  <StatCard label="Avg order value" value={`GHS ${metrics.totals.aov.toFixed(2)}`} accent="#C8923A" />
                  <StatCard label="Customers" value={metrics.totals.customers} sub="registered" accent="#27AE60" />
                  <StatCard label="Active auto-reorders" value={metrics.totals.activeRecurring} accent="#9B2D60" />
                </div>

                {/* Orders + revenue per day */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18, marginBottom: 24 }}>
                  <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Orders per day</div>
                    <MiniBars data={metrics.series.map(s => ({ date: s.date, value: s.orders }))} color="#3879BF" />
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Revenue per day (GHS)</div>
                    <MiniBars data={metrics.series.map(s => ({ date: s.date, value: Math.round(s.revenue) }))} color="#1A1A1A" valueFmt={v => 'GHS ' + v} />
                  </div>
                </div>

                {/* Top products + categories + status */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18 }}>
                  <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Top products (by qty sold)</div>
                    <RankBars data={metrics.topProducts} color="#3879BF" />
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Top categories</div>
                    <RankBars data={metrics.topCategories} color="#C8923A" />
                  </div>
                </div>

                {/* Status breakdown */}
                <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)', marginTop: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Order status breakdown</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {Object.entries(metrics.statusBreakdown).map(([s, n]) => (
                      <div key={s} style={{ background: 'var(--cream)', borderRadius: 999, padding: '6px 14px', fontSize: 13 }}>
                        <strong>{n}</strong> <span style={{ color: 'var(--warm-gray)' }}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* LEADERBOARD — top referrers */}
        {adminTab === 'leaderboard' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Referral Leaderboard</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 20 }}>Your best recruiters — customers who've brought the most new sign-ups via their referral code.</p>
            {leaders.length === 0 ? (
              <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 30, textAlign: 'center', color: 'var(--warm-gray)', fontSize: 14 }}>
                No referrals yet. Share the squad feature to get the ball rolling!
              </div>
            ) : (
              <div style={{ background: 'var(--white)', borderRadius: 12, boxShadow: 'var(--shadow)', overflow: 'hidden', maxWidth: 560 }}>
                {leaders.map((u, i) => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--cream-dark)' }}>
                    <div style={{ width: 28, fontSize: 18, textAlign: 'center' }}>{['🥇','🥈','🥉'][i] || <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warm-gray)' }}>{i + 1}</span>}</div>
                    <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--warm-gray)' }}>GHS {Number(u.loyaltyBalance || 0).toFixed(0)} credit</div>
                    <div style={{ background: 'var(--sage)', color: '#fff', borderRadius: 999, padding: '3px 12px', fontSize: 13, fontWeight: 700 }}>{u.referralCount} refs</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ERRORS — in-house monitoring */}
        {adminTab === 'errors' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700 }}>Error Log</h1>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={loadErrors} style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, background: 'var(--cream)', color: 'var(--warm-gray)' }}>↻ Refresh</button>
                {errorLogs.length > 0 && (
                  <button onClick={async () => { if (window.confirm('Clear all logged errors?')) { await apiFetch('/api/admin/errors', { method: 'DELETE' }); loadErrors(); } }}
                    style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, background: 'rgba(192,57,43,.08)', color: 'var(--accent-red)' }}>Clear all</button>
                )}
              </div>
            </div>
            {errorLogs.length === 0 ? (
              <div style={{ background: 'var(--cream)', borderRadius: 10, padding: 30, textAlign: 'center', color: 'var(--warm-gray)', fontSize: 14 }}>
                ✨ No errors logged. Smooth sailing.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {errorLogs.map(e => (
                  <div key={e.id} style={{ background: 'var(--white)', borderRadius: 8, padding: '12px 14px', boxShadow: 'var(--shadow)', borderLeft: '3px solid var(--accent-red)' }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-red)' }}>{e.message}</span>
                      <span style={{ fontSize: 11, color: 'var(--warm-gray)', marginLeft: 'auto' }}>{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    {(e.method || e.path) && <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 4 }}>{e.method} {e.path}</div>}
                    {e.stack && <details style={{ marginTop: 6 }}><summary style={{ fontSize: 11, color: 'var(--warm-gray)', cursor: 'pointer' }}>Stack trace</summary><pre style={{ fontSize: 10, color: 'var(--warm-gray)', whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 200, overflow: 'auto' }}>{e.stack}</pre></details>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SETTINGS — site-wide toggles */}
        {adminTab === 'settings' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Store Settings</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 24 }}>Site-wide options. Changes apply after customers reload the storefront.</p>

            <div style={{ background: 'var(--white)', borderRadius: 12, padding: '20px 22px', boxShadow: 'var(--shadow)', maxWidth: 620 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Show freshness / Best-Before dates</div>
                  <div style={{ fontSize: 13, color: 'var(--warm-gray)', marginTop: 4, lineHeight: 1.5 }}>
                    When ON, customers see each product's Best-Before date, a "Clearance Corner" for items nearing expiry,
                    and automatic discounts on those items. Leave OFF until you're regularly stocking perishables — you can
                    still record Best-Before dates per product in Inventory either way.
                  </div>
                </div>
                <button onClick={() => saveSettings({ showFreshness: !settings.showFreshness })}
                  style={{ flexShrink: 0, width: 52, height: 30, borderRadius: 999, background: settings.showFreshness ? 'var(--sage)' : 'var(--cream-dark)', position: 'relative', transition: 'background .2s', border: 'none', cursor: 'pointer' }}>
                  <span style={{ position: 'absolute', top: 3, left: settings.showFreshness ? 25 : 3, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                </button>
              </div>
              {settingsSaved && <div style={{ marginTop: 16, fontSize: 13, color: 'var(--sage)' }}>✓ {settingsSaved}</div>}
            </div>
          </div>
        )}

        {/* PAYMENTS — admin sets the MoMo numbers shown at checkout */}
        {adminTab === 'payments' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Payment Settings</h1>
            <p style={{ color: 'var(--warm-gray)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              Customers pick a network at checkout, then send money to the matching number below.
              Leave a field blank to hide that network on the checkout page.
            </p>

            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px 28px', boxShadow: 'var(--shadow)', maxWidth: 640 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  ['mtn',     'MTN MoMo',     'e.g. 024 123 4567',  '#FFCC08', '#000'],
                  ['telecel', 'Telecel Cash', 'e.g. 020 123 4567',  '#E60012', '#fff'],
                  ['at',      'AT Money',     'e.g. 027 123 4567',  '#1A1A1A', '#fff'],
                ].map(([key, label, ph, bg, fg]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ width: 110, padding: '8px 12px', borderRadius: 8, background: bg, color: fg, fontWeight: 700, fontSize: 12, textAlign: 'center' }}>{label}</span>
                    <input value={momoCfg[key]} onChange={e => setMomoCfg(c => ({ ...c, [key]: e.target.value }))}
                      placeholder={ph}
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', background: 'var(--white)', fontFamily: 'monospace' }} />
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
                  <span style={{ width: 110, fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textAlign: 'right' }}>Account name</span>
                  <input value={momoCfg.name} onChange={e => setMomoCfg(c => ({ ...c, name: e.target.value }))}
                    placeholder="e.g. SDGMart Tamale (shown to the customer so they can verify before sending)"
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', background: 'var(--white)' }} />
                </div>
              </div>
              <div style={{ marginTop: 22, display: 'flex', gap: 12, alignItems: 'center' }}>
                <button onClick={saveMomo}
                  style={{ background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '11px 24px', fontWeight: 700, fontSize: 13 }}>
                  Save numbers
                </button>
                {momoSavedAt && <span style={{ color: 'var(--sage)', fontSize: 13 }}>✓ Saved at {momoSavedAt}</span>}
              </div>
            </div>

            <div style={{ marginTop: 24, padding: '16px 18px', background: 'var(--cream)', borderRadius: 10, fontSize: 12, color: 'var(--warm-gray)', lineHeight: 1.6, maxWidth: 640 }}>
              <strong style={{ color: 'var(--warm-black)' }}>🔮 Want fully automatic MoMo?</strong> Hook the site up to <strong>Paystack</strong> later
              — customer enters their phone, gets a USSD prompt to enter their PIN, money lands in your Paystack balance, your order is auto-marked paid via webhook.
              ~1.95% per transaction. Requires a Ghana bank account and ~10 min of setup. Until then, the manual flow above works perfectly.
            </div>
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

        {/* RIDERS */}
        {adminTab === 'riders' && (
          <div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Riders</h1>
            <p style={{ fontSize: 13, color: 'var(--warm-gray)', marginBottom: 20 }}>Only admins can create rider accounts. Riders sign in with the credentials you set here and use the rider PWA to take deliveries.</p>

            {/* Create rider */}
            <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>+ Create New Rider</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                <input placeholder="Full name" value={newRider.name} onChange={e => setNewRider(r => ({ ...r, name: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 13 }} />
                <input placeholder="Email" type="email" value={newRider.email} onChange={e => setNewRider(r => ({ ...r, email: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 13 }} />
                <input placeholder="Phone (optional)" value={newRider.phone} onChange={e => setNewRider(r => ({ ...r, phone: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 13 }} />
                <input placeholder="Initial password (≥6 chars)" type="text" value={newRider.password} onChange={e => setNewRider(r => ({ ...r, password: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 13 }} />
              </div>
              {riderErr && <div style={{ marginTop: 8, color: 'var(--accent-red)', fontSize: 12 }}>{riderErr}</div>}
              <button onClick={createRider}
                style={{ marginTop: 12, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, border: 'none' }}>
                Create Rider
              </button>
            </div>

            {/* List riders */}
            <div style={{ background: 'var(--white)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>All Riders ({riders.length})</div>
              {riders.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--warm-gray)', padding: 14 }}>No riders yet. Create one above.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--cream-dark)', textAlign: 'left' }}>
                      <th style={{ padding: 10 }}>Name</th><th style={{ padding: 10 }}>Email</th>
                      <th style={{ padding: 10 }}>Phone</th><th style={{ padding: 10 }}>Status</th>
                      <th style={{ padding: 10 }}>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riders.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--cream-dark)' }}>
                        <td style={{ padding: 10, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: 10 }}>{r.email}</td>
                        <td style={{ padding: 10 }}>{r.phone || '—'}</td>
                        <td style={{ padding: 10 }}>
                          <span style={{ color: r.online ? '#27AE60' : 'var(--warm-gray)', fontWeight: 700 }}>
                            {r.online ? '🟢 Online' : '⚫ Offline'}
                          </span>
                        </td>
                        <td style={{ padding: 10, color: 'var(--warm-gray)', fontSize: 12 }}>
                          {r.lastSeen ? new Date(r.lastSeen).toLocaleTimeString() : '—'}
                          {r.lat != null && <div style={{ fontSize: 11 }}>{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
