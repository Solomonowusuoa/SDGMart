// CategoryPage
const CategoryPage = ({ selectedCategory, setSelectedCategory, onAdd, onView, searchQuery }) => {
  const [sortBy, setSortBy] = React.useState('default');
  const [activeCategory, setActiveCategory] = React.useState(selectedCategory);
  const [showFilters, setShowFilters] = React.useState(false);
  const isMobile = useMobile();

  React.useEffect(() => { setActiveCategory(selectedCategory); }, [selectedCategory]);

  let filtered = activeCategory
    ? window.PRODUCTS.filter(p => p.category === activeCategory)
    : window.PRODUCTS;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }

  // Log search queries (debounced) for the admin analytics dashboard
  React.useEffect(() => {
    if (!searchQuery || !searchQuery.trim()) return;
    const t = setTimeout(() => {
      try {
        window.apiFetch('/api/search/log', {
          method: 'POST',
          body: JSON.stringify({ query: searchQuery.trim(), resultCount: filtered.length }),
        }).catch(() => {});
      } catch (_) {}
    }, 1200); // wait 1.2s after typing stops before logging
    return () => clearTimeout(t);
  }, [searchQuery, filtered.length]);

  if (sortBy === 'price-asc') filtered = [...filtered].sort((a,b) => a.price - b.price);
  if (sortBy === 'price-desc') filtered = [...filtered].sort((a,b) => b.price - a.price);
  if (sortBy === 'expiry') filtered = [...filtered].sort((a,b) => new Date(a.bestBefore) - new Date(b.bestBefore));

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '16px' : '28px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: isMobile ? 16 : 24 }}>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: isMobile ? 22 : 30, fontWeight: 700 }}>
          {activeCategory ? activeCategory : searchQuery ? `Search: "${searchQuery}"` : 'All Products'}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--warm-gray)', marginTop: 4 }}>{filtered.length} items found</div>
      </div>

      {/* Mobile: horizontal category pills + filter toggle */}
      {isMobile && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, minWidth: 'max-content', paddingBottom: 4 }}>
              <button onClick={() => { setActiveCategory(null); setSelectedCategory(null); }}
                style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', background: activeCategory === null ? 'var(--sage)' : 'var(--cream-dark)', color: activeCategory === null ? '#fff' : 'var(--warm-black)', border: 'none' }}>
                All
              </button>
              {window.CATEGORIES.map(cat => (
                <button key={cat} onClick={() => { setActiveCategory(cat); setSelectedCategory(cat); }}
                  style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', background: activeCategory === cat ? 'var(--sage)' : 'var(--cream-dark)', color: activeCategory === cat ? '#fff' : 'var(--warm-black)', border: 'none' }}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setShowFilters(f => !f)}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--sage)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {showFilters ? '▲ Hide Sort' : '▼ Sort By'}
          </button>
          {showFilters && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {[['default','Default'],['price-asc','↑ Price'],['price-desc','↓ Price'],['expiry','Expiry']].map(([val, label]) => (
                <button key={val} onClick={() => { setSortBy(val); setShowFilters(false); }}
                  style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: sortBy === val ? 700 : 500, background: sortBy === val ? 'var(--sage)' : 'var(--cream-dark)', color: sortBy === val ? '#fff' : 'var(--warm-black)', border: 'none' }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr', gap: 32, alignItems: 'start' }}>
        {/* Sidebar — desktop only */}
        {!isMobile && (
          <aside>
            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '20px', boxShadow: 'var(--shadow)', position: 'sticky', top: 120 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Categories</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={() => { setActiveCategory(null); setSelectedCategory(null); }}
                  style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: activeCategory === null ? 700 : 500, background: activeCategory === null ? 'var(--sage)' : 'transparent', color: activeCategory === null ? '#fff' : 'var(--warm-black)', transition: 'all .15s' }}>
                  All Products ({window.PRODUCTS.length})
                </button>
                {window.CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => { setActiveCategory(cat); setSelectedCategory(cat); }}
                    style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: activeCategory === cat ? 700 : 500, background: activeCategory === cat ? 'var(--sage)' : 'transparent', color: activeCategory === cat ? '#fff' : 'var(--warm-black)', transition: 'all .15s' }}>
                    {cat} ({window.PRODUCTS.filter(p => p.category === cat).length})
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 20, borderTop: '1px solid var(--cream-dark)', paddingTop: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Sort By</div>
                {[['default','Default'],['price-asc','Price: Low to High'],['price-desc','Price: High to Low'],['expiry','Expiry: Soonest']].map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val)}
                    style={{ display: 'block', textAlign: 'left', width: '100%', padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: sortBy === val ? 700 : 400, background: sortBy === val ? 'var(--cream-dark)' : 'transparent', color: 'var(--warm-black)', marginBottom: 2 }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Product grid */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(auto-fill,minmax(190px,1fr))', gap: isMobile ? 12 : 18 }}>
          {filtered.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '50px 20px', color: 'var(--warm-gray)' }}>
              <div style={{ fontSize: 40 }}>🤷‍♂️</div>
              <div style={{ fontWeight: 700, marginTop: 12, fontSize: 16 }}>Nothing matches{searchQuery ? ` "${searchQuery}"` : ''}</div>
              <div style={{ fontSize: 13, marginTop: 6, marginBottom: 20 }}>
                {searchQuery ? "We don't stock this yet — but we love a challenge." : "Try a different category."}
              </div>
              {searchQuery && (
                <RequestProductButton prefillProduct={searchQuery}
                  label="📝 Ask us to find it"
                  style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '12px 22px', fontWeight: 700, fontSize: 14, border: 'none' }} />
              )}
            </div>
          ) : filtered.map(p => (
            <ProductCard key={p.id} product={p} onAdd={onAdd} onView={onView} />
          ))}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { CategoryPage });
