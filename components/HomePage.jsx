// ─────────────────────────────────────────────────────────────────────────
// LEGACY ProductCard — still used by CategoryPage + ProductPage until those
// screens are moved onto the design refresh. Do not restyle here; the refresh
// uses RCard (below). Kept intact so un-migrated pages don't regress.
// ─────────────────────────────────────────────────────────────────────────
const ProductCard = ({ product, onAdd, onView, compact }) => {
  const showFreshness = typeof window !== 'undefined' && window.SHOW_FRESHNESS === true;
  const daysLeft = () => {
    if (!product.bestBefore) return Infinity;
    const bb = new Date(product.bestBefore);
    const now = new Date();
    return Math.ceil((bb - now) / (1000*60*60*24));
  };
  const dl = daysLeft();
  const expiring = showFreshness && dl <= 60;

  const promoPct = (typeof window !== 'undefined' && window.PROMO_MAP) ? window.PROMO_MAP[product.id] : 0;
  const promoPrice = promoPct ? +(product.price * (1 - promoPct / 100)).toFixed(2) : null;

  const catColors = {
    'Cereals': ['#FDEBD0','#C0622A'], 'Dairy': ['#DBEEFF','#2A6FAF'], 'Detergents': ['#D4F4DD','#1E7A3A'],
    'Rice & Grains': ['#FFF3D4','#B07A10'], 'Cooking Oil': ['#FFF0B0','#C08000'], 'Snacks': ['#FFE0C8','#C04A10'],
    'Canned Foods': ['#D8EED8','#2A6A2A'], 'Drinks': ['#CCE8FF','#1050A0'], 'Desserts': ['#FFD6E8','#A01850'],
  };
  const [bg, fg] = catColors[product.category] || ['#EEE','#555'];

  return (
    <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'transform .2s, box-shadow .2s', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='var(--shadow-lg)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='var(--shadow)'; }}>
      <div onClick={() => onView(product)} style={{ position: 'relative', background: bg, height: compact ? 120 : 150, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {product.img ? (
          <img src={product.img} alt={product.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <svg width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" rx="8" fill={bg}/><text x="30" y="36" textAnchor="middle" fontSize="28" fill={fg} fontFamily="sans-serif">{product.category[0]}</text></svg>
        )}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(product.stock || 0) <= 0 && (<span className="badge" style={{ background: '#1A1A1A', color: '#fff' }}>Sold out</span>)}
          {promoPct && (product.stock || 0) > 0 && <span className="badge" style={{ background: '#E03A2B', color: '#fff' }}>-{promoPct}%</span>}
          {product.bestseller && (product.stock || 0) > 0 && !promoPct && <span className="badge badge-green">Top</span>}
          {expiring && dl > 0 && dl <= 30 && <span className="badge badge-gold">Clearance</span>}
          {expiring && dl > 30 && dl <= 60 && <span className="badge badge-gold">Sale</span>}
        </div>
        {(product.stock || 0) <= 0 && (<div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.55)', pointerEvents: 'none' }} />)}
        {showFreshness && product.bestBefore && (
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <span style={{ background: 'rgba(255,255,255,.9)', borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: 'var(--warm-gray)' }}>BB: {new Date(product.bestBefore).toLocaleDateString('en-GB',{month:'short',year:'numeric'})}</span>
          </div>
        )}
      </div>
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
          </div>
          {(product.stock || 0) <= 0 ? (
            <button disabled style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'not-allowed' }}>Sold out</button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onAdd(product); }}
              style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, transition: 'background .2s' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--sage-dark)'} onMouseLeave={e => e.currentTarget.style.background='var(--sage)'}>+ Add</button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// DESIGN REFRESH primitives
// ─────────────────────────────────────────────────────────────────────────

// Price lockup: GHS / cedis / pesewas, three Gabarito spans on a baseline row.
const RPrice = ({ amount, size = 'md', color = 'var(--ink)', ghsColor = 'var(--rd-muted)' }) => {
  const n = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(n + 1e-6);
  const pes = Math.round((n - whole) * 100).toString().padStart(2, '0');
  const S = ({
    sm: { g: 11, c: 26, p: 13, gp: 5 },
    md: { g: 11, c: 32, p: 14, gp: 6 },
    lg: { g: 14, c: 60, p: 24, gp: 10 },
    squad: { g: 13, c: 46, p: 16, gp: 8 },
  })[size] || { g: 11, c: 32, p: 14, gp: 6 };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 3, fontFamily: 'var(--f-display)', color, lineHeight: 1 }}>
      <span style={{ fontSize: S.g, fontWeight: 500, letterSpacing: '.03em', paddingTop: S.gp, color: ghsColor }}>GHS</span>
      <span style={{ fontSize: S.c, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 0.88 }}>{whole}</span>
      <span style={{ fontSize: S.p, fontWeight: 800, letterSpacing: '-.01em', paddingTop: 2 }}>{pes}</span>
    </span>
  );
};

