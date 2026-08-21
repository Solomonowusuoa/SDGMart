// CartDrawer — slide-in cart panel (design refresh)
const CartDrawer = ({ cart, setCart, setPage, onClose, currentUser }) => {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const count = cart.reduce((s, i) => s + i.qty, 0);
  // Delivery preview — mirrors CheckoutPage so the cart isn't misleading.
  // Free over GHS 150 for everyone; signed-in members also get their FIRST
  // order delivered free once it reaches GHS 50.
  const FREE_DELIVERY_MIN = 150;
  const FIRST_ORDER_FREE_MIN = 50;
  const STANDARD_DELIVERY = 10;
  const isFirstOrderEligible = !!(currentUser && currentUser.id && currentUser.role !== 'guest' && currentUser.firstOrderDone === false);
  const isFirstOrderFree = isFirstOrderEligible && subtotal >= FIRST_ORDER_FREE_MIN;
  const qualifiesFreeByThreshold = subtotal >= FREE_DELIVERY_MIN;
  const delivery = (isFirstOrderFree || qualifiesFreeByThreshold) ? 0 : STANDARD_DELIVERY;

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };
  const remove = (id) => setCart(prev => prev.filter(i => i.id !== id));

  const label = { fontFamily: 'var(--f-label)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.42)', zIndex: 200 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 400, maxWidth: '95vw', background: 'var(--panel)', zIndex: 201,
        borderLeft: '1px solid var(--border-input)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--f-ui)', color: 'var(--ink)', animation: 'slideIn .25s ease-out' }}>
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-.028em' }}>Your Cart</span>
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>{count}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {cart.length > 0 && (
              <button onClick={() => { if (window.confirm('Remove all items from your cart?')) setCart([]); }}
                style={{ ...label, background: 'none', border: 'none', fontSize: 12, color: 'var(--accent)' }}>Clear all</button>
            )}
            <button onClick={onClose} aria-label="Close cart" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rd-faint)', fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
          </div>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cart.length === 0 ? (
            <div style={{ padding: '64px 28px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 26, color: 'var(--ink)', lineHeight: 1.2 }}>Your cart is empty.</div>
              <div style={{ fontSize: 13.5, color: 'var(--rd-muted)', marginTop: 10, lineHeight: 1.6 }}>Add a few essentials and they'll show up here.</div>
              <button onClick={onClose} style={{ ...label, marginTop: 18, background: 'var(--ink)', color: '#fff', border: 'none', padding: '12px 20px', fontSize: 12.5 }}>Start shopping</button>
            </div>
          ) : cart.map(item => (
            <div key={item.id} style={{ display: 'flex', gap: 14, padding: '20px 24px', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ width: 64, height: 64, flex: 'none', background: '#fff', border: '1px solid var(--rule-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {item.img
                  ? <img src={item.img} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={e => { e.target.style.visibility = 'hidden'; }} />
                  : <span style={{ width: '100%', height: '100%', background: 'repeating-linear-gradient(135deg,#f4f4f1 0 6px,#eceae5 6px 12px)' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-.012em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--rd-faint)' }}>{item.unit || 'each'}</div>
                <div style={{ paddingTop: 2 }}><RPrice amount={item.price * item.qty} size="sm" /></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-input)' }}>
                  <button onClick={() => updateQty(item.id, -1)} aria-label="Decrease" style={{ padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rd-muted)', fontSize: 14 }}>−</button>
                  <span style={{ padding: '6px 4px', minWidth: 22, textAlign: 'center', fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 13 }}>{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)} aria-label="Increase" style={{ padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontSize: 14 }}>+</button>
                </div>
                <button onClick={() => remove(item.id)} style={{ ...label, background: 'none', border: 'none', fontSize: 11.5, color: 'var(--rd-faint)' }}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div style={{ padding: '22px 24px', borderTop: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--rd-muted)' }}>Subtotal</span>
              <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700 }}>GHS {subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
              <span style={{ color: 'var(--rd-muted)' }}>Delivery</span>
              <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, color: delivery === 0 ? 'var(--wa)' : 'var(--ink)' }}>{delivery === 0 ? 'FREE' : `GHS ${STANDARD_DELIVERY.toFixed(2)}`}</span>
            </div>
            {/* First-order free-delivery message / nudge (signed-in members) */}
            {isFirstOrderFree && (
              <div style={{ border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--wa)', background: 'var(--surface-warm)', padding: '10px 13px', fontSize: 12, lineHeight: 1.5, color: 'var(--rd-body)' }}>
                <strong style={{ color: 'var(--ink)' }}>First delivery's on us.</strong> No delivery fee on your first order over GHS {FIRST_ORDER_FREE_MIN}.
              </div>
            )}
            {isFirstOrderEligible && !isFirstOrderFree && (
              <div style={{ border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)', padding: '10px 13px', fontSize: 12, lineHeight: 1.5, color: 'var(--rd-body)' }}>
                Add <strong style={{ color: 'var(--ink)' }}>GHS {(FIRST_ORDER_FREE_MIN - subtotal).toFixed(2)}</strong> more and your first delivery is free.
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-.03em' }}>Total</span>
              <RPrice amount={subtotal + delivery} size="md" />
            </div>
            <button onClick={() => { onClose(); setPage('checkout'); }}
              style={{ width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: 15, fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>Proceed to Checkout →</button>
            <button onClick={onClose} style={{ ...label, background: 'none', border: 'none', textAlign: 'center', fontSize: 12.5, color: 'var(--rd-muted)' }}>Continue shopping</button>
          </div>
        )}
      </div>
    </>
  );
};

Object.assign(window, { CartDrawer });
