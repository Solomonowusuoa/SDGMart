// LoginPage — first screen. Sign in / Sign up / Continue as guest.
// Supports email+password and (optionally) Google Sign-In.
const LoginPage = ({ onAuth, onGuest }) => {
  const isMobile = useMobile();
  const [mode, setMode] = React.useState('signin'); // 'signin' | 'signup'
  const [form, setForm] = React.useState({
    name: '', email: '', phone: '', password: '', refCode: '',
  });
  const [err, setErr] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [googleClientId, setGoogleClientId] = React.useState('');
  const googleBtnRef = React.useRef(null);
  const refCodeRef = React.useRef('');

  // Pre-fill referral code from URL ?ref=CODE
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setMode('signup');
      setForm(f => ({ ...f, refCode: ref.toUpperCase() }));
      refCodeRef.current = ref.toUpperCase();
    }
  }, []);

  // Fetch server config to learn whether Google sign-in is enabled
  React.useEffect(() => {
    fetch('/api/auth/config')
      .then(r => r.json())
      .then(cfg => { if (cfg.googleClientId) setGoogleClientId(cfg.googleClientId); })
      .catch(() => {});
  }, []);

  // Render the Google button once GIS + the client ID are both ready
  React.useEffect(() => {
    if (!googleClientId || !googleBtnRef.current) return;
    let tries = 0;
    const tryRender = () => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            setErr('');
            setLoading(true);
            try {
              const r = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential, refCode: refCodeRef.current || form.refCode }),
              });
              const data = await r.json();
              if (!r.ok) { setErr(data.error || 'Google sign-in failed'); setLoading(false); return; }
              onAuth({ ...data.user, token: data.token });
            } catch (_) {
              setErr('Network error during Google sign-in');
              setLoading(false);
            }
          },
        });
        // Clear any prior render
        googleBtnRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline', size: 'large', shape: 'pill', text: mode === 'signin' ? 'signin_with' : 'signup_with', width: 320,
        });
      } else if (tries++ < 50) {
        setTimeout(tryRender, 100);
      }
    };
    tryRender();
  }, [googleClientId, mode]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr('');
    if (mode === 'signin') {
      if (!form.email || !form.password) { setErr('Email and password required'); return; }
    } else {
      if (!form.name || !form.email || !form.password) { setErr('Name, email and password required'); return; }
    }
    setLoading(true);
    try {
      const url = mode === 'signin' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'signin'
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, phone: form.phone, password: form.password, refCode: form.refCode };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Login failed'); setLoading(false); return; }
      // For signup, surface the verification link so the user can confirm
      // their email even when no real SMTP is configured.
      if (mode === 'signup' && data.verificationLink) {
        const proceed = window.confirm(
          `Account created!\n\nA verification link has been generated:\n${data.verificationLink}\n\nClick OK to open it now (you can also find it in the server console).`
        );
        if (proceed) window.open(data.verificationLink, '_blank', 'noopener');
      }
      // Stash the session token alongside the user so apiFetch can find it.
      onAuth({ ...data.user, token: data.token });
    } catch (e) {
      setErr('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const inputS = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none',
    background: 'var(--white)', marginBottom: 10,
  };

  // Moody pantry/snacks photograph — same theme as the homepage hero.
  // Reduced 3840→1920 width and quality 90→80 for faster first paint.
  const HERO_BG = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1920&q=80&auto=format&fit=crop';

  React.useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = HERO_BG;
    link.fetchPriority = 'high';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (_) {} };
  }, []);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#1a1a1a', // instant fill while photo loads
      backgroundImage: `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.7)), url(${HERO_BG})`,
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed',
      padding: isMobile ? '20px 16px' : '40px 24px',
    }}>
      <div style={{
        background: 'rgba(255,255,255,.97)', borderRadius: 'var(--radius-lg)',
        padding: isMobile ? '28px 22px' : '40px 36px',
        boxShadow: '0 30px 80px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        width: '100%', maxWidth: 420,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
              <path d="M3 6l7-4 7 4v8l-7 4-7-4V6z" fill="none" stroke="#fff" strokeWidth="1.5"/>
              <path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5"/>
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700, color: 'var(--sage-dark)' }}>SDGMart</span>
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--warm-gray)', marginBottom: 22 }}>
          Tamale's essentials, delivered.
        </p>

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: 'var(--cream)', borderRadius: 10, padding: 4, marginBottom: 22 }}>
          {['signin', 'signup'].map(m => (
            <button key={m} onClick={() => { setMode(m); setErr(''); }}
              style={{
                flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: mode === m ? 'var(--white)' : 'transparent',
                color: mode === m ? 'var(--sage-dark)' : 'var(--warm-gray)',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s',
              }}>
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* Form */}
        {mode === 'signup' && (
          <input placeholder="Full Name" value={form.name} onChange={e => set('name', e.target.value)} style={inputS} />
        )}
        <input placeholder="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} style={inputS} />
        {mode === 'signup' && (
          <input placeholder="Phone (optional)" value={form.phone} onChange={e => set('phone', e.target.value)} style={inputS} />
        )}
        <input placeholder="Password" type="password" value={form.password}
          onChange={e => set('password', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()} style={inputS} />
        {mode === 'signup' && (
          <input placeholder="Referral Code (optional)" value={form.refCode}
            onChange={e => set('refCode', e.target.value.toUpperCase())} style={inputS} />
        )}

        {err && <div style={{ background: 'rgba(192,57,43,.08)', color: 'var(--accent-red)', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <button onClick={submit} disabled={loading}
          style={{
            width: '100%', background: 'var(--sage)', color: '#fff', borderRadius: 10,
            padding: '13px', fontWeight: 700, fontSize: 15, marginTop: 4,
            opacity: loading ? .6 : 1, cursor: loading ? 'wait' : 'pointer',
          }}>
          {loading ? 'Please wait…' : (mode === 'signin' ? 'Sign In' : 'Create Account')}
        </button>

        {/* Google sign-in (only when configured on the server) */}
        {googleClientId && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 14px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
              <span style={{ fontSize: 11, color: 'var(--warm-gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
            </div>
            <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center' }} />
          </>
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
          <span style={{ fontSize: 11, color: 'var(--warm-gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
        </div>

        {/* Guest */}
        <button onClick={onGuest}
          style={{
            width: '100%', background: 'var(--cream)', color: 'var(--warm-black)',
            borderRadius: 10, padding: '12px', fontWeight: 600, fontSize: 14,
          }}>
          Continue as Guest
        </button>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--warm-gray)', marginTop: 18, lineHeight: 1.6 }}>
          Sign up to track your spend, join a squad and unlock 5% group discounts.
        </p>
      </div>
    </div>
  );
};

Object.assign(window, { LoginPage });
