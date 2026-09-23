const bundleButtonStyle = { background: 'var(--ink)', color: '#fff', border: '1px solid var(--ink)', borderRadius: 0, padding: '13px 18px', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' };
const BundlePhoto = ({ bundle, compact = false }) => (
  bundle.img ? <img src={bundle.img} alt={bundle.name} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} /> :
  <div role="img" aria-label={`Products included in ${bundle.name}`} style={{ width: '100%', height: '100%', background: '#fff', boxSizing: 'border-box', padding: compact ? 3 : '6%', display: 'grid', gridTemplateColumns: `repeat(${(bundle.contents || []).length <= 4 ? 2 : 3},minmax(0,1fr))`, gridAutoRows: 'minmax(0,1fr)', gap: compact ? 2 : 12 }}>
    {(bundle.contents || []).map(p => <div key={p.productId} style={{ minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {p.img ? <img src={p.img} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: compact ? 6 : 12, textAlign: 'center' }}>{p.name}</span>}
    </div>)}
  </div>
);
const BundleContents = ({ item, expanded = false }) => <details open={expanded || undefined} style={{ fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>
  <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>Included in each bundle ({item.contents?.length || 0} products)</summary>
  <ul style={{ paddingLeft: 18, margin: '8px 0' }}>{(item.contents || []).map(p => <li key={p.productId}>{p.quantity} × {p.name} · {p.unit}</li>)}</ul>
</details>;
const BundlesSection = ({ onView }) => {
  const bundles = window.BUNDLES || [];
  const groups = ['Breakfast', 'Home Essentials', 'Cooking Essentials'].map(name => ({ name, variants: bundles.filter(b => b.category === name && b.active && b.valid) })).filter(g => g.variants.length);
  if (!groups.length) return null;
  return <section className="rd-gutter" style={{ paddingTop: 44 }} aria-label="Shop bundles">
    <RSectionHead title="Better together" serifPart="shop bundles" />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 20 }}>
      {groups.map(g => {
        const first = g.variants[0], hero = g.variants[g.variants.length - 1];
        return <button key={g.name} onClick={() => onView(first)} style={{ background: '#fff', border: '1px solid var(--rule-2)', padding: 0, textAlign: 'left', color: 'var(--ink)', cursor: 'pointer' }}>
          <div style={{ aspectRatio: '1.45', overflow: 'hidden' }}><BundlePhoto bundle={hero} /></div>
          <div style={{ padding: 20, borderTop: '1px solid var(--rule)' }}>
            <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 24, margin: '0 0 8px' }}>{g.name}</h3>
            <div style={{ fontSize: 13, color: 'var(--rd-muted)' }}>{g.variants.length} fixed bundles · From GHS {Math.min(...g.variants.map(b => b.price)).toFixed(2)}</div>
            <div style={{ fontSize: 11, color: 'var(--rd-muted)', marginTop: 8 }}>Pictured: {hero.name}. Contents vary by bundle.</div>
            <div style={{ marginTop: 14, fontFamily: 'var(--f-label)', fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>CHOOSE YOUR BUNDLE →</div>
          </div>
        </button>;
      })}
    </div>
  </section>;
};
const BundleProductPage = ({ product, onAdd, onView, setPage }) => {
  const [qty, setQty] = React.useState(1);
  const [added, setAdded] = React.useState(false);
  const mobile = useMobile();
  const bundle = (window.BUNDLES || []).find(b => b.id === product.id);
  const variants = (window.BUNDLES || []).filter(b => b.category === product.category && b.valid);
  if (!bundle) return <div className="rd-gutter" style={{ paddingTop: 36, paddingBottom: 48 }}><h1>This bundle is currently unavailable</h1><button style={bundleButtonStyle} onClick={() => setPage('home')}>Back to shop</button></div>;
  const available = bundle.valid && bundle.active && bundle.stock > 0;
  return <div className="rd-gutter" style={{ paddingTop: 28, paddingBottom: 56, color: 'var(--ink)' }}>
    <button onClick={() => setPage('home')} style={{ background: 'none', border: 0, padding: 0, fontSize: 13 }}>← Back to shop</button>
    <h1 style={{ fontFamily: 'var(--f-display)', fontSize: mobile ? 30 : 40, margin: '24px 0 16px' }}>{bundle.category} bundles</h1>
    <div role="group" aria-label="Choose bundle variation" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
      {variants.map(b => <button key={b.id} aria-pressed={b.id === bundle.id} onClick={() => onView(b)} style={{ ...bundleButtonStyle, background: b.id === bundle.id ? 'var(--ink)' : '#fff', color: b.id === bundle.id ? '#fff' : 'var(--ink)' }}>{b.name} · GHS {b.price.toFixed(2)}</button>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', border: '1px solid var(--rule-2)', gap: 24, padding: mobile ? 16 : 28 }}>
      <div style={{ aspectRatio: '1.1', minWidth: 0 }}><BundlePhoto bundle={bundle} /></div>
      <div style={{ alignSelf: 'center' }}>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 30, marginBottom: 12 }}>{bundle.name}</h2>
        <p style={{ color: 'var(--rd-body)', lineHeight: 1.6 }}>{bundle.description}</p>
        <div style={{ fontSize: 14, marginTop: 20 }}>Bought separately: <s>GHS {bundle.regularTotal.toFixed(2)}</s></div>
        <div style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: 34, marginTop: 8 }}>GHS {bundle.price.toFixed(2)}</div>
        <div style={{ color: 'var(--accent)', marginTop: 8, fontWeight: 600 }}>Save GHS {bundle.saving.toFixed(2)} per bundle</div>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '20px 0' }}>Contents are fixed. You can add other products separately; they keep their individual prices.</p>
        {available ? <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12 }}>Bundles<input aria-label="Number of bundles" type="number" min={1} max={window.SHOW_STOCK ? Math.min(99,bundle.stock) : 99} value={qty} onChange={e => setQty(Math.max(1, Math.min(99,Math.floor(Number(e.target.value)) || 1)))} style={{ display: 'block', width: 72, fontSize: 16, padding: 10, border: '1px solid var(--border-input)' }} /></label>
          <button style={{ ...bundleButtonStyle, flex: 1 }} onClick={() => { for(let i=0;i<qty;i++) onAdd(bundle); setAdded(true); }}>{added ? 'Add another' : 'Add bundle'} — GHS {(bundle.price * qty).toFixed(2)}</button>
        </div> : <p role="status">This complete bundle is currently unavailable.</p>}
        {added && <p role="status" style={{ fontSize: 13 }}>Added to your cart.</p>}
      </div>
    </div>
    <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 26, marginTop: 36 }}>What’s included</h2>
    <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 12 }}>
      {bundle.contents.map(p => <div key={p.productId} style={{ display: 'flex', gap: 14, padding: 14, border: '1px solid var(--rule-2)', alignItems: 'center' }}>
        <img src={p.img || undefined} alt={p.name} style={{ width: 76, height: 76, objectFit: 'contain' }} />
        <div style={{ minWidth: 0, fontSize: 14 }}><strong>{p.name}</strong><div style={{ color: 'var(--rd-muted)', marginTop: 6 }}>{p.quantity} × {p.unit}</div><div style={{ fontSize: 12, marginTop: 4 }}>Separately: GHS {(p.price * p.quantity).toFixed(2)}</div></div>
      </div>)}
    </div>
  </div>;
};
const RequestItemsSection = ({ searchQuery, currentUser }) => <section style={{ marginTop: 56, borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', background: 'var(--surface-warm)' }}>
  <div className="rd-gutter" style={{ paddingTop: 48, paddingBottom: 48, textAlign: 'center' }}>
    <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '.12em', color: 'var(--accent)' }}>SPECIAL REQUESTS</div>
    <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, margin: '14px 0' }}>Looking for something we don't have?</h2>
    <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--rd-body)', margin: '0 auto 20px', maxWidth: 520 }}>Tell us what you need. We'll check availability and contact you with a price and timeline.</p>
    <RequestProductButton currentUser={currentUser} prefillProduct={searchQuery || ''} label="Request an item" style={bundleButtonStyle} />
  </div>
</section>;
Object.assign(window, { BundlePhoto, BundleContents, BundlesSection, BundleProductPage, RequestItemsSection });
