// Header Component — design refresh (2026): flat, typographic chrome
// (announcement bar + header + category pill rail). Fully responsive.
const Header = ({ cart, page, setPage, selectedCategory, setSelectedCategory, searchQuery, setSearchQuery, currentUser, onLogout }) => {
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

  React.useEffect(() => { setMenuOpen(false); }, [page]);

  const signedIn = !!(currentUser && currentUser.id && currentUser.role !== 'guest');
  const firstName = signedIn ? (currentUser.name || 'You').split(' ')[0] : 'Guest';
  const authLabel = signedIn ? 'Sign out' : 'Sign in';
  const loyalty = signedIn ? Number(currentUser.loyaltyBalance || 0) : 0;
  const cats = window.CATEGORIES || [];

  const navItems = [['Home', 'home'], ['Categories', 'category'], ['Squad', 'squad'],
    signedIn ? ['My Orders', 'orders'] : ['Track Order', 'orders']];
  const go = (pg) => { if (pg === 'category') setSelectedCategory(null); setPage(pg); setMenuOpen(false); };
  const onSearch = (v) => { setSearchQuery(v); if (v.trim() && page !== 'category') setPage('category'); };

  // Minimalist search field (CSS-drawn magnifier ring), shared by desktop + mobile
  const SearchField = ({ style }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border-input)', padding: '10px 14px', background: '#fff', ...style }}>
      <span style={{ width: 13, height: 13, border: '1.5px solid var(--rd-faint)', borderRadius: '50%', flexShrink: 0 }} />
      <input value={searchQuery} onChange={e => onSearch(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim()) setPage('category'); }}
        placeholder="Search groceries…" aria-label="Search groceries"
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--f-ui)', fontSize: 13.5, color: 'var(--ink)' }} />
      {searchQuery && (
        <button onClick={() => setSearchQuery('')} aria-label="Clear search"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rd-faint)', fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
      )}
    </div>
  );

  // Bag glyph + accent count badge (badge only when count > 0)
  const CartGlyph = () => (
    <button onClick={() => setPage('cart')} aria-label={`Cart, ${totalItems} item${totalItems === 1 ? '' : 's'}`}
      style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
        transform: cartBounce ? 'scale(1.16)' : 'scale(1)', transition: 'transform .2s' }}>
      <span style={{ display: 'block', width: 15, height: 17, border: '1.5px solid var(--ink)', borderRadius: '0 0 3px 3px' }} />
      {totalItems > 0 && (
        <span style={{ position: 'absolute', top: -8, right: -9, minWidth: 16, height: 16, background: 'var(--accent)', color: '#fff',
          fontFamily: 'var(--f-mono)', fontSize: 9.5, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, padding: '0 4px' }}>
          {totalItems}
        </span>
      )}
    </button>
  );

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--panel)', color: 'var(--ink)', fontFamily: 'var(--f-ui)' }}>
      <style>{`
        .rdh-link{color:var(--ink);background:none;border:none;cursor:pointer;font-family:var(--f-ui);transition:color .14s}
        .rdh-link:hover{color:var(--accent)}
        .rdh-auth{background:none;border:none;cursor:pointer;font-family:var(--f-mono);transition:color .14s}
        .rdh-auth:hover{color:var(--accent)}
        .rdh-pill{background:none;cursor:pointer;font-family:var(--f-label);transition:border-color .14s,color .14s,background .14s}
        .rdh-pill:hover{border-color:var(--ink) !important;color:var(--ink) !important}
        header button:focus-visible,header input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      `}</style>

      {/* Announcement bar */}
      <div style={{ background: 'var(--ink)', color: '#fff', textAlign: 'center', padding: isMobile ? '8px 16px' : '10px 24px',
        fontFamily: 'var(--f-mono)', fontSize: isMobile ? 10 : 11, letterSpacing: '.1em', textTransform: 'uppercase' }}>
        Free delivery on orders above GHS 150 · Tamale same-day service
      </div>

      {/* ── Header row ── */}
      {!isMobile ? (
        <div className="rd-gutter" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid var(--rule)' }}>
          {/* Logo */}
          <button onClick={() => go('home')} aria-label="SDGMart home"
            style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ width: 38, height: 38, background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-mark)', fontSize: 14, fontWeight: 700, letterSpacing: '-.03em' }}>SDG</span>
            <span style={{ fontFamily: 'var(--f-mark)', fontSize: 19, fontWeight: 700, letterSpacing: '-.035em', color: 'var(--ink)' }}>SDGMart</span>
          </button>

          <SearchField style={{ flex: 1 }} />

          {/* Nav links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13.5, fontWeight: 500, flexShrink: 0 }} className="desktop-nav">
            {navItems.map(([label, pg]) => {
              const active = page === pg;
              return active ? (
                <button key={pg} onClick={() => go(pg)} style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '8px 15px', fontSize: 13.5, fontWeight: 500, fontFamily: 'var(--f-ui)' }}>{label}</button>
              ) : (
                <button key={pg} className="rdh-link" onClick={() => go(pg)} style={{ padding: 0, fontSize: 13.5, fontWeight: 500 }}>{label}</button>
              );
            })}
          </nav>

          {/* Mono account cluster */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 22, borderLeft: '1px solid var(--rule)', flexShrink: 0,
            fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            {loyalty > 0 && <span title="Loyalty credit — apply at checkout" style={{ color: 'var(--accent)' }}>GHS {loyalty.toFixed(0)} credit</span>}
            <button className="rdh-auth" onClick={() => signedIn && setPage('account')} title={signedIn ? 'Account settings' : 'Guest'}
              style={{ color: 'var(--rd-muted)', cursor: signedIn ? 'pointer' : 'default', padding: 0 }}>{firstName}</button>
            <button className="rdh-auth" onClick={onLogout} style={{ color: 'var(--ink)', borderBottom: '1px solid var(--ink)', paddingBottom: 2 }}>{authLabel}</button>
            <CartGlyph />
          </div>
        </div>
      ) : (
        <>
          <div className="rd-gutter" style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
            <button onClick={() => go('home')} aria-label="SDGMart home" style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <span style={{ width: 34, height: 34, background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-mark)', fontSize: 13, fontWeight: 700, letterSpacing: '-.03em' }}>SDG</span>
              <span style={{ fontFamily: 'var(--f-mark)', fontSize: 18, fontWeight: 700, letterSpacing: '-.035em', color: 'var(--ink)' }}>SDGMart</span>
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
              <CartGlyph />
              <button onClick={() => setMenuOpen(m => !m)} aria-label="Menu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.6">
                  {menuOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                    : <><line x1="3" y1="8" x2="21" y2="8" /><line x1="3" y1="16" x2="21" y2="16" /></>}
                </svg>
              </button>
            </div>
          </div>
          <div className="rd-gutter" style={{ paddingTop: 10, paddingBottom: 10, borderBottom: '1px solid var(--rule)' }}>
            <SearchField />
          </div>
        </>
      )}

      {/* Mobile dropdown menu */}
      {isMobile && menuOpen && (
        <div className="rd-gutter" style={{ display: 'flex', flexDirection: 'column', paddingTop: 6, paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
          {navItems.map(([label, pg]) => {
            const active = page === pg;
            return (
              <button key={pg} onClick={() => go(pg)}
                style={{ textAlign: 'left', padding: '12px 14px', fontFamily: 'var(--f-label)', fontSize: 15, fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase',
                  background: active ? 'var(--ink)' : 'transparent', color: active ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer' }}>
                {label}
              </button>
            );
          })}
          {signedIn && (
            <button onClick={() => go('account')} style={{ textAlign: 'left', padding: '12px 14px', fontFamily: 'var(--f-label)', fontSize: 15, fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase', background: 'transparent', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}>My Profile</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--rule)', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            <span style={{ color: 'var(--rd-muted)' }}>{signedIn ? firstName : 'Guest'}{loyalty > 0 ? ` · GHS ${loyalty.toFixed(0)} credit` : ''}</span>
            <button onClick={onLogout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', borderBottom: '1px solid var(--ink)', paddingBottom: 2, fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>{authLabel}</button>
          </div>
        </div>
      )}

      {/* Category pill rail */}
      <div className="rd-gutter rd-rail" style={{ display: 'flex', gap: 7, paddingTop: 14, paddingBottom: 14, borderBottom: '1px solid var(--rule)', overflowX: 'auto' }}>
        {[['All', null], ...cats.map(c => [c, c])].map(([label, cat]) => {
          const active = page === 'category' && (cat ? selectedCategory === cat : !selectedCategory);
          return (
            <button key={label} className="rdh-pill"
              onClick={() => { setSelectedCategory(cat); setPage('category'); }}
              style={{ flex: 'none', padding: '9px 15px', borderRadius: 999, whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: cat ? 600 : 700, letterSpacing: '.02em', textTransform: 'uppercase',
                background: active ? 'var(--ink)' : 'transparent', color: active ? '#fff' : 'var(--ink-2)',
                border: `1px solid ${active ? 'var(--ink)' : 'var(--chip-border)'}` }}>
              {label}
            </button>
          );
        })}
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

// iOS install hint — Safari has no programmatic install API, so we tell
// the user how to add SDGMart to their home screen via the Share sheet.
// Shows only when: iOS Safari, not already running standalone, not previously
// dismissed within the last 14 days.
const IOSInstallHint = () => {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    try {
      const ua = window.navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
      const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(ua);
      // navigator.standalone is the iOS-specific flag for "running from home screen"
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      if (!isIOS || !isSafari || isStandalone) return;
      const dismissedAt = Number(localStorage.getItem('sdg-ios-hint-dismissed') || 0);
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      if (dismissedAt && Date.now() - dismissedAt < fourteenDaysMs) return;
      // Wait 4s before showing so we don't crowd the first page paint
      const t = setTimeout(() => setShow(true), 4000);
      return () => clearTimeout(t);
    } catch (_) {}
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem('sdg-ios-hint-dismissed', String(Date.now())); } catch (_) {}
    setShow(false);
  };
  return (
    <div role="dialog" aria-label="Install SDGMart"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 18, zIndex: 10000,
        background: '#000', color: '#fff', borderRadius: 16,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,.45)',
        animation: 'sdg-ios-rise .4s cubic-bezier(.16,1,.3,1)',
      }}>
      <style>{`@keyframes sdg-ios-rise{from{transform:translateY(140%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>
        SDG
      </div>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Install SDGMart</div>
        <div style={{ opacity: .85, fontSize: 12 }}>
          Tap <span aria-label="Share" role="img" style={{ display: 'inline-block', transform: 'translateY(2px)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </span> Share, then <strong>Add to Home Screen</strong>
        </div>
      </div>
      <button onClick={dismiss} aria-label="Dismiss"
        style={{ background: 'rgba(255,255,255,.15)', color: '#fff', borderRadius: 6, width: 28, height: 28, fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0, cursor: 'pointer' }}>✕</button>
    </div>
  );
};

// First-sign-in nudge: prompts customers to complete their profile (phone +
// saved address) so checkout auto-fills. Shows once per user per device —
// and only when something is actually missing; complete profiles never see it.
const ProfileNudge = ({ currentUser, setPage }) => {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!currentUser || !currentUser.id || currentUser.role !== 'customer') return;
    const key = 'sdg-profile-nudge-' + currentUser.id;
    try {
      const flag = localStorage.getItem(key);
      if (flag === 'complete') return;
      // Shown (or dismissed) recently → don't nag again for 7 days
      if (flag && Date.now() - Number(flag) < 7 * 24 * 60 * 60 * 1000) return;
    } catch (_) {}
    let cancelled = false;
    (async () => {
      try {
        let complete = !!(currentUser.phone && String(currentUser.phone).trim());
        if (complete) {
          // Explicit token: right after sign-in the sessionStorage copy that
          // apiFetch reads may not be written yet (child effects run before
          // parent effects), which made this check 401 and the nudge appear
          // for COMPLETE profiles on every sign-in.
          const r = await fetch('/api/me/addresses', { headers: { Authorization: 'Bearer ' + (currentUser.token || '') } });
          if (!r.ok) return; // can't verify → stay quiet rather than mis-nag
          const list = await r.json();
          complete = Array.isArray(list) && list.length > 0;
        }
        if (complete) { try { localStorage.setItem(key, 'complete'); } catch (_) {} return; }
        // Delay so we don't collide with the first page paint / install banner.
        // Showing counts as "seen" — ignoring it won't re-nag for 7 days.
        setTimeout(() => {
          if (cancelled) return;
          try { localStorage.setItem(key, String(Date.now())); } catch (_) {}
          setShow(true);
        }, 2500);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [currentUser && currentUser.id]);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem('sdg-profile-nudge-' + currentUser.id, String(Date.now())); } catch (_) {}
    setShow(false);
  };
  const goProfile = () => { dismiss(); setPage('account'); };
  return (
    <div role="dialog" aria-label="Complete your profile"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 18, zIndex: 9999,
        maxWidth: 520, margin: '0 auto',
        background: 'var(--sage-dark, #1A1A1A)', color: '#fff', borderRadius: 16,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,.45)',
        animation: 'sdg-nudge-rise .4s cubic-bezier(.16,1,.3,1)',
      }}>
      <style>{`@keyframes sdg-nudge-rise{from{transform:translateY(140%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <span style={{ flexShrink: 0, fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-light)', border: '1px solid var(--dark-rule)', padding: '4px 7px' }}>Tip</span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Make checkout one tap</div>
        <div style={{ opacity: .85, fontSize: 12 }}>
          Save your phone & delivery address once in your profile — we'll fill them in for every order.
        </div>
      </div>
      <button onClick={goProfile}
        style={{ background: '#fff', color: '#1A1A1A', borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 12, flexShrink: 0, cursor: 'pointer' }}>
        Complete profile
      </button>
      <button onClick={dismiss} aria-label="Dismiss"
        style={{ background: 'rgba(255,255,255,.15)', color: '#fff', borderRadius: 6, width: 28, height: 28, fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0, cursor: 'pointer' }}>✕</button>
    </div>
  );
};

Object.assign(window, { Header, WhatsAppFloat, IOSInstallHint, ProfileNudge });
