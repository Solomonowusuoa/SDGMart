// ProductCard component
const ProductCard = ({ product, onAdd, onView, compact }) => {
  // Freshness/expiry display is admin-controlled. When off, no BB dates,
  // clearance badges, or auto-discounts are shown to customers.
  const showFreshness = typeof window !== 'undefined' && window.SHOW_FRESHNESS === true;
  const daysLeft = () => {
    if (!product.bestBefore) return Infinity;
    const bb = new Date(product.bestBefore);
    const now = new Date();
    return Math.ceil((bb - now) / (1000*60*60*24));
  };
  const dl = daysLeft();
  const expiring = showFreshness && dl <= 60;

  // Active promotion for this product (from window.PROMO_MAP set in App)
  const promoPct = (typeof window !== 'undefined' && window.PROMO_MAP) ? window.PROMO_MAP[product.id] : 0;
  const promoPrice = promoPct ? +(product.price * (1 - promoPct / 100)).toFixed(2) : null;

  // Placeholder image using category colors
  const catColors = {
    'Cereals': ['#FDEBD0','#C0622A'],
    'Dairy': ['#DBEEFF','#2A6FAF'],
    'Detergents': ['#D4F4DD','#1E7A3A'],
    'Rice & Grains': ['#FFF3D4','#B07A10'],
    'Cooking Oil': ['#FFF0B0','#C08000'],
    'Snacks': ['#FFE0C8','#C04A10'],
    'Canned Foods': ['#D8EED8','#2A6A2A'],
    'Drinks': ['#CCE8FF','#1050A0'],
    'Desserts': ['#FFD6E8','#A01850'],
  };
  const [bg, fg] = catColors[product.category] || ['#EEE','#555'];

  return (
    <div style={{
      background: 'var(--white)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'transform .2s, box-shadow .2s',
      cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='var(--shadow-lg)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='var(--shadow)'; }}
    >
      {/* Image area */}
      <div onClick={() => onView(product)} style={{ position: 'relative', background: bg, height: compact ? 120 : 150, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {product.img ? (
          <img src={product.img} alt={product.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <svg width="60" height="60" viewBox="0 0 60 60">
            <rect width="60" height="60" rx="8" fill={bg}/>
            <text x="30" y="36" textAnchor="middle" fontSize="28" fill={fg} fontFamily="sans-serif">{product.category[0]}</text>
          </svg>
        )}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(product.stock || 0) <= 0 && (
            <span className="badge" style={{ background: '#1A1A1A', color: '#fff' }}>
              Sold out
            </span>
          )}
          {promoPct && (product.stock || 0) > 0 && <span className="badge" style={{ background: '#E03A2B', color: '#fff' }}>⚡ -{promoPct}%</span>}
          {product.bestseller && (product.stock || 0) > 0 && !promoPct && <span className="badge badge-green">★ Top</span>}
          {expiring && dl > 0 && dl <= 30 && <span className="badge badge-gold">⏳ Clearance</span>}
          {expiring && dl > 30 && dl <= 60 && <span className="badge badge-gold">Sale</span>}
        </div>
        {(product.stock || 0) <= 0 && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.55)', pointerEvents: 'none' }} />
        )}
        {showFreshness && product.bestBefore && (
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <span style={{ background: 'rgba(255,255,255,.9)', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: 'var(--warm-gray)' }}>
              BB: {new Date(product.bestBefore).toLocaleDateString('en-GB',{month:'short',year:'numeric'})}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: compact ? '10px 12px 12px' : '12px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div onClick={() => onView(product)}>
          <div style={{ fontSize: 11, color: 'var(--warm-gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{product.category}</div>
          <div style={{ fontWeight: 700, fontSize: compact ? 13 : 14, lineHeight: 1.3, marginTop: 2 }}>{product.name}</div>
          <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>{product.unit}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 6 }}>
          <div>
            {promoPrice != null ? (
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: compact ? 15 : 17, color: '#E03A2B' }}>GHS {promoPrice.toFixed(2)}</span>
                <span style={{ fontSize: 11, color: 'var(--warm-gray)', textDecoration: 'line-through' }}>GHS {product.price.toFixed(2)}</span>
              </span>
            ) : (
              <span style={{ fontWeight: 700, fontSize: compact ? 15 : 17, color: 'var(--sage-dark)' }}>GHS {product.price.toFixed(2)}</span>
            )}
            {!promoPrice && expiring && dl <= 60 && (
              <span style={{ fontSize: 11, color: 'var(--accent-red)', display: 'block', fontWeight: 600 }}>
                -{expiring && dl <= 30 ? '15%' : '10%'} off
              </span>
            )}
          </div>
          {(product.stock || 0) <= 0 ? (
            <button disabled
              style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'not-allowed' }}
              title="Snapped up faster than waakye at lunch. Tap the item to be notified.">
              Sold out 🥵
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onAdd(product); }}
              style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, transition: 'background .2s' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--sage-dark)'}
              onMouseLeave={e => e.currentTarget.style.background='var(--sage)'}>
              + Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Trust badges
const TrustBadges = () => {
  const showFreshness = typeof window !== 'undefined' && window.SHOW_FRESHNESS === true;
  const badges = [
    ['⚡','Same-Day Delivery','Order before 12pm, get it today in Tamale'],
    ['🔒','MoMo Payments','Secure Mobile Money checkout'],
    showFreshness
      ? ['📅','Freshness Dates','Every product shows its Best Before date']
      : ['🛵','In-House Delivery','Our own riders, tracked to your door'],
  ];
  return (
  <div style={{ background: 'linear-gradient(90deg, var(--sage-dark) 0%, var(--sage) 100%)', color: '#fff', padding: '18px 24px' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 20 }}>
      {badges.map(([icon,title,sub]) => (
        <div key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
            <div style={{ fontSize: 12, opacity: .75, marginTop: 2 }}>{sub}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
  );
};

// Essentials Card — soft sky-blue accent
const EssentialsCard = ({ onAddAll, onView }) => {
  const items = window.ESSENTIALS.map(id => window.PRODUCTS.find(p => p.id === id)).filter(Boolean);
  const total = items.reduce((s, p) => s + p.price, 0);
  const [open, setOpen] = React.useState(false);
  const NAVY = '#1A2F42';

  return (
    <div style={{
      background: '#DCE9F2', color: NAVY, borderRadius: 'var(--radius-lg)',
      padding: '20px', gridColumn: open ? '1 / -1' : undefined,
      boxShadow: 'var(--shadow-lg)', cursor: 'pointer',
      border: '1px solid #C5DAE8',
    }} onClick={() => setOpen(!open)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: .65, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>Editor's Pick</div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>Household Essentials</div>
          <div style={{ fontSize: 13, opacity: .75, marginTop: 4 }}>{items.length} items · GHS {total.toFixed(2)}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeOpacity=".55" strokeWidth="2">
            <path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}/>
          </svg>
        </div>
      </div>

      {open && (
        <div onClick={e => e.stopPropagation()}>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,.6)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name} <span style={{ opacity: .65, fontWeight: 400 }}>· {p.unit}</span></span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>GHS {p.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button onClick={() => onAddAll(items)}
              style={{ flex: 1, background: NAVY, color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13, transition: 'opacity .2s' }}>
              Add All to Cart
            </button>
          </div>
        </div>
      )}

      {!open && (
        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {items.slice(0,4).map(p => (
            <span key={p.id} style={{ background: 'rgba(255,255,255,.7)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>{p.name}</span>
          ))}
          <span style={{ opacity: .65, fontSize: 11, padding: '3px 10px' }}>+{items.length - 4} more</span>
        </div>
      )}
    </div>
  );
};

// Suggested for You (Predictive Pantry)
const PredictivePantry = ({ onAdd, onView }) => {
  const isMobile = useMobile();
  const suggested = window.PRODUCTS.filter(p => [5,13,17,29].includes(p.id));
  return (
    <section style={{ maxWidth: 1280, margin: '40px auto 0', padding: '0 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 700 }}>Suggested <em>for You</em></h2>
        <span style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Running low on your regulars?</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(200px,1fr))', gap: 16 }}>
        {suggested.map(p => (
          <ProductCard key={p.id} product={p} onAdd={onAdd} onView={onView} compact />
        ))}
      </div>
    </section>
  );
};

// HomePage
const HomePage = ({ onAdd, onView, setPage, setSelectedCategory }) => {
  const isMobile = useMobile();
  // Bestsellers = top items by order frequency. Server falls back to a random
  // sample when there isn't enough order data yet.
  const [bestsellers, setBestsellers] = React.useState(() => {
    // Synchronous fallback so the section never renders empty: prefer flagged
    // bestsellers, otherwise a random 8 from the catalogue.
    const flagged = window.PRODUCTS.filter(p => p.bestseller);
    if (flagged.length >= 8) return flagged.slice(0, 8);
    const pool = [...window.PRODUCTS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return [...flagged, ...pool.filter(p => !p.bestseller)].slice(0, 8);
  });

  React.useEffect(() => {
    fetch('/api/products/top?limit=8')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length) setBestsellers(data); })
      .catch(() => {});
  }, []);

  const handleAddAll = (items) => {
    items.forEach(p => onAdd(p));
  };

  // Hero background — local /icons/hero.jpg if present (recommended),
  // otherwise fall back to the moody pantry Unsplash photo.
  const HERO_BG = '/icons/hero.jpg';

  React.useEffect(() => {
    // Preload the hero image so it starts downloading before this section paints
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = HERO_BG;
    link.fetchPriority = 'high';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (_) {} };
  }, []);

  // Live counters + active promotions
  const [deliveredCount, setDeliveredCount] = React.useState(null);
  const [promos, setPromos] = React.useState([]);
  React.useEffect(() => {
    fetch('/api/stats/delivered-count').then(r => r.ok ? r.json() : { count: 0 }).then(d => setDeliveredCount(d.count));
    fetch('/api/promotions/active').then(r => r.ok ? r.json() : []).then(setPromos).catch(() => {});
    const t = setInterval(() => fetch('/api/stats/delivered-count').then(r => r.ok ? r.json() : null).then(d => d && setDeliveredCount(d.count)).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      {/* Active flash sale banner */}
      {promos.length > 0 && (
        <div style={{ background: 'linear-gradient(90deg,#1A1A1A,#000)', color: '#fff', padding: '12px 16px', textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
          ⚡ <strong>{promos[0].title}</strong> — up to {promos[0].discountPercent}% off · ends {new Date(promos[0].endsAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      {/* Full-width hero */}
      <section style={{
        position: 'relative', height: 380, overflow: 'hidden',
        backgroundColor: '#1a1a1a', // instant fill while photo loads
        backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.6)), url(${HERO_BG})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '0 20px' : '0 32px', color: '#fff', width: '100%' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', opacity: .85 }}>
            Tamale's Smart Grocery Service
            {deliveredCount != null && deliveredCount > 0 && (
              <span style={{ marginLeft: 12, opacity: .8, fontWeight: 600, letterSpacing: '.08em' }}>
                · {deliveredCount.toLocaleString()} order{deliveredCount === 1 ? '' : 's'} served in Tamale
              </span>
            )}
          </div>
          <h1 style={{
            fontFamily: 'var(--font-head)', fontWeight: 700,
            fontSize: isMobile ? 30 : 48, lineHeight: 1.15, marginTop: 14,
            maxWidth: 720, textShadow: '0 2px 8px rgba(0,0,0,.4)',
          }}>
            Fresh essentials,<br/><em style={{ fontWeight: 600 }}>delivered the same day.</em>
          </h1>
          <p style={{ fontSize: isMobile ? 13 : 15, opacity: .9, marginTop: 14, maxWidth: 540, lineHeight: 1.55 }}>
            Pantry staples, snacks, drinks and household goods — order before 12pm and we'll have it at your door today.
          </p>
          <div style={{ marginTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => { setSelectedCategory(null); setPage('category'); }}
              style={{
                background: '#fff', color: '#1A1A1A', borderRadius: 999,
                padding: '12px 24px', fontWeight: 700, fontSize: 14,
                border: 'none', cursor: 'pointer',
              }}>
              Shop All Products →
            </button>
            <button onClick={() => setPage('squad')}
              style={{
                background: 'rgba(255,255,255,.12)', color: '#fff',
                border: '1.5px solid rgba(255,255,255,.55)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                borderRadius: 999, padding: '12px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}>
              Join a Squad 🤝
            </button>
          </div>
        </div>
      </section>

      <TrustBadges />

      {/* Main content */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 24px' }}>

        {/* Today's Deals — promo products as cards */}
        {(() => {
          const promoIds = {};
          promos.forEach(p => (p.productIds || []).forEach(id => { promoIds[id] = Math.max(promoIds[id] || 0, p.discountPercent); }));
          const dealProducts = window.PRODUCTS.filter(p => promoIds[p.id]);
          if (dealProducts.length === 0) return null;
          return (
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  ⚡ Today's Deals
                </h2>
                {promos[0] && <span style={{ background: '#E03A2B', color: '#fff', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                  Ends {new Date(promos[0].endsAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill,minmax(190px,1fr))', gap: 16 }}>
                {dealProducts.slice(0, 8).map(p => (
                  <ProductCard key={p.id} product={p} onAdd={onAdd} onView={onView} compact />
                ))}
              </div>
            </section>
          );
        })()}

        {/* Bestsellers + Essentials grid */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 280px', gap: isMobile ? 24 : 32, alignItems: 'start' }}>
          {/* Bestsellers */}
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700 }}>Bestsellers</h2>
              <button onClick={() => { setSelectedCategory(null); setPage('category'); }}
                style={{ fontSize: 13, color: 'var(--sage)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                See all <span>→</span>
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill,minmax(190px,1fr))', gap: 16 }}>
              {bestsellers.slice(0,8).map(p => (
                <ProductCard key={p.id} product={p} onAdd={onAdd} onView={onView} compact />
              ))}
            </div>
          </section>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: isMobile ? 'static' : 'sticky', top: 100 }}>
            <EssentialsCard onAddAll={handleAddAll} onView={onView} />

            {/* Squad promo card — gentle steel-blue */}
            <div style={{ background: 'linear-gradient(135deg,#C9DDEC 0%,#B6CFE3 100%)', borderRadius: 'var(--radius-lg)', padding: '20px', color: '#1A2F42', border: '1px solid #A8C5DC' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .65 }}>Group Buying</div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginTop: 4 }}>Join a Squad</div>
              <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>Hit GHS 500 with your crew and unlock 5% off for everyone.</div>
              <button onClick={() => setPage('squad')}
                style={{ marginTop: 14, background: '#1A2F42', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 12, width: '100%' }}>
                View My Squad →
              </button>
            </div>
          </div>
        </div>

        {/* Categories grid */}
        <section style={{ marginTop: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700, marginBottom: 20 }}>
            Shop by <em>Category</em>
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill,minmax(180px,1fr))', gap: 14 }}>
            {window.CATEGORIES.map((cat, i) => {
              const catImages = [
                'https://images.unsplash.com/photo-1517686469429-8bdb88b9f907?w=600&q=80', // Cereals - oats/grains
                'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&q=80', // Dairy - milk bottles
                'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=600&q=80', // Detergents - cleaning
                'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&q=80', // Rice & Grains
                'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&q=80', // Cooking Oil - olive oil
                'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=600&q=80', // Snacks - chips
                'https://images.unsplash.com/photo-1534483509719-3feaee7c30da?w=600&q=80', // Canned Foods
                'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&q=80', // Drinks - cold beverages
                'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=600&q=80', // Desserts
              ];
              return (
                <button key={cat} onClick={() => { setSelectedCategory(cat); setPage('category'); }}
                  style={{
                    position: 'relative', borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden', aspectRatio: '4/3',
                    border: 'none', cursor: 'pointer', padding: 0,
                    transition: 'transform .2s, box-shadow .2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-4px) scale(1.02)'; e.currentTarget.style.boxShadow='var(--shadow-lg)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='none'; }}>
                  {/* Photo */}
                  <img src={catImages[i]} alt={cat}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform .3s' }}
                    onError={e => { e.target.style.display='none'; }}
                  />
                  {/* Gradient overlay */}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(20,20,10,.72) 0%, rgba(20,20,10,.1) 55%, transparent 100%)' }} />
                  {/* Label */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 14px 12px', textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.5)', letterSpacing: '.01em' }}>{cat}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.8)', marginTop: 2, fontWeight: 500 }}>
                      {window.PRODUCTS.filter(p => p.category === cat).length} items →
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Predictive Pantry */}
        <PredictivePantry onAdd={onAdd} onView={onView} />

        {/* Clearance Corner — only when freshness/expiry tracking is enabled */}
        {window.SHOW_FRESHNESS === true && (() => {
          const clearance = window.PRODUCTS.filter(p => {
            if (!p.bestBefore) return false;
            const days = Math.ceil((new Date(p.bestBefore) - new Date()) / (1000*60*60*24));
            return days <= 60 && days > 0;
          }).slice(0, 4);
          if (clearance.length === 0) return null;
          return (
            <section style={{ marginTop: 48 }}>
              <div style={{ background: 'var(--accent-red)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 28 }}>🏷️</span>
                <div>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, color: '#fff' }}>Clearance Corner</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.85)' }}>Items expiring within 60 days — discounted automatically</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill,minmax(190px,1fr))', gap: 16 }}>
                {clearance.map(p => (
                  <ProductCard key={p.id} product={p} onAdd={onAdd} onView={onView} compact />
                ))}
              </div>
            </section>
          );
        })()}

        {/* Can't find what you want? — request a product */}
        <section style={{ marginTop: 48, background: 'var(--cream)', borderRadius: 'var(--radius-lg)', padding: isMobile ? '24px 18px' : '32px 36px', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>🛒</div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: isMobile ? 20 : 24, fontWeight: 700, marginTop: 8 }}>
            Looking for something we don't have?
          </h2>
          <p style={{ fontSize: 14, color: 'var(--warm-gray)', maxWidth: 520, margin: '8px auto 18px', lineHeight: 1.6 }}>
            Tell us what you need. If we can source it locally, we'll WhatsApp you with a price and timeline.
          </p>
          <RequestProductButton
            label="📝 Request an item"
            style={{ background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '12px 28px', fontWeight: 700, fontSize: 14, border: 'none' }} />
        </section>
      </div>

      {/* Footer */}
      <footer style={{ background: 'var(--sage-dark)', color: '#fff', marginTop: 60, padding: '40px 24px 28px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 32 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 10 }}>SDGMart</div>
            <div style={{ fontSize: 13, opacity: .75, lineHeight: 1.7 }}>Tamale's smart grocery service. Fresh essentials delivered to your neighborhood.</div>
          </div>
          {(() => {
            const goCat = (c) => { setSelectedCategory(c); setPage('category'); };
            const goHome = () => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
            const wa = (text) => window.open(`https://wa.me/233504082555${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener');
            const sections = [
              ['Shop', [
                ['Bestsellers', goHome],
                ['Cereals', () => goCat('Cereals')],
                ['Dairy', () => goCat('Dairy')],
                ['Detergents', () => goCat('Detergents')],
                ...(window.SHOW_FRESHNESS === true ? [['Clearance', () => { goHome(); setTimeout(() => { const el = [...document.querySelectorAll('h2,div')].find(n => /Clearance Corner/i.test(n.textContent)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100); }]] : []),
              ]],
              ['Customer Care', [
                ['WhatsApp Us', () => wa('')],
                ['Track Order', () => wa('Hi! I would like to track my SDGMart order.')],
                ['Delivery Info', () => wa('Hi! Could you share delivery info for my area?')],
                ['Returns', () => wa('Hi! I have a question about returns.')],
              ]],
              ['Company', [
                ['About SDGMart', () => wa('Hi! I would like to learn more about SDGMart.')],
                ['Squad Programme', () => setPage('squad')],
                ['Family Mode', () => setPage('checkout')],
                ['Contact Us', () => wa('Hi! I would like to get in touch with SDGMart.')],
              ]],
            ];
            return sections.map(([title, links]) => (
              <div key={title}>
                <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '.04em', marginBottom: 12, opacity: .9 }}>{title}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {links.map(([label, action]) => (
                    <button key={label} onClick={action}
                      style={{ fontSize: 13, opacity: .7, cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'underline'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '.7'; e.currentTarget.style.textDecoration = 'none'; }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ));
          })()}
        </div>
        <div style={{ maxWidth: 1280, margin: '32px auto 0', paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, opacity: .5 }}>© 2026 SDGMart. Tamale, Ghana. All rights reserved.</span>
          <span style={{ fontSize: 12, opacity: .5 }}>
            <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>Privacy</a> · Terms · MoMo Payments
          </span>
        </div>
      </footer>
    </div>
  );
};

Object.assign(window, { HomePage, ProductCard, TrustBadges });
