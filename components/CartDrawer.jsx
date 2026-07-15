// CartDrawer — slide-in cart panel
const CartDrawer = ({ cart, setCart, setPage, onClose }) => {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };
  const remove = (id) => setCart(prev => prev.filter(i => i.id !== id));

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.45)', zIndex: 200, backdropFilter: 'blur(2px)' }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, height: '100vh', width: 420, maxWidth: '95vw',
        background: 'var(--white)', zIndex: 201, boxShadow: '-8px 0 40px rgba(0,0,0,.18)',
        display: 'flex', flexDirection: 'column', animation: 'slideIn .25s ease-out',
      }}>
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700 }}>Your Cart ({cart.reduce((s,i)=>s+i.qty,0)})</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {cart.length > 0 && (
              <button onClick={() => { if (window.confirm('Remove all items from your cart?')) setCart([]); }}
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-red)', background: 'rgba(192,57,43,.08)', borderRadius: 8, padding: '6px 12px' }}>
                Clear all
              </button>
            )}
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--warm-gray)' }}>×</button>
          </div>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--warm-gray)' }}>
              <div style={{ fontSize: 48 }}>☀️</div>
              <div style={{ fontWeight: 700, marginTop: 12, fontSize: 15 }}>Your cart is dustier than harmattan</div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5, maxWidth: 280, margin: '6px auto 0' }}>Drop something in to cool it down.</div>
            </div>
          ) : cart.map(item => (
            <div key={item.id} style={{ display: 'flex', gap: 14, padding: '14px 0', borderBottom: '1px solid var(--cream-dark)', alignItems: 'center' }}>
              {/* Mini product image */}
              <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--cream)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                {['🌾','🥛','🧴','🍚','🫙','🍪','🥫','🥤','🍫'][window.CATEGORIES.indexOf(item.category)] || '📦'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                <div style={{ fontSize: 12, color: 'var(--warm-gray)' }}>{item.unit}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--sage-dark)', marginTop: 2 }}>GHS {(item.price * item.qty).toFixed(2)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1.5px solid var(--cream-dark)', borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => updateQty(item.id, -1)} style={{ width: 28, height: 28, fontSize: 16, color: 'var(--warm-gray)', background: 'var(--cream)' }}>−</button>
                  <span style={{ width: 28, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)} style={{ width: 28, height: 28, fontSize: 14, color: 'var(--sage)', background: 'var(--cream)' }}>+</button>
                </div>
                <button onClick={() => remove(item.id)} style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 600 }}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div style={{ padding: '20px 24px', borderTop: '1px solid var(--cream-dark)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--warm-gray)', fontSize: 14 }}>Subtotal</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>GHS {total.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--warm-gray)', fontSize: 13 }}>Delivery</span>
              <span style={{ fontSize: 13, color: total >= 150 ? 'var(--sage)' : 'var(--warm-gray)', fontWeight: total >= 150 ? 700 : 400 }}>{total >= 150 ? 'FREE 🎉' : 'GHS 10.00'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, paddingTop: 10, borderTop: '1.5px solid var(--cream-dark)' }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--sage-dark)' }}>GHS {(total + (total >= 150 ? 0 : 10)).toFixed(2)}</span>
            </div>
            <button onClick={() => { onClose(); setPage('checkout'); }}
              style={{ width: '100%', background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 15, transition: 'background .2s' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--sage-dark)'}
              onMouseLeave={e => e.currentTarget.style.background='var(--sage)'}>
              Proceed to Checkout →
            </button>
            <button onClick={onClose}
              style={{ width: '100%', marginTop: 8, background: 'transparent', color: 'var(--warm-gray)', padding: '10px', fontSize: 13, fontWeight: 600 }}>
              Continue Shopping
            </button>
          </div>
        )}
      </div>
    </>
  );
};

Object.assign(window, { CartDrawer });
