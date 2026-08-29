// LoginPage — first screen. Sign in / Sign up / Continue as guest.
// Supports email+password and (optionally) Google Sign-In. (design refresh)
const LoginPage = ({ onAuth, onGuest }) => {
  const isMobile = useMobile();
  const [mode, setMode] = React.useState('signin'); // signin | signup | forgot | reset
  // Act 843 is built around consent and prior notice. The signup form made no
  // reference to the privacy notice or terms at all — no checkbox, no link, no
  // wording — so there was no record that any customer had been shown, let
  // alone agreed to, the policy the site publishes (audit H-03).
  const [acceptedTerms, setAcceptedTerms] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', email: '', phone: '', password: '', refCode: '', newPassword: '', confirmPassword: '' });
  const [err, setErr] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const [googleClientId, setGoogleClientId] = React.useState('');
  const googleBtnRef = React.useRef(null);
  const refCodeRef = React.useRef('');
  const resetTokenRef = React.useRef('');

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) { setMode('signup'); setForm(f => ({ ...f, refCode: ref.toUpperCase() })); refCodeRef.current = ref.toUpperCase(); }
    const resetToken = params.get('reset');
    if (resetToken) { resetTokenRef.current = resetToken; setMode('reset'); }
  }, []);

  React.useEffect(() => {
    fetch('/api/auth/config').then(r => r.json()).then(cfg => { if (cfg.googleClientId) setGoogleClientId(cfg.googleClientId); }).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!googleClientId || !googleBtnRef.current) return;
    let tries = 0;
    const tryRender = () => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            setErr(''); setLoading(true);
            try {
              const r = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: response.credential, refCode: refCodeRef.current || form.refCode }) });
              const data = await r.json();
              if (!r.ok) { setErr(data.error || 'Google sign-in failed'); setLoading(false); return; }
              onAuth({ ...data.user, token: data.token });
            } catch (_) { setErr('Network error during Google sign-in'); setLoading(false); }
          },
        });
        googleBtnRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleBtnRef.current, { theme: 'outline', size: 'large', shape: 'rectangular', text: mode === 'signin' ? 'signin_with' : 'signup_with', width: 300 });
      } else if (tries++ < 50) { setTimeout(tryRender, 100); }
    };
    tryRender();
  }, [googleClientId, mode]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(''); setInfo('');
    if (mode === 'forgot') return submitForgot();
    if (mode === 'reset') return submitReset();
    if (mode === 'signin') { if (!form.email || !form.password) { setErr('Email and password required'); return; } }
    else {
      if (!form.name || !form.email || !form.password) { setErr('Name, email and password required'); return; }
      if (!acceptedTerms) { setErr('Please accept the Privacy Notice and Terms to create an account.'); return; }
    }
    setLoading(true);
    try {
      const url = mode === 'signin' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'signin' ? { email: form.email, password: form.password } : { name: form.name, email: form.email, phone: form.phone, password: form.password, refCode: form.refCode, acceptedTerms: true, termsVersion: window.TERMS_VERSION || null };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Login failed'); setLoading(false); return; }
      onAuth({ ...data.user, token: data.token });
    } catch (e) { setErr('Could not connect. Please check your internet and try again.'); }
    finally { setLoading(false); }
  };

  const submitForgot = async () => {
    if (!form.email) { setErr('Enter your email'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email }) });
      const data = await r.json();
      if (data.emailSent) setInfo(`If an account exists for ${form.email}, a reset link has been emailed. Check your inbox.`);
      else if (data.resetLink) { const open = window.confirm(`If an account exists for ${form.email}, a reset link has been generated:\n\n${data.resetLink}\n\nClick OK to open it now (also logged to server console).`); if (open) window.location.href = data.resetLink; }
      else setInfo(`If an account exists for ${form.email}, a reset link has been sent.`);
    } catch (_) { setErr('Network error — please try again'); }
    finally { setLoading(false); }
  };

  const submitReset = async () => {
    if (!form.newPassword || form.newPassword.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (form.newPassword !== form.confirmPassword) { setErr('Passwords do not match'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetTokenRef.current, newPassword: form.newPassword }) });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || 'Reset failed'); setLoading(false); return; }
      try { window.history.replaceState({}, '', window.location.pathname); } catch (_) {}
      setInfo('Password updated — sign in with your new password.');
      setMode('signin'); setForm(f => ({ ...f, password: '', newPassword: '', confirmPassword: '' }));
    } catch (_) { setErr('Network error — please try again'); }
    finally { setLoading(false); }
  };

  const inputS = { width: '100%', padding: '12px 14px', border: '1px solid var(--border-input)', borderRadius: 0, fontFamily: 'var(--f-ui)', fontSize: 14, outline: 'none', background: '#fff', color: 'var(--ink)', marginBottom: 12 };
  const lbl = { display: 'block', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, color: 'var(--rd-muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 };
  const optional = { fontFamily: 'var(--f-ui)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--rd-faint)' };

  const HERO_BG = '/icons/hero.jpg';
  React.useEffect(() => {
    const link = document.createElement('link'); link.rel = 'preload'; link.as = 'image'; link.href = HERO_BG; link.fetchPriority = 'high';
    document.head.appendChild(link); return () => { try { document.head.removeChild(link); } catch (_) {} };
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-ui)', color: 'var(--ink)',
      backgroundColor: '#0d0d0b', backgroundImage: `linear-gradient(rgba(10,10,9,.66),rgba(10,10,9,.8)), url(${HERO_BG})`, backgroundSize: 'cover', backgroundPosition: isMobile ? 'center top' : 'center', backgroundAttachment: isMobile ? 'scroll' : 'fixed', padding: isMobile ? '24px 14px' : '40px 24px' }}>
      <div style={{ background: '#fff', border: '1px solid var(--rule-2)', boxShadow: '0 30px 80px rgba(0,0,0,.5)', padding: isMobile ? '30px 22px' : '40px 36px', width: '100%', maxWidth: 420 }}>
        {/* Wordmark + tagline */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--f-mark)', fontSize: 30, fontWeight: 700, letterSpacing: '-.035em', color: 'var(--ink)' }}>SDGMart</div>
          <div style={{ marginTop: 6, fontSize: 15, color: 'var(--rd-muted)' }}>Tamale's essentials, <span style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', color: 'var(--accent)' }}>delivered.</span></div>
        </div>

        {/* Tab switcher */}
        {(mode === 'signin' || mode === 'signup') && (
          <div style={{ display: 'flex', border: '1px solid var(--border-input)', marginBottom: 22 }}>
            {['signin', 'signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setErr(''); setInfo(''); }}
                style={{ flex: 1, padding: '10px', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                  background: mode === m ? 'var(--ink)' : 'transparent', color: mode === m ? '#fff' : 'var(--rd-muted)' }}>
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>
        )}

        {(mode === 'forgot' || mode === 'reset') && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-.028em' }}>{mode === 'forgot' ? 'Reset your password' : 'Choose a new password'}</div>
            <div style={{ fontSize: 13, color: 'var(--rd-muted)', marginTop: 4, lineHeight: 1.5 }}>{mode === 'forgot' ? "Enter your email and we'll send you a link to choose a new password." : 'At least 8 characters, with a letter and a number.'}</div>
          </div>
        )}

        {mode === 'signup' && (<><label style={lbl}>Your name</label><input placeholder="e.g. Ama Mensah" value={form.name} onChange={e => set('name', e.target.value)} style={inputS} /></>)}
        {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (<><label style={lbl}>Email</label><input placeholder="you@example.com" type="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={inputS} /></>)}
        {mode === 'signup' && (<><label style={lbl}>Phone <span style={optional}>(optional)</span></label><input placeholder="e.g. 024 123 4567" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} style={inputS} /></>)}
        {(mode === 'signin' || mode === 'signup') && (
          <>
            <label style={lbl}>Password</label>
            <div style={{ position: 'relative', marginBottom: mode === 'signup' ? 6 : 12 }}>
              <input placeholder={mode === 'signup' ? 'Create a password' : 'Your password'} type={showPw ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={form.password} onChange={e => set('password', e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={{ ...inputS, marginBottom: 0, paddingRight: 62 }} />
              <button type="button" onClick={() => setShowPw(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
            {mode === 'signup' && <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginBottom: 12 }}>At least 8 characters, with a letter and a number.</div>}
          </>
        )}
        {mode === 'signup' && (<><label style={lbl}>Referral code <span style={optional}>(optional)</span></label><input placeholder="From a friend? Enter it here" value={form.refCode} onChange={e => set('refCode', e.target.value.toUpperCase())} style={inputS} /></>)}
        {mode === 'signup' && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, lineHeight: 1.5, color: 'var(--rd-body)', marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}
              style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
            <span>
              I've read and accept the{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>Privacy Notice</a>
              {' '}and{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>Terms</a>.
              This includes storing my delivery address and map pin so we can deliver to you.
            </span>
          </label>
        )}
        {mode === 'reset' && (<>
          <label style={lbl}>New password</label><input placeholder="At least 8 characters" type={showPw ? 'text' : 'password'} value={form.newPassword} onChange={e => set('newPassword', e.target.value)} style={inputS} />
          <label style={lbl}>Confirm new password</label><input placeholder="Re-enter your new password" type={showPw ? 'text' : 'password'} value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={inputS} />
        </>)}

        {mode === 'signin' && (
          <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 10 }}>
            <button type="button" onClick={() => { setMode('forgot'); setErr(''); setInfo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-ui)', fontSize: 12.5, color: 'var(--accent)' }}>Forgot password?</button>
          </div>
        )}

        {err && <div style={{ background: 'var(--surface-warm)', borderLeft: '2px solid var(--accent)', color: 'var(--accent)', padding: '9px 12px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
        {info && <div style={{ background: 'var(--surface-warm)', borderLeft: '2px solid var(--ink)', color: 'var(--ink-2)', padding: '9px 12px', fontSize: 12.5, marginBottom: 12 }}>{info}</div>}

        <button onClick={submit} disabled={loading}
          style={{ width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', padding: '14px', fontFamily: 'var(--f-ui)', fontSize: 15, fontWeight: 600, marginTop: 4, opacity: loading ? .6 : 1, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Please wait…' : (mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Send reset link' : 'Update password')}
        </button>

        {(mode === 'forgot' || mode === 'reset') && (
          <button type="button" onClick={() => { setMode('signin'); setErr(''); setInfo(''); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-ui)', fontSize: 12.5, color: 'var(--rd-muted)', marginTop: 14 }}>← Back to sign in</button>
        )}

        {googleClientId && (mode === 'signin' || mode === 'signup') && (
          <>
            <LoginDivider />
            <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center' }} />
          </>
        )}

        {(mode === 'signin' || mode === 'signup') && (<>
          <LoginDivider />
          <button onClick={onGuest} style={{ width: '100%', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '13px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>Continue as Guest</button>
        </>)}

        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--rd-muted)', marginTop: 20, lineHeight: 1.6 }}>Sign up to track your spend, join a squad and unlock 5% group discounts.</p>
      </div>
    </div>
  );
};

// Hairline "or" divider
const LoginDivider = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 14px' }}>
    <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--rd-faint)', letterSpacing: '.1em', textTransform: 'uppercase' }}>or</span>
    <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
  </div>
);

Object.assign(window, { LoginPage });
