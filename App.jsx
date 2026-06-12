// App.jsx — main app shell with routing, auth gate, and tweaks

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "warm",
  "density": "normal",
  "showGroupGoal": true
}/*EDITMODE-END*/;

const STORAGE_KEY = 'sdgmart_user';

const App = () => {
  // Auth state — null = not yet decided (login screen), {role:'guest'} = guest, {id,name,...} = signed-in
  const [currentUser, setCurrentUser] = React.useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  });
  // True once we've either confirmed the token with /api/auth/me OR established
  // the user is a guest / not signed in. Prevents the "flash of homepage" on
  // reload when a stored token has actually expired.
  const [authChecked, setAuthChecked] = React.useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return true; // no stored user → nothing to verify
      const u = JSON.parse(raw);
      // Guests and admins-without-tokens don't need a server round-trip
      return !u || !u.token || u.role === 'guest';
    } catch (_) { return true; }
  });

  const [page, setPage] = React.useState('home');
  const [selectedCategory, setSelectedCategory] = React.useState(null);
  const [selectedProduct, setSelectedProduct] = React.useState(null);
  const [trackingOrderId, setTrackingOrderId] = React.useState(null);
  const [cart, setCart] = React.useState([]);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = tweaks.theme;

  // Persist user across reloads (sessionStorage = clears when tab closes)
  React.useEffect(() => {
    if (currentUser) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, [currentUser]);

  // If user role becomes admin, force page to admin
  React.useEffect(() => {
    if (currentUser && currentUser.role === 'admin') setPage('admin');
    else if (currentUser && page === 'admin') setPage('home');
  }, [currentUser]);

  // Apply theme to CSS vars
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'v2') {
      // Re-tuned: clean black-on-white so toggling no longer reintroduces green
      root.style.setProperty('--cream', '#FFFFFF');
      root.style.setProperty('--cream-dark', '#EDEAE2');
      root.style.setProperty('--sage', '#000000');
      root.style.setProperty('--sage-dark', '#000000');
      root.style.setProperty('--sage-light', '#3A3A3A');
      root.style.setProperty('--white', '#FFFFFF');
      root.style.setProperty('--accent-gold', '#C8923A');
    } else {
      // Neutral black + warm white system
      root.style.setProperty('--cream', '#FFFFFF');
      root.style.setProperty('--cream-dark', '#F0EDE5');
      root.style.setProperty('--sage', '#1A1A1A');
      root.style.setProperty('--sage-dark', '#000000');
      root.style.setProperty('--sage-light', '#4A4A4A');
      root.style.setProperty('--white', '#FFFFFF');
      root.style.setProperty('--accent-gold', '#C8923A');
    }
  }, [theme]);

  // ── Active promotions → productId:percent map (drives sale badges + pricing)
  const [promoMap, setPromoMap] = React.useState({});
  React.useEffect(() => {
    fetch('/api/promotions/active').then(r => r.ok ? r.json() : []).then(promos => {
      const map = {};
      (promos || []).forEach(p => {
        (p.productIds || []).forEach(id => {
          // If a product is in multiple promos, keep the biggest discount
          if (!map[id] || p.discountPercent > map[id]) map[id] = p.discountPercent;
        });
      });
      setPromoMap(map);
      window.PROMO_MAP = map;          // ProductCard / ProductPage read this
      window.dispatchEvent(new Event('sdgmart:promos'));
    }).catch(() => {});
  }, []);

  // Effective unit price after any active promo
  const promoPrice = (product) => {
    const pct = promoMap[product.id];
    if (!pct) return { price: product.price };
    return { price: +(product.price * (1 - pct / 100)).toFixed(2), originalPrice: product.price, promoPercent: pct };
  };

  const addToCart = (product) => {
    const pp = promoPrice(product);
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...product, ...pp, qty: 1 }];
    });
  };

  const viewProduct = (product) => {
    setSelectedProduct(product);
    setPage('product');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateTo = (pg) => {
    setPage(pg);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const logout = async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    setCurrentUser(null);
    setCart([]);
    setPage('home');
  };

  // Honor ?track=ORDER_ID in the URL (used by push notifications) by
  // jumping straight to the tracking page on load.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const trackId = params.get('track');
    if (trackId) {
      setTrackingOrderId(trackId);
      setPage('tracking');
    }
    // Listen for messages from the service worker (notification clicked while
    // a tab is already open).
    const onSwMsg = (e) => {
      if (e.detail && e.detail.orderId) {
        setTrackingOrderId(e.detail.orderId);
        setPage('tracking');
      }
    };
    window.addEventListener('sdgmart:open-tracking', onSwMsg);
    return () => window.removeEventListener('sdgmart:open-tracking', onSwMsg);
  }, []);

  // On boot, if we have a stored token, fetch the latest user record so
  // discount/spend updates from another tab are picked up. If the token has
  // expired, log the user out automatically.
  React.useEffect(() => {
    if (!currentUser || !currentUser.token || currentUser.role === 'guest') return;
    apiFetch('/api/auth/me')
      .then(r => { if (r.status === 401) { setCurrentUser(null); return null; } return r.json(); })
      .then(fresh => { if (fresh && fresh.id) setCurrentUser(prev => ({ ...prev, ...fresh })); })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []); // run once on mount

  // ── Splash while verifying stored token ──────────────────────────────────
  // Prevents the shopping app from briefly appearing on reload before /me
  // returns 401 and bounces an expired session back to login.
  if (!authChecked) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#0F0F0F', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 999999,
      }}>
        <style>{`@keyframes sdg-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: '3px solid rgba(255,255,255,.15)',
            borderTopColor: '#fff', borderRadius: '50%', margin: '0 auto 14px',
            animation: 'sdg-spin .9s linear infinite',
          }} />
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, letterSpacing: '.02em' }}>SDGMart</div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: .6 }}>Verifying your session…</div>
        </div>
      </div>
    );
  }

  // ── Login gate ────────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <>
        <LoginPage
          onAuth={(user) => { setCurrentUser(user); setAuthChecked(true); }}
          onGuest={() => { setCurrentUser({ role: 'guest', name: 'Guest' }); setAuthChecked(true); }}
        />
        <IOSInstallHint />
      </>
    );
  }

  // ── Admin: skip header, show admin page only ─────────────────────────────
  if (currentUser.role === 'admin') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
        <AdminPage setPage={navigateTo} onLogout={logout} currentUser={currentUser} setCurrentUser={setCurrentUser} />
        <WhatsAppFloat />
      <IOSInstallHint />
      </div>
    );
  }

  // ── Rider: dedicated rider PWA (no shopping UI) ───────────────────────────
  if (currentUser.role === 'rider') {
    return <RiderPage currentUser={currentUser} onLogout={logout} />;
  }

  // ── Normal shopping app ──────────────────────────────────────────────────
  const showVerifyBanner = currentUser && currentUser.id && currentUser.emailVerified === false;
  const resendVerification = async () => {
    try {
      const res = await apiFetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json();
      if (data.alreadyVerified) {
        setCurrentUser(prev => ({ ...prev, emailVerified: true }));
        return;
      }
      if (data.verificationLink) {
        const proceed = window.confirm(`Open the new verification link?\n\n${data.verificationLink}`);
        if (proceed) window.open(data.verificationLink, '_blank', 'noopener');
      }
    } catch (_) {}
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      {showVerifyBanner && (
        <div style={{ background: '#E8960A', color: '#fff', textAlign: 'center', padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>
          ✉️ Please verify your email to unlock checkout.
          <button onClick={resendVerification} style={{ marginLeft: 12, color: '#fff', textDecoration: 'underline', fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}>
            Resend link
          </button>
        </div>
      )}
      <Header
        cart={cart}
        page={page}
        setPage={navigateTo}
        setSelectedCategory={setSelectedCategory}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        theme={theme}
        currentUser={currentUser}
        onLogout={logout}
      />

      {page === 'home' && (
        <HomePage
          onAdd={addToCart}
          onView={viewProduct}
          setPage={navigateTo}
          setSelectedCategory={setSelectedCategory}
        />
      )}
      {page === 'category' && (
        <CategoryPage
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          onAdd={addToCart}
          onView={viewProduct}
          searchQuery={searchQuery}
        />
      )}
      {page === 'product' && (
        <ProductPage
          product={selectedProduct}
          onAdd={addToCart}
          setPage={navigateTo}
          setSelectedCategory={setSelectedCategory}
        />
      )}
      {page === 'cart' && (
        <CartDrawer
          cart={cart}
          setCart={setCart}
          setPage={navigateTo}
          onClose={() => navigateTo('home')}
        />
      )}
      {page === 'checkout' && (
        <CheckoutPage
          cart={cart}
          setCart={setCart}
          setPage={navigateTo}
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          openTracking={(id) => { setTrackingOrderId(id); navigateTo('tracking'); }}
        />
      )}
      {page === 'squad' && (
        <SquadPage setPage={navigateTo} currentUser={currentUser} />
      )}
      {page === 'orders' && (
        <MyOrdersPage
          setPage={navigateTo}
          openTracking={(id) => { setTrackingOrderId(id); navigateTo('tracking'); }}
          setCart={setCart}
        />
      )}
      {page === 'account' && currentUser && currentUser.id && (
        <AccountPage setPage={navigateTo} currentUser={currentUser} setCurrentUser={setCurrentUser} />
      )}
      <ReviewPromptModal currentUser={currentUser} />
      {page === 'tracking' && trackingOrderId && (
        <OrderTrackingPage
          orderId={trackingOrderId}
          currentUser={currentUser}
          setPage={navigateTo}
        />
      )}

      {cartOpen && page !== 'cart' && (
        <CartDrawer
          cart={cart}
          setCart={setCart}
          setPage={navigateTo}
          onClose={() => setCartOpen(false)}
        />
      )}

      {/* Hide WhatsApp float on checkout — it covers the totals + Confirm button on mobile */}
      {page !== 'checkout' && <WhatsAppFloat />}
      <IOSInstallHint />

      <TweaksPanel>
        <TweakSection title="Theme">
          <TweakRadio
            label="Color Palette"
            tweakKey="theme"
            options={[
              { label: 'Warm Earthy', value: 'warm' },
              { label: 'Fresh Green', value: 'v2' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Layout">
          <TweakRadio
            label="Density"
            tweakKey="density"
            options={[
              { label: 'Normal', value: 'normal' },
              { label: 'Compact', value: 'compact' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Features">
          <TweakToggle
            label="Show Squad Goal Bar"
            tweakKey="showGroupGoal"
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