// Product cell for hairline grids/rails. Flat: no border/shadow/radius — the
// grid gutter (1px) draws the lines. Category label, name, mono unit, price
// lockup, and an underlined "Add".
const RCard = ({ product, onAdd, onView }) => {
  const p = product;
  const soldOut = (p.stock || 0) <= 0;
  const promoPct = (typeof window !== 'undefined' && window.PROMO_MAP && window.PROMO_MAP[p.id]) || 0;
  const price = promoPct ? +(p.price * (1 - promoPct / 100)).toFixed(2) : p.price;
  const view = () => onView && onView(p);
  return (
    <div className="rd-cell" style={{ background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <button onClick={view} aria-label={p.name}
        style={{ position: 'relative', border: 'none', padding: 0, cursor: 'pointer', background: '#fff', display: 'block', width: '100%', aspectRatio: '1', overflow: 'hidden' }}>
        {p.img ? (
          <img src={p.img} alt={p.name} loading="lazy" decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', opacity: soldOut ? 0.5 : 1 }}
            onError={e => { e.target.style.visibility = 'hidden'; }} />
        ) : (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 12, fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.04em', color: 'var(--rd-faint)', background: 'repeating-linear-gradient(135deg,#f4f4f1 0 6px,#eceae5 6px 12px)' }}>{p.category}</span>
        )}
        {(soldOut || promoPct) ? (
          <span style={{ position: 'absolute', top: 8, left: 8, fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '3px 7px', background: soldOut ? 'var(--ink)' : 'var(--accent)', color: '#fff' }}>{soldOut ? 'Sold out' : `-${promoPct}%`}</span>
        ) : null}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '14px 15px 16px', flex: 1 }}>
        <button onClick={view} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>{p.category}</span>
          <span style={{ fontFamily: 'var(--f-ui)', fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, letterSpacing: '-.012em', color: 'var(--ink)' }}>{p.name}</span>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--rd-faint)', marginTop: -2 }}>{p.unit || 'each'}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 14 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <RPrice amount={price} size="md" color={promoPct ? 'var(--accent)' : 'var(--ink)'} />
            {promoPct ? <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--rd-faint)', textDecoration: 'line-through' }}>GHS {p.price.toFixed(2)}</span> : null}
          </span>
          {soldOut ? (
            <span style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--rd-faint)' }}>Sold out</span>
          ) : (
            <button onClick={e => { e.stopPropagation(); onAdd(p); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink)', borderBottom: '2px solid var(--accent)', paddingBottom: 1 }}>Add</button>
          )}
        </div>
      </div>
    </div>
  );
};

// Section header: heading sits under a 2px ink rule, with an optional accent
// tag and a right-hand slot (usually a "See all →" link).
const RSectionHead = ({ title, serifPart, tag, right }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, borderTop: '2px solid var(--ink)', padding: '16px 0 22px' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: 'clamp(24px,4vw,34px)', fontWeight: 700, letterSpacing: '-.028em', color: 'var(--ink)' }}>
        {title}{serifPart ? <span style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontWeight: 400, letterSpacing: '-.01em' }}> {serifPart}</span> : null}
      </h2>
      {tag ? <span style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)' }}>{tag}</span> : null}
    </div>
    {right}
  </div>
);

const RSeeAll = ({ onClick, children }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', fontFamily: 'var(--f-label)', fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)', borderBottom: '1px solid var(--accent)', paddingBottom: 2 }}>{children || 'See all →'}</button>
);

