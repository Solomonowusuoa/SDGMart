// OutOfStockBlock — shown when a product is out of stock; opens WhatsApp so the
// customer can ask the admin to notify them when it's back.
const OutOfStockBlock = ({ product }) => {
  const notify = () => {
    const msg = encodeURIComponent(`Hi SDGMart! Please notify me when "${product.name}" (${product.unit}) is back in stock.`);
    window.open(`https://wa.me/233504082555?text=${msg}`, '_blank', 'noopener');
  };
  return (
    <div style={{ marginTop: 4, padding: '20px 22px', border: '1px dashed var(--border-input)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 24, color: 'var(--ink)', lineHeight: 1.15 }}>This one's gone for now.</div>
      <p style={{ fontSize: 13.5, color: 'var(--rd-muted)', lineHeight: 1.55, margin: 0 }}>We'll restock soon — tap below and we'll message you the moment it's back.</p>
      <button onClick={notify}
        style={{ background: 'var(--wa)', color: '#fff', border: 'none', cursor: 'pointer', padding: '13px 18px', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', alignSelf: 'flex-start' }}>Notify me on WhatsApp</button>
    </div>
  );
};

// ProductPage — full product detail (design refresh)
const ProductPage = ({ product, onAdd, setPage, setSelectedCategory, onView }) => {
  const [qty, setQty] = React.useState(1);
  const [added, setAdded] = React.useState(false);
  const isMobile = useMobile();
  if (!product) return null;

  const showFreshness = typeof window !== 'undefined' && window.SHOW_FRESHNESS === true;
  const related = window.PRODUCTS.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  const daysLeft = product.bestBefore ? Math.ceil((new Date(product.bestBefore) - new Date()) / (1000 * 60 * 60 * 24)) : Infinity;
  const promoPct = (typeof window !== 'undefined' && window.PROMO_MAP) ? window.PROMO_MAP[product.id] : 0;
  const freshDiscount = showFreshness ? (daysLeft <= 30 ? 0.15 : daysLeft <= 60 ? 0.10 : 0) : 0;
  const discount = promoPct ? promoPct / 100 : freshDiscount;
  const finalPrice = +(product.price * (1 - discount)).toFixed(2);
  const soldOut = (product.stock || 0) <= 0;

  const handleAdd = () => {
    for (let i = 0; i < qty; i++) onAdd(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const crumb = { fontFamily: 'var(--f-mono)', fontSize: 11.5, fontWeight: 500, letterSpacing: '.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 };

  return (
    <div className="rd-gutter" style={{ fontFamily: 'var(--f-ui)', color: 'var(--ink)', paddingTop: 22, paddingBottom: 56, background: 'var(--panel)' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: '#55554e' }}>
        <button onClick={() => setPage('home')} style={{ ...crumb, color: '#55554e' }}>Home</button>
        <span style={crumb}>/</span>
        <button onClick={() => { setSelectedCategory(product.category); setPage('category'); }} style={{ ...crumb, color: '#55554e' }}>{product.category}</button>
        <span style={crumb}>/</span>
        <span style={{ ...crumb, color: 'var(--ink)' }}>{product.name}</span>
      </div>

      {/* Image + details, hairline two-column */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)', marginTop: 22 }}>
        <div style={{ position: 'relative', background: '#fff', aspectRatio: isMobile ? '1.2' : '1.02', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {product.img
            ? <img src={product.img} alt={product.name} decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={e => { e.target.style.visibility = 'hidden'; }} />
            : <span style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg,#f4f4f1 0 6px,#eceae5 6px 12px)' }} />}
          {product.bestseller && !soldOut && discount <= 0 && (
            <span style={{ position: 'absolute', top: 16, left: 16, fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 9px', background: 'var(--ink)', color: '#fff' }}>Bestseller</span>
          )}
          {discount > 0 && (
            <span style={{ position: 'absolute', top: 16, right: 16, fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 9px', background: 'var(--accent)', color: '#fff' }}>−{Math.round(discount * 100)}% off</span>
          )}
        </div>

        <div style={{ background: '#fff', padding: isMobile ? '24px 20px' : '40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)' }}>{product.category}</div>
          <h1 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: isMobile ? 30 : 44, fontWeight: 700, lineHeight: 1.04, letterSpacing: '-.03em' }}>{product.name}</h1>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--rd-faint)' }}>{product.unit || 'each'} · {soldOut ? 'sold out' : 'in stock'}</div>

          <div style={{ borderTop: '2px solid var(--ink)', paddingTop: 18, display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
            <RPrice amount={finalPrice} size="lg" color={discount > 0 ? 'var(--accent)' : 'var(--ink)'} />
            {discount > 0 && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--rd-faint)', textDecoration: 'line-through', paddingBottom: 6 }}>GHS {product.price.toFixed(2)}</span>}
          </div>

          {soldOut ? <OutOfStockBlock product={product} /> : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-input)' }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Decrease" style={{ padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rd-muted)', fontSize: 16 }}>−</button>
                <span style={{ padding: '13px 6px', minWidth: 26, textAlign: 'center', fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 16 }}>{qty}</span>
                <button onClick={() => setQty(q => Math.min(window.SHOW_STOCK === true ? (product.stock || 99) : 99, q + 1))} aria-label="Increase" style={{ padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontSize: 16 }}>+</button>
              </div>
              <button onClick={handleAdd}
                style={{ flex: 1, minWidth: 200, background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '15px 22px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' }}>
                {added ? 'Added to cart ✓' : `Add to Cart — GHS ${(finalPrice * qty).toFixed(2)}`}
              </button>
            </div>
          )}

          {product.description && (
            <p style={{ margin: 0, fontSize: 14.5, color: 'var(--rd-body)', lineHeight: 1.7 }}>{product.description}</p>
          )}

          <div style={{ border: '1px solid var(--rule-2)', background: 'var(--surface-warm)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent)' }}>Ordering for someone else?</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--rd-body)' }}>Use Family Mode at checkout to send a gift with a custom message.</div>
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: 26, flexWrap: 'wrap', paddingTop: 18, borderTop: '1px solid var(--rule)', fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>
            <span>Same-day before 12pm</span><span>MoMo or cash</span><span>Own riders</span>
          </div>
        </div>
      </div>

      {/* More from category */}
      {related.length > 0 && (
        <section style={{ paddingTop: 48 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderTop: '2px solid var(--ink)', padding: '16px 0 22px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-.028em' }}>More from</h2>
            <span style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 30, color: 'var(--accent)' }}>{product.category}</span>
          </div>
          <div className="rd-grid rd-grid-4">
            {related.map(p => <RCard key={p.id} product={p} onAdd={onAdd} onView={onView || (() => {})} />)}
          </div>
        </section>
      )}
    </div>
  );
};

Object.assign(window, { ProductPage });
