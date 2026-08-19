// CategoryPage — design refresh: hairline grid + sidebar + Sort dropdown
const CategoryPage = ({ selectedCategory, setSelectedCategory, onAdd, onView, searchQuery }) => {
  const [sortBy, setSortBy] = React.useState('popular');
  const [sortOpen, setSortOpen] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState(selectedCategory);
  const isMobile = useMobile();
  const showFreshness = typeof window !== 'undefined' && window.SHOW_FRESHNESS === true;

  const SORTS = [
    ['popular', 'Popular'],
    ['price-asc', 'Price: Low to High'],
    ['price-desc', 'Price: High to Low'],
    ['name', 'Name: A–Z'],
    ...(showFreshness ? [['expiry', 'Expiry: Soonest']] : []),
  ];
  const sortLabel = (SORTS.find(s => s[0] === sortBy) || SORTS[0])[1];

  React.useEffect(() => { setActiveCategory(selectedCategory); }, [selectedCategory]);

  let filtered = activeCategory ? window.PRODUCTS.filter(p => p.category === activeCategory) : window.PRODUCTS;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }

  // Log search queries (debounced) for admin analytics
  React.useEffect(() => {
    if (!searchQuery || !searchQuery.trim()) return;
    const t = setTimeout(() => {
      try { window.apiFetch('/api/search/log', { method: 'POST', body: JSON.stringify({ query: searchQuery.trim(), resultCount: filtered.length }) }).catch(() => {}); } catch (_) {}
    }, 1200);
    return () => clearTimeout(t);
  }, [searchQuery, filtered.length]);

  // Sorting (all client-side over the in-memory catalogue)
  const TOP = window.TOP_IDS_BY_ORDERS || [];
  const rank = new Map(TOP.map((id, i) => [id, i]));
  const rankOf = (p) => rank.has(p.id) ? rank.get(p.id) : 1e9;
  const list = [...filtered];
  if (sortBy === 'price-asc') list.sort((a, b) => a.price - b.price);
  else if (sortBy === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === 'expiry') list.sort((a, b) => new Date(a.bestBefore || 8.64e15) - new Date(b.bestBefore || 8.64e15));
  else list.sort((a, b) => rankOf(a) - rankOf(b)); // popular

  const title = activeCategory || 'All Products';
  const catRows = [['All Products', null, window.PRODUCTS.length], ...window.CATEGORIES.map(c => [c, c, window.PRODUCTS.filter(p => p.category === c).length])];

  return (
    <div className="rd-gutter" style={{ fontFamily: 'var(--f-ui)', color: 'var(--ink)', paddingTop: isMobile ? 22 : 34, paddingBottom: 56, background: 'var(--panel)', minHeight: '60vh' }}>
      <style>{`
        .rd-side{border-left:2px solid transparent;transition:border-color .14s,background .14s;cursor:pointer}
        .rd-side:hover{border-left-color:var(--accent);background:var(--surface-warm)}
      `}</style>

      {/* Header + Sort */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, borderBottom: '2px solid var(--ink)', paddingBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: isMobile ? 28 : 40, fontWeight: 700, letterSpacing: '-.03em' }}>{title}</h1>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>{list.length} item{list.length === 1 ? '' : 's'} found</span>
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setSortOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border-input)', background: 'var(--panel)', cursor: 'pointer', padding: '9px 14px', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink)' }}>
            Sort: {sortLabel} <span style={{ fontSize: 10 }}>▾</span>
          </button>
          {sortOpen && (
            <>
              <div onClick={() => setSortOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 41, minWidth: 200, background: 'var(--panel)', border: '1px solid var(--border-input)', boxShadow: '0 8px 24px rgba(20,20,16,.12)' }}>
                {SORTS.map(([val, lab]) => (
                  <button key={val} onClick={() => { setSortBy(val); setSortOpen(false); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: sortBy === val ? 'var(--surface-warm)' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-ui)', fontSize: 13, fontWeight: sortBy === val ? 600 : 400, color: 'var(--ink)' }}>{lab}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '248px 1fr', gap: 32, paddingTop: 26, alignItems: 'start' }}>
        {!isMobile && (
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'sticky', top: 150 }}>
            <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--rd-muted)', paddingBottom: 12 }}>Categories</div>
            {catRows.map(([name, cat, cnt]) => {
              const active = activeCategory === cat;
              return (
                <button key={name} className="rd-side" onClick={() => { setActiveCategory(cat); setSelectedCategory(cat); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', background: active ? 'var(--surface-warm)' : 'none', borderLeftColor: active ? 'var(--accent)' : 'transparent', borderTop: 'none', borderRight: 'none', borderBottom: 'none', textAlign: 'left', fontFamily: 'var(--f-ui)', fontSize: 13.5, fontWeight: active ? 600 : 500, color: 'var(--ink)' }}>
                  <span>{name}</span>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--rd-faint)' }}>{cnt}</span>
                </button>
              );
            })}
          </aside>
        )}

        {list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--rd-muted)' }}>
            <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 26, color: 'var(--ink)' }}>Nothing matches{searchQuery ? ` “${searchQuery}”` : ''}.</div>
            <div style={{ fontSize: 13.5, marginTop: 10, marginBottom: 20 }}>{searchQuery ? "We don't stock this yet — but we love a challenge." : 'Try a different category.'}</div>
            {searchQuery && (
              <RequestProductButton prefillProduct={searchQuery} label="Ask us to find it"
                style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '13px 22px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }} />
            )}
          </div>
        ) : (
          <div className="rd-grid rd-grid-4">
            {list.map(p => <RCard key={p.id} product={p} onAdd={onAdd} onView={onView} />)}
          </div>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { CategoryPage });