// ─────────────────────────────────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────────────────────────────────
const HomePage = ({ onAdd, onView, setPage, setSelectedCategory }) => {
  const isMobile = useMobile();
  const goShop = () => { setSelectedCategory(null); setPage('category'); };
  const goCat = (c) => { setSelectedCategory(c); setPage('category'); };

  // Bestsellers — top by order frequency; synchronous fallback so it never empties.
  const [bestsellers, setBestsellers] = React.useState(() => {
    const flagged = window.PRODUCTS.filter(p => p.bestseller);
    if (flagged.length >= 10) return flagged.slice(0, 10);
    const pool = [...window.PRODUCTS];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return [...flagged, ...pool.filter(p => !p.bestseller)].slice(0, 10);
  });
  React.useEffect(() => {
    fetch('/api/products/top?limit=10').then(r => r.json()).then(d => { if (Array.isArray(d) && d.length) setBestsellers(d); }).catch(() => {});
  }, []);

  // Essentials
  const essentials = (window.ESSENTIALS || []).map(id => window.PRODUCTS.find(p => p.id === id)).filter(Boolean);
  const essentialsTotal = essentials.reduce((s, p) => s + (p.price || 0), 0);
  const addAllEssentials = () => essentials.forEach(p => (p.stock || 0) > 0 && onAdd(p));

  // Live delivered count + active promotions
  const [deliveredCount, setDeliveredCount] = React.useState(null);
  const [promos, setPromos] = React.useState([]);
  React.useEffect(() => {
    fetch('/api/stats/delivered-count').then(r => r.ok ? r.json() : { count: 0 }).then(d => setDeliveredCount(d.count)).catch(() => {});
    fetch('/api/promotions/active').then(r => r.ok ? r.json() : []).then(setPromos).catch(() => {});
    const t = setInterval(() => fetch('/api/stats/delivered-count').then(r => r.ok ? r.json() : null).then(d => d && setDeliveredCount(d.count)).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);

  // Suggested for You — personalized for signed-in customers, else store-wide top.
  const [myTopIds, setMyTopIds] = React.useState(null);
  React.useEffect(() => {
    let signedIn = false;
    try { const u = JSON.parse(sessionStorage.getItem('sdgmart_user') || 'null'); signedIn = !!(u && u.token && u.role !== 'guest'); } catch (_) {}
    if (!signedIn) return;
    apiFetch('/api/me/orders').then(r => r.ok ? r.json() : []).then(orders => {
      const counts = {};
      (orders || []).forEach(o => { let items = o.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } } (items || []).forEach(i => { if (!i.birthdayGift) counts[i.id] = (counts[i.id] || 0) + (i.qty || 1); }); });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id]) => Number(id));
      if (top.length) setMyTopIds(top);
    }).catch(() => {});
  }, []);
  const personalized = !!(myTopIds && myTopIds.length);
  const suggested = (personalized ? myTopIds : (window.TOP_IDS_BY_ORDERS || [])).slice(0, 8)
    .map(id => (window.PRODUCTS || []).find(p => p.id === id)).filter(p => p && (p.stock || 0) > 0).slice(0, 4);

  // Today's deals (active promos)
  const promoIds = {};
  promos.forEach(p => (p.productIds || []).forEach(id => { promoIds[id] = Math.max(promoIds[id] || 0, p.discountPercent); }));
  const dealProducts = window.PRODUCTS.filter(p => promoIds[p.id]).slice(0, 8);

  // Hero photo — the dark "grocery bags" shot. The other staged images in
  // /icons (hero-market / hero-produce / hero-fruit / hero-tomatoes /
  // hero-trolley) are candidates for the not-yet-built rotating hero.
  const HERO_BG = '/icons/hero.jpg';
  React.useEffect(() => {
    const link = document.createElement('link'); link.rel = 'preload'; link.as = 'image'; link.href = HERO_BG; link.fetchPriority = 'high';
    document.head.appendChild(link); return () => { try { document.head.removeChild(link); } catch (_) {} };
  }, []);

  const CAT_IMAGES = {
    'Rice & Grains': '/icons/categories/rice.jpg', 'Cooking Oil': '/icons/categories/cooking-oil.jpg',
    'Canned & Sauces': '/icons/categories/canned.jpg', 'Dairy & Eggs': '/icons/categories/dairy.jpg',
    'Drinks': '/icons/categories/drinks.jpg', 'Snacks & Biscuits': '/icons/categories/snacks.jpg',
    'Breakfast & Cereals': '/icons/categories/cereals.jpg', 'Spices & Seasoning': '/icons/categories/spices.jpg',
    'Baking & Sugar': '/icons/categories/baking.jpg', 'Coffee, Tea & Cocoa': '/icons/categories/coffee.jpg',
    'Fruits & Vegetables': '/icons/categories/fruits-veg.jpg', 'Staples (Tubers & Fufu)': '/icons/categories/staples.jpg',
    'Meat, Poultry & Seafood': '/icons/categories/meat.jpg', 'Toiletries & Personal Care': '/icons/categories/toiletries.jpg',
  };
  const DARK_STRIPES = 'repeating-linear-gradient(135deg,#1c1c19 0 8px,#141412 8px 16px)';

  const trust = [
    ['Same-Day Delivery', 'Order before 12pm, get it today in Tamale'],
    ['MoMo Payments', 'Secure Mobile Money checkout'],
    ['In-House Delivery', 'Our own riders, tracked to your door'],
  ];
  const cats = window.CATEGORIES || [];

  return (
    <div style={{ fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)' }}>

      {/* Active flash-sale strip */}
      {promos.length > 0 && (
        <div className="rd-gutter" style={{ background: 'var(--accent)', color: '#fff', textAlign: 'center', paddingTop: 10, paddingBottom: 10, fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {promos[0].title} — up to {promos[0].discountPercent}% off · ends {new Date(promos[0].endsAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      {/* ── Hero ── */}
      <section style={{ position: 'relative', minHeight: isMobile ? 420 : 460, display: 'flex', alignItems: 'center', overflow: 'hidden',
        backgroundColor: '#0d0d0b', backgroundImage: `linear-gradient(90deg,rgba(10,10,9,.82) 0%,rgba(10,10,9,.5) 52%,rgba(10,10,9,.32) 100%), url(${HERO_BG}), ${DARK_STRIPES}`, backgroundSize: 'cover, cover, auto', backgroundPosition: 'center' }}>
        <div className="rd-gutter" style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%', maxWidth: 760, paddingTop: 40, paddingBottom: 40 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' }}>
            <span style={{ color: 'var(--accent-light)' }}>Tamale's smart grocery service</span>
            {deliveredCount != null && deliveredCount > 0 && (<span style={{ color: '#8a8a82' }}>{deliveredCount.toLocaleString()} order{deliveredCount === 1 ? '' : 's'} served in Tamale</span>)}
          </div>
          <h1 style={{ margin: 0, lineHeight: 1.0, color: '#fff' }}>
            <span style={{ display: 'block', fontFamily: 'var(--f-hero)', fontWeight: 800, fontSize: isMobile ? 40 : 68, letterSpacing: '-.045em' }}>Fresh essentials,</span>
            <span style={{ display: 'block', fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontWeight: 400, fontSize: isMobile ? 44 : 76, letterSpacing: '-.015em', color: 'var(--accent-amber)', marginTop: 2 }}>delivered the same day.</span>
          </h1>
          <div style={{ fontSize: isMobile ? 15 : 16, lineHeight: 1.55, color: '#c9c9c2', maxWidth: 540 }}>Pantry staples, snacks, drinks and household goods — order before 12pm and we'll have it at your door today.</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 6 }}>
            <button onClick={goShop} style={{ background: '#fff', color: 'var(--ink)', border: 'none', cursor: 'pointer', padding: '14px 22px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' }}>Shop All Products →</button>
            <button onClick={() => setPage('squad')} style={{ background: 'transparent', color: '#fff', border: '1px solid #4a4a44', cursor: 'pointer', padding: '14px 22px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' }}>Join a Squad</button>
          </div>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 1, background: 'var(--dark-rule)' }}>
        {trust.map(([title, body]) => (
          <div key={title} className="rd-gutter" style={{ background: 'var(--ink)', paddingTop: 22, paddingBottom: 22, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontFamily: 'var(--f-label)', fontSize: 13, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>{title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--dark-body)' }}>{body}</div>
          </div>
        ))}
      </div>

      {/* ── Today's Deals (when a promo is live) ── */}
      {dealProducts.length > 0 && (
        <section className="rd-gutter" style={{ paddingTop: 44 }}>
          <RSectionHead title="Today's Deals" tag={promos[0] ? `Ends ${new Date(promos[0].endsAt).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : null}
            right={<RSeeAll onClick={goShop} />} />
          <div className="rd-grid rd-grid-4">{dealProducts.map(p => <RCard key={p.id} product={p} onAdd={onAdd} onView={onView} />)}</div>
        </section>
      )}

      {/* ── Household Essentials ── */}
      {essentials.length > 0 && (
        <section className="rd-gutter" style={{ paddingTop: 44 }}>
          <RSectionHead title="Household Essentials" tag="Editor's pick" right={<RSeeAll onClick={goShop} />} />
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)' }}>
            <div style={{ flex: 'none', width: isMobile ? 'auto' : 340, background: 'var(--ink)', color: '#fff', padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>This week's basket</div>
              <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 34, lineHeight: 1.05, letterSpacing: '-.015em' }}>The things you always run out of.</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--dark-body)', marginTop: isMobile ? 4 : 'auto' }}>Soap, bleach, tissue and dish liquid — restocked weekly and delivered with the rest of your order.</div>
              <div style={{ marginTop: 4 }}>
                <button onClick={addAllEssentials} style={{ background: 'var(--accent-light)', color: 'var(--ink)', border: 'none', cursor: 'pointer', padding: '12px 18px', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Add all {essentials.length} — GHS {essentialsTotal.toFixed(2)}</button>
              </div>
            </div>
            <div className="rd-rail" style={{ flex: 1, minWidth: 0, display: 'flex', gap: 1, overflowX: 'auto', background: 'var(--rule-2)' }}>
              {essentials.map(p => (
                <div key={p.id} className="rd-ess-item"><RCard product={p} onAdd={onAdd} onView={onView} /></div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Bestsellers ── */}
      <section className="rd-gutter" style={{ paddingTop: 44 }}>
        <RSectionHead title="Bestsellers" right={<RSeeAll onClick={goShop} />} />
        <div className="rd-grid rd-grid-5">{bestsellers.slice(0, 10).map(p => <RCard key={p.id} product={p} onAdd={onAdd} onView={onView} />)}</div>
      </section>

      {/* ── Suggested for You / Popular ── */}
      {suggested.length > 0 && (
        <section className="rd-gutter" style={{ paddingTop: 44 }}>
          <RSectionHead title={personalized ? 'Suggested' : 'Popular'} serifPart={personalized ? 'for you' : 'right now'}
            right={<span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>{personalized ? 'Running low on your regulars' : 'What Tamale is ordering'}</span>} />
          <div className="rd-grid rd-grid-4">{suggested.map(p => <RCard key={p.id} product={p} onAdd={onAdd} onView={onView} />)}</div>
        </section>
      )}

      {/* ── Shop by Category ── */}
      <section className="rd-gutter" style={{ paddingTop: 44 }}>
        <RSectionHead title="Shop by Category" right={<span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>{cats.length} categories</span>} />
        <div className="rd-cats">
          {cats.map(cat => {
            const img = CAT_IMAGES[cat];
            const count = window.PRODUCTS.filter(p => p.category === cat).length;
            return (
              <button key={cat} className="rd-tile" onClick={() => goCat(cat)}
                style={{ position: 'relative', border: 'none', cursor: 'pointer', padding: 13, aspectRatio: '0.92', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', textAlign: 'left', overflow: 'hidden', background: DARK_STRIPES }}>
                {img && <img src={img} alt="" loading="lazy" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(10,10,8,.7) 0%, rgba(10,10,8,.05) 60%, transparent 100%)' }} />
                <div style={{ position: 'relative', fontFamily: 'var(--f-label)', fontSize: 14, fontWeight: 700, letterSpacing: '.01em', textTransform: 'uppercase', color: '#fff', lineHeight: 1.15 }}>{cat}</div>
                <div style={{ position: 'relative', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.08em', color: '#cfcfc7', paddingTop: 4 }}>{count} items →</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Clearance (freshness on) ── */}
      {window.SHOW_FRESHNESS === true && (() => {
        const clearance = window.PRODUCTS.filter(p => { if (!p.bestBefore) return false; const days = Math.ceil((new Date(p.bestBefore) - new Date()) / (1000 * 60 * 60 * 24)); return days <= 60 && days > 0; }).slice(0, 4);
        if (!clearance.length) return null;
        return (
          <section className="rd-gutter" style={{ paddingTop: 44 }}>
            <RSectionHead title="Clearance" serifPart="expiring soon" tag="Auto-discounted" />
            <div className="rd-grid rd-grid-4">{clearance.map(p => <RCard key={p.id} product={p} onAdd={onAdd} onView={onView} />)}</div>
          </section>
        );
      })()}

      {/* ── Request an item ── */}
      <section style={{ marginTop: 56, borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', background: 'var(--surface-warm)' }}>
        <div className="rd-gutter" style={{ paddingTop: 64, paddingBottom: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)' }}>Special requests</div>
          <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: isMobile ? 26 : 32, fontWeight: 700, letterSpacing: '-.028em' }}>Looking for something we don't have?</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--rd-body)', maxWidth: 520 }}>Tell us what you need. If we can source it locally, we'll WhatsApp you with a price and timeline.</p>
          <div style={{ marginTop: 8 }}>
            <RequestProductButton label="Request an item"
              style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '14px 24px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' }} />
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: 'var(--ink)', color: '#fff' }}>
        <div className="rd-gutter" style={{ paddingTop: 56, paddingBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.4fr 1fr 1fr 1fr', gap: isMobile ? 28 : 40, paddingBottom: 48 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, gridColumn: isMobile ? '1 / -1' : 'auto' }}>
              <div style={{ fontFamily: 'var(--f-mark)', fontSize: 20, fontWeight: 700, letterSpacing: '-.035em' }}>SDGMart</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--dark-body)', maxWidth: 280 }}>Tamale's smart grocery service. Fresh essentials delivered to your neighborhood.</div>
            </div>
            {(() => {
              const goHome = () => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
              const wa = (text) => window.open(`https://wa.me/233599189773${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener');
              const sections = [
                ['Shop', [['Bestsellers', goHome], ['Rice & Grains', () => goCat('Rice & Grains')], ['Drinks', () => goCat('Drinks')], ['Fruits & Vegetables', () => goCat('Fruits & Vegetables')]]],
                ['Customer Care', [['Track Order & Delivery', () => setPage('orders')], ['Returns', () => { window.location.href = '/terms#returns'; }], ['WhatsApp Us', () => wa('')]]],
                ['Company', [['About SDGMart', () => { window.location.href = '/about'; }], ['Squad Programme', () => setPage('squad')], ['Family Mode', () => setPage('checkout')], ['Contact Us', () => wa('Hi! I would like to get in touch with SDGMart.')]]],
              ];
              return sections.map(([title, links]) => (
                <div key={title} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>{title}</div>
                  {links.map(([label, action]) => (
                    <button key={label} onClick={action} className="rd-foot-link"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'var(--f-ui)', fontSize: 13.5, color: 'var(--dark-body)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#fff'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--dark-body)'; }}>{label}</button>
                  ))}
                </div>
              ));
            })()}
          </div>

          <div style={{ maxWidth: 640 }}><FeedbackBox dark /></div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 44, paddingTop: 18, borderTop: '1px solid var(--dark-rule)', fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>
            <span>© 2026 SDGMart. Tamale, Ghana. All rights reserved.</span>
            <span style={{ display: 'flex', gap: 18 }}>
              <a href="/privacy" style={{ color: 'inherit' }}>Privacy</a><a href="/terms" style={{ color: 'inherit' }}>Terms</a><span>MoMo Payments</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

Object.assign(window, { HomePage, ProductCard, RCard, RPrice, RSectionHead, RSeeAll });
