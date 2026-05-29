// Notify-me block shown when a product is out of stock. Opens WhatsApp so
// the customer can ping the admin directly to be notified when stock returns.
const OutOfStockBlock = ({ product }) => {
  const notify = () => {
    const msg = encodeURIComponent(`Hi SDGMart! Please notify me when "${product.name}" (${product.unit}) is back in stock.`);
    window.open(`https://wa.me/233504082555?text=${msg}`, '_blank', 'noopener');
  };
  return (
    <div style={{ marginTop: 28, padding: 20, background: 'var(--cream)', border: '1.5px dashed var(--cream-dark)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>🥵</span>
        <span style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700 }}>This one's gone</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--warm-gray)', lineHeight: 1.55, marginBottom: 14 }}>
        Vanished faster than the last cold sachet on a 38° afternoon. We'll restock soon.
      </p>
      <button onClick={notify}
        style={{ width: '100%', background: '#25D366', color: '#fff', borderRadius: 10, padding: '12px 18px', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        💬 Notify me on WhatsApp
      </button>
    </div>
  );
};

// ProductPage — full product detail
const ProductPage = ({ product, onAdd, setPage, setSelectedCategory }) => {
  const [qty, setQty] = React.useState(1);
  const [added, setAdded] = React.useState(false);
  const isMobile = useMobile();

  if (!product) return null;

  const related = window.PRODUCTS.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  const daysLeft = Math.ceil((new Date(product.bestBefore) - new Date()) / (1000 * 60 * 60 * 24));
  const discount = daysLeft <= 30 ? 0.15 : daysLeft <= 60 ? 0.10 : 0;
  const finalPrice = product.price * (1 - discount);

  const catColors = {
    'Cereals': ['#FDEBD0','#C0622A'], 'Dairy': ['#DBEEFF','#2A6FAF'],
    'Detergents': ['#D4F4DD','#1E7A3A'], 'Rice & Grains': ['#FFF3D4','#B07A10'],
    'Cooking Oil': ['#FFF0B0','#C08000'], 'Snacks': ['#FFE0C8','#C04A10'],
    'Canned Foods': ['#D8EED8','#2A6A2A'], 'Drinks': ['#CCE8FF','#1050A0'],
    'Desserts': ['#FFD6E8','#A01850'],
  };
  const [bg, fg] = catColors[product.category] || ['#EEE','#555'];

  const handleAdd = () => {
    for (let i = 0; i < qty; i++) onAdd(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '16px' : '28px 24px' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24, fontSize: 13, color: 'var(--warm-gray)' }}>
        <button onClick={() => setPage('home')} style={{ color: 'var(--sage)', fontWeight: 600 }}>Home</button>
        <span>›</span>
        <button onClick={() => { setSelectedCategory(product.category); setPage('category'); }} style={{ color: 'var(--sage)', fontWeight: 600 }}>{product.category}</button>
        <span>›</span>
        <span style={{ color: 'var(--warm-black)', fontWeight: 600 }}>{product.name}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 20 : 48, alignItems: 'start' }}>
        {/* Image */}
        <div style={{ background: bg, borderRadius: 'var(--radius-lg)', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <svg width="120" height="120" viewBox="0 0 120 120">
            <rect width="120" height="120" rx="12" fill={bg}/>
            <text x="60" y="72" textAnchor="middle" fontSize="56" fill={fg} fontFamily="sans-serif">{product.category[0]}</text>
          </svg>
          {product.bestseller && (
            <div style={{ position: 'absolute', top: 16, left: 16 }}>
              <span className="badge badge-green" style={{ fontSize: 13, padding: '4px 12px' }}>★ Bestseller</span>
            </div>
          )}
          {discount > 0 && (
            <div style={{ position: 'absolute', top: 16, right: 16 }}>
              <span className="badge badge-sale" style={{ fontSize: 13, padding: '4px 12px' }}>-{Math.round(discount*100)}% OFF</span>
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--warm-gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>{product.category}</div>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 700, marginTop: 6, lineHeight: 1.2 }}>{product.name}</h1>
          <div style={{ fontSize: 14, color: 'var(--warm-gray)', marginTop: 6 }}>{product.unit}</div>

          <div style={{ marginTop: 20 }}>
            {discount > 0 ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 36, fontWeight: 700, color: 'var(--sage-dark)' }}>GHS {finalPrice.toFixed(2)}</span>
                <span style={{ fontSize: 18, color: 'var(--warm-gray)', textDecoration: 'line-through' }}>GHS {product.price.toFixed(2)}</span>
              </div>
            ) : (
              <span style={{ fontFamily: 'var(--font-head)', fontSize: 36, fontWeight: 700, color: 'var(--sage-dark)' }}>GHS {product.price.toFixed(2)}</span>
            )}
          </div>

          {/* Freshness */}
          <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ background: daysLeft <= 30 ? 'rgba(192,57,43,.1)' : 'rgba(0,0,0,.06)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Best Before</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: daysLeft <= 30 ? 'var(--accent-red)' : 'var(--sage-dark)', marginTop: 2 }}>
                {new Date(product.bestBefore).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginTop: 2 }}>{daysLeft} days remaining</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,.06)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>In Stock</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--sage-dark)', marginTop: 2 }}>{product.stock} units</div>
            </div>
          </div>

          <p style={{ marginTop: 20, fontSize: 15, color: 'var(--warm-gray)', lineHeight: 1.7 }}>{product.description}</p>

          {/* Qty + Add — or Out-of-stock state */}
          {(product.stock || 0) <= 0 ? (
            <OutOfStockBlock product={product} />
          ) : (
            <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '2px solid var(--cream-dark)', borderRadius: 10, overflow: 'hidden' }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))}
                  style={{ width: 40, height: 44, fontSize: 20, fontWeight: 700, color: 'var(--warm-gray)', background: 'var(--cream)' }}>−</button>
                <span style={{ width: 44, textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{qty}</span>
                <button onClick={() => setQty(q => Math.min((product.stock || 99), q + 1))}
                  style={{ width: 40, height: 44, fontSize: 20, fontWeight: 700, color: 'var(--sage)', background: 'var(--cream)' }}>+</button>
              </div>
              <button onClick={handleAdd}
                style={{ flex: 1, minWidth: 180, background: added ? 'var(--sage-dark)' : 'var(--sage)', color: '#fff', borderRadius: 10, padding: '12px 24px', fontWeight: 700, fontSize: 15, transition: 'background .2s, transform .1s', transform: added ? 'scale(.97)' : 'scale(1)' }}>
                {added ? '✓ Added to Cart!' : `Add ${qty > 1 ? qty + 'x' : ''} to Cart — GHS ${(finalPrice * qty).toFixed(2)}`}
              </button>
            </div>
          )}
          {(product.stock || 0) > 0 && (product.stock || 0) < 10 && (
            <div style={{ marginTop: 10, color: 'var(--accent-red)', fontSize: 12, fontWeight: 700 }}>
              ⚠ Only {product.stock} left in stock
            </div>
          )}

          {/* Family mode hint */}
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--cream-dark)', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 18 }}>🎁</span>
            <div style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>Ordering for someone else?</span>
              <span style={{ color: 'var(--warm-gray)' }}> Use Family Mode at checkout to send a gift with a custom message.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Related products */}
      {related.length > 0 && (
        <section style={{ marginTop: 56 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 20 }}>More from <em>{product.category}</em></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 16 }}>
            {related.map(p => <ProductCard key={p.id} product={p} onAdd={onAdd} onView={() => {}} compact />)}
          </div>
        </section>
      )}
    </div>
  );
};

Object.assign(window, { ProductPage });
