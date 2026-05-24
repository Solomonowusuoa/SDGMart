// LoginPage — first screen. Sign in / Sign up / Continue as guest.
// Supports email+password and (optionally) Google Sign-In.
const LoginPage = ({ onAuth, onGuest }) => {
  const isMobile = useMobile();
  // Modes: 'signin' | 'signup' | 'forgot' | 'reset'
  const [mode, setMode] = React.useState('signin');
  const [form, setForm] = React.useState({
    name: '', email: '', phone: '', password: '', refCode: '',
    newPassword: '', confirmPassword: '',
  });
  const [err, setErr] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [googleClientId, setGoogleClientId] = React.useState('');
  const googleBtnRef = React.useRef(null);
  const refCodeRef = React.useRef('');
  const resetTokenRef = React.useRef('');

  // Pre-fill referral code from URL ?ref=CODE; switch to reset mode on ?reset=TOKEN
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setMode('signup');
      setForm(f => ({ ...f, refCode: ref.toUpperCase() }));
      refCodeRef.current = ref.toUpperCase();
    }
    const resetToken = params.get('reset');
    if (resetToken) {
      resetTokenRef.current = resetToken;
      setMode('reset');
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
    setErr(''); setInfo('');
    if (mode === 'forgot') return submitForgot();
    if (mode === 'reset') return submitReset();
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

  // ── Forgot password: email user a reset link ──
  const submitForgot = async () => {
    if (!form.email) { setErr('Enter your email'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await r.json();
      // For dev convenience: server returns the reset link directly so users
      // can complete the flow without real email being configured yet.
      if (data.resetLink) {
        const open = window.confirm(
          `If an account exists for ${form.email}, a reset link has been generated:\n\n${data.resetLink}\n\nClick OK to open it now (also logged to server console).`
        );
        if (open) window.location.href = data.resetLink;
      } else {
        setInfo(`If an account exists for ${form.email}, we've sent a reset link. Check the server console (no email is configured yet).`);
      }
    } catch (_) {
      setErr('Network error — please try again');
    } finally { setLoading(false); }
  };

  // ── Reset password: submit new password with the token from URL ──
  const submitReset = async () => {
    if (!form.newPassword || form.newPassword.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (form.newPassword !== form.confirmPassword) { setErr('Passwords do not match'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetTokenRef.current, newPassword: form.newPassword }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || 'Reset failed'); setLoading(false); return; }
      // Clear the ?reset=… param so a refresh doesn't reopen the reset form
      try { window.history.replaceState({}, '', window.location.pathname); } catch (_) {}
      setInfo('Password updated — sign in with your new password.');
      setMode('signin');
      setForm(f => ({ ...f, password: '', newPassword: '', confirmPassword: '' }));
    } catch (_) {
      setErr('Network error — please try again');
    } finally { setLoading(false); }
  };

  const inputS = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none',
    background: 'var(--white)', marginBottom: 10,
  };

  // Same image used by the homepage hero. Drop the file at icons/hero.jpg.
  const HERO_BG = '/icons/hero.jpg';

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
      backgroundColor: '#000', // instant fill while photo loads
      backgroundImage: `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.7)), url(${HERO_BG})`,
      backgroundSize: 'cover',
      backgroundPosition: isMobile ? 'center top' : 'center',
      // backgroundAttachment:fixed is broken on iOS Safari and hurts performance
      // on mobile in general — only use it on desktop.
      backgroundAttachment: isMobile ? 'scroll' : 'fixed',
      padding: isMobile ? '24px 14px' : '40px 24px',
    }}>
      <div style={{
        background: 'rgba(255,255,255,.97)', borderRadius: 'var(--radius-lg)',
        padding: isMobile ? '28px 22px' : '40px 36px',
        boxShadow: '0 30px 80px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        width: '100%', maxWidth: 420,
      }}>
        {/* Logo — "SDG" script wordmark, white on black */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{
            minWidth: 82, height: 56, padding: '0 14px',
            borderRadius: 10, background: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              fontFamily: "'Petit Formal Script', 'Allura', cursive",
              fontSize: 38, lineHeight: 1, color: '#fff',
              letterSpacing: '.01em',
              transform: 'translateY(3px)',
              whiteSpace: 'nowrap',
            }}>SDG</span>
          </div>
          <span style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700, color: '#000' }}>SDGMart</span>
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--warm-gray)', marginBottom: 22 }}>
          Tamale's essentials, delivered.
        </p>

        {/* Tab switcher — hidden in forgot/reset modes */}
        {(mode === 'signin' || mode === 'signup') && (
          <div style={{ display: 'flex', background: 'var(--cream)', borderRadius: 10, padding: 4, marginBottom: 22 }}>
            {['signin', 'signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setErr(''); setInfo(''); }}
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
        )}

        {/* Mode-specific heading for forgot/reset */}
        {mode === 'forgot' && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, color: 'var(--sage-dark)' }}>Reset your password</div>
            <div style={{ fontSize: 13, color: 'var(--warm-gray)', marginTop: 4 }}>Enter your email and we'll send you a link to choose a new password.</div>
          </div>
        )}
        {mode === 'reset' && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700, color: 'var(--sage-dark)' }}>Choose a new password</div>
            <div style={{ fontSize: 13, color: 'var(--warm-gray)', marginTop: 4 }}>At least 8 characters, with a letter and a number.</div>
          </div>
        )}

        {/* Form — different fields per mode */}
        {mode === 'signup' && (
          <input placeholder="Full Name" value={form.name} onChange={e => set('name', e.target.value)} style={inputS} />
        )}
        {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
          <input placeholder="Email" type="email" value={form.email}
            onChange={e => set('email', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} style={inputS} />
        )}
        {mode === 'signup' && (
          <input placeholder="Phone (optional)" value={form.phone} onChange={e => set('phone', e.target.value)} style={inputS} />
        )}
        {(mode === 'signin' || mode === 'signup') && (
          <input placeholder="Password" type="password" value={form.password}
            onChange={e => set('password', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} style={inputS} />
        )}
        {mode === 'signup' && (
          <input placeholder="Referral Code (optional)" value={form.refCode}
            onChange={e => set('refCode', e.target.value.toUpperCase())} style={inputS} />
        )}
        {mode === 'reset' && (
          <>
            <input placeholder="New password" type="password" value={form.newPassword}
              onChange={e => set('newPassword', e.target.value)} style={inputS} />
            <input placeholder="Confirm new password" type="password" value={form.confirmPassword}
              onChange={e => set('confirmPassword', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} style={inputS} />
          </>
        )}

        {/* Forgot password link — only in signin mode */}
        {mode === 'signin' && (
          <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 8 }}>
            <button type="button" onClick={() => { setMode('forgot'); setErr(''); setInfo(''); }}
              style={{ background: 'transparent', color: 'var(--sage-dark)', fontSize: 12, fontWeight: 600, padding: 0 }}>
              Forgot password?
            </button>
          </div>
        )}

        {err && <div style={{ background: 'rgba(192,57,43,.08)', color: 'var(--accent-red)', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        {info && <div style={{ background: 'rgba(0,0,0,.05)', color: '#1A1A1A', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>{info}</div>}

        <button onClick={submit} disabled={loading}
          style={{
            width: '100%', background: 'var(--sage)', color: '#fff', borderRadius: 10,
            padding: '13px', fontWeight: 700, fontSize: 15, marginTop: 4,
            opacity: loading ? .6 : 1, cursor: loading ? 'wait' : 'pointer',
          }}>
          {loading ? 'Please wait…' : (
            mode === 'signin' ? 'Sign In' :
            mode === 'signup' ? 'Create Account' :
            mode === 'forgot' ? 'Send reset link' :
            'Update password'
          )}
        </button>

        {/* Back to sign in — when in forgot/reset */}
        {(mode === 'forgot' || mode === 'reset') && (
          <button type="button" onClick={() => { setMode('signin'); setErr(''); setInfo(''); }}
            style={{ background: 'transparent', color: 'var(--warm-gray)', fontSize: 12, fontWeight: 600, marginTop: 14, width: '100%', textAlign: 'center' }}>
            ← Back to sign in
          </button>
        )}

        {/* Google sign-in (only when configured on the server) */}
        {googleClientId && (mode === 'signin' || mode === 'signup') && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 14px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
              <span style={{ fontSize: 11, color: 'var(--warm-gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
            </div>
            <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center' }} />
          </>
        )}

        {/* Divider + Guest — only on the main sign-in/up screens */}
        {(mode === 'signin' || mode === 'signup') && (<>
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
        </>)}

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--warm-gray)', marginTop: 18, lineHeight: 1.6 }}>
          Sign up to track your spend, join a squad and unlock 5% group discounts.
        </p>
      </div>
    </div>
  );
};

Object.assign(window, { LoginPage });
