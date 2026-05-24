// Header Component
const Header = ({ cart, page, setPage, setSelectedCategory, searchQuery, setSearchQuery, theme, currentUser, onLogout }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [cartBounce, setCartBounce] = React.useState(false);
  const isMobile = useMobile();
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);

  React.useEffect(() => {
    if (totalItems > 0) {
      setCartBounce(true);
      const t = setTimeout(() => setCartBounce(false), 400);
      return () => clearTimeout(t);
    }
  }, [totalItems]);

  // Close menu on page change
  React.useEffect(() => { setMenuOpen(false); }, [page]);

  const isV2 = theme === 'v2';
  const hStyle = {
    background: isV2 ? '#2E3B1E' : 'var(--white)',
    borderBottom: isV2 ? 'none' : '1px solid var(--cream-dark)',
    color: isV2 ? '#F5F0E8' : 'var(--warm-black)',
    position: 'sticky', top: 0, zIndex: 100,
    boxShadow: isV2 ? '0 2px 20px rgba(0,0,0,.25)' : 'var(--shadow)',
  };

  return (
    <header style={hStyle}>
      {/* Top bar */}
      {!isMobile && (
        <div style={{ background: isV2 ? '#1C2710' : 'var(--sage)', color: '#fff', textAlign: 'center', padding: '7px 16px', fontSize: 12, fontWeight: 500, letterSpacing: '.04em' }}>
          🚚 Free delivery on orders above GHS 150 · Tamale Same-Day Service
        </div>
      )}

      {/* Main nav */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '10px 16px' : '12px 24px', display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16 }}>
        {/* Logo */}
        <button onClick={() => setPage('home')} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 6l7-4 7 4v8l-7 4-7-4V6z" fill="none" stroke="#fff" strokeWidth="1.5"/>
              <path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5"/>
            </svg>
          </div>
          {!isMobile && (
            <span style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, color: isV2 ? '#F5F0E8' : 'var(--sage-dark)', letterSpacing: '-.01em' }}>SDGMart</span>
          )}
        </button>

        {/* Search bar */}
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim()) setPage('category'); }}
            placeholder="Search groceries..."
            style={{
              width: '100%', padding: '10px 16px 10px 42px',
              borderRadius: 30, border: `1.5px solid ${isV2 ? 'rgba(255,255,255,.2)' : 'var(--cream-dark)'}`,
              background: isV2 ? 'rgba(255,255,255,.1)' : 'var(--cream)',
              color: isV2 ? '#F5F0E8' : 'var(--warm-black)',
              fontSize: 14, outline: 'none', transition: 'border .2s',
            }}
          />
          <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: .5 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isV2 ? '#fff' : 'var(--warm-black)'} strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </div>

        {/* Nav links — desktop only */}
        <nav style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8 }} className="desktop-nav">
          {[['Home','home'],['Categories','category'],['Squad 🤝','squad']].map(([label, pg]) => (
            <button key={pg} onClick={() => { setPage(pg); if (pg==='category') setSelectedCategory(null); }}
              style={{ padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                background: page === pg ? 'var(--sage)' : 'transparent',
                color: page === pg ? '#fff' : (isV2 ? 'rgba(245,240,232,.8)' : 'var(--warm-gray)'),
                transition: 'all .2s' }}>
              {label}
            </button>
          ))}
        </nav>

        {/* Right icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
          {/* User pill — desktop only */}
          {!isMobile && currentUser && currentUser.id && (
            <button onClick={() => setPage('orders')} title="My orders"
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 18, background: isV2 ? 'rgba(255,255,255,.12)' : 'var(--cream)', color: isV2 ? '#F5F0E8' : 'var(--sage-dark)' }}>
              📦 My Orders
            </button>
          )}
          {!isMobile && currentUser && currentUser.id && Number(currentUser.loyaltyBalance || 0) > 0 && (
            <span title="Loyalty credit — apply at checkout"
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 18, background: '#FFF8E1', color: '#7A5A00', border: '1px solid #F0DCA0' }}>
              ⭐ GHS {Number(currentUser.loyaltyBalance).toFixed(0)}
            </span>
          )}
          {!isMobile && currentUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: isV2 ? 'rgba(255,255,255,.12)' : 'var(--cream)', borderRadius: 20, padding: '5px 6px 5px 12px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: isV2 ? '#F5F0E8' : 'var(--sage-dark)' }}>
                {currentUser.role === 'guest' ? 'Guest' : (currentUser.name || 'You').split(' ')[0]}
              </span>
              <button onClick={onLogout} title="Sign out"
                style={{ fontSize: 11, fontWeight: 700, color: isV2 ? 'rgba(245,240,232,.85)' : 'var(--warm-gray)', padding: '3px 10px', borderRadius: 14, background: isV2 ? 'rgba(255,255,255,.12)' : 'var(--white)' }}>
                {currentUser.role === 'guest' ? 'Sign in' : 'Sign out'}
              </button>
            </div>
          )}
          <button onClick={() => setPage('cart')}
            style={{ position: 'relative', width: 40, height: 40, borderRadius: 20,
              background: isV2 ? 'rgba(255,255,255,.15)' : 'var(--cream)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: cartBounce ? 'scale(1.18)' : 'scale(1)', transition: 'transform .2s' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isV2 ? '#fff' : 'var(--sage-dark)'} strokeWidth="2">
              <path d="M6 2 3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            {totalItems > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--accent-red)', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {totalItems}
              </span>
            )}
          </button>

          {/* Hamburger — mobile only */}
          {isMobile && (
            <button onClick={() => setMenuOpen(m => !m)}
              style={{ width: 40, height: 40, borderRadius: 20, background: isV2 ? 'rgba(255,255,255,.15)' : 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isV2 ? '#fff' : 'var(--sage-dark)'} strokeWidth="2">
                {menuOpen
                  ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                  : <><line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/></>
                }
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {isMobile && menuOpen && (
        <div style={{ background: isV2 ? '#2E3B1E' : 'var(--white)', borderTop: `1px solid ${isV2 ? 'rgba(255,255,255,.1)' : 'var(--cream-dark)'}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[['🏠 Home','home'],['📦 Categories','category'],['🤝 Squad','squad'],...(currentUser && currentUser.id ? [['📦 My Orders','orders']] : [])].map(([label, pg]) => (
            <button key={pg} onClick={() => { setPage(pg); if (pg==='category') setSelectedCategory(null); setMenuOpen(false); }}
              style={{ textAlign: 'left', padding: '12px 16px', borderRadius: 10, fontSize: 15, fontWeight: 600,
                background: page === pg ? 'var(--sage)' : 'transparent',
                color: page === pg ? '#fff' : (isV2 ? 'rgba(245,240,232,.85)' : 'var(--warm-black)') }}>
              {label}
            </button>
          ))}
          {currentUser && (
            <button onClick={onLogout}
              style={{ textAlign: 'left', padding: '12px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, color: isV2 ? 'rgba(245,240,232,.85)' : 'var(--warm-gray)', background: 'transparent' }}>
              {currentUser.role === 'guest' ? '🔑 Sign In' : `🚪 Sign out (${(currentUser.name || 'You').split(' ')[0]})`}
            </button>
          )}
          <div style={{ borderTop: `1px solid ${isV2 ? 'rgba(255,255,255,.1)' : 'var(--cream-dark)'}`, marginTop: 8, paddingTop: 8, fontSize: 12, color: isV2 ? 'rgba(255,255,255,.5)' : 'var(--warm-gray)', textAlign: 'center' }}>
            🚚 Free delivery above GHS 150
          </div>
        </div>
      )}

      {/* Category pills */}
      <div style={{ borderTop: `1px solid ${isV2 ? 'rgba(255,255,255,.1)' : 'var(--cream-dark)'}`, overflowX: 'auto', scrollbarWidth: 'none' }}>
        <div style={{ display: 'flex', gap: 4, padding: isMobile ? '6px 16px' : '8px 24px', maxWidth: 1280, margin: '0 auto', minWidth: 'max-content' }}>
          {window.CATEGORIES.map(cat => (
            <button key={cat}
              onClick={() => { setSelectedCategory(cat); setPage('category'); }}
              style={{ padding: isMobile ? '4px 12px' : '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                background: 'transparent',
                color: isV2 ? 'rgba(245,240,232,.75)' : 'var(--warm-gray)',
                border: `1px solid ${isV2 ? 'rgba(255,255,255,.15)' : 'var(--cream-dark)'}`,
                transition: 'all .18s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--sage)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--sage)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = isV2 ? 'rgba(245,240,232,.75)' : 'var(--warm-gray)'; e.currentTarget.style.borderColor = isV2 ? 'rgba(255,255,255,.15)' : 'var(--cream-dark)'; }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

    </header>
  );
};

// Floating "chat with admin" WhatsApp button — rendered globally (outside the
// header) so the sticky/z-index of the header can't block clicks.
const WhatsAppFloat = () => (
  <a href="https://wa.me/233504082555" target="_blank" rel="noopener noreferrer"
    aria-label="Chat with SDGMart on WhatsApp"
    style={{
      position: 'fixed', bottom: 28, right: 28, width: 56, height: 56,
      borderRadius: '50%', background: '#25D366',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 20px rgba(37,211,102,.4)', zIndex: 9999,
      transition: 'transform .2s', textDecoration: 'none',
    }}
    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff" style={{ pointerEvents: 'none' }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.091.534 4.1 1.548 5.877L0 24l6.317-1.524A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.844 0-3.633-.468-5.204-1.351l-.373-.22-3.881.935.975-3.744-.243-.386A9.952 9.952 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
    </svg>
  </a>
);

Object.assign(window, { Header, WhatsAppFloat });
