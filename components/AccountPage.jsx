// Reusable "turn on notifications" card. Hides itself once the user decides
// (permission != 'default') or when push is unsupported. (design refresh)
const NotifyOptIn = ({ label }) => {
  const [perm, setPerm] = React.useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  if (perm !== 'default') return null;
  return (
    <div style={{ border: '1px solid var(--rule-2)', background: 'var(--surface-warm)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--f-ui)' }}>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{label || 'Get order updates & first dibs on flash sales'}</div>
      <button onClick={async () => { try { await window.subscribeToPush(); } catch (_) {} setPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'); }}
        style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '9px 18px', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Enable</button>
    </div>
  );
};
Object.assign(window, { NotifyOptIn });

// AccountPage — manage profile + saved addresses (design refresh)
const AccountPage = ({ setPage, currentUser, setCurrentUser }) => {
  const isMobile = useMobile();
  const [name, setName] = React.useState(currentUser.name || '');
  const [phone, setPhone] = React.useState(currentUser.phone || '');
  const birthdayLocked = !!(currentUser.birthDay && currentUser.birthMonth);
  const [birthDay, setBirthDay] = React.useState(currentUser.birthDay || '');
  const [birthMonth, setBirthMonth] = React.useState(currentUser.birthMonth || '');
  const [addresses, setAddresses] = React.useState(null);
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  const [draft, setDraft] = React.useState({ label: 'Home', neighborhood: '', address: '', location: null, isDefault: false });
  const [saved, setSaved] = React.useState('');
  const [err, setErr] = React.useState('');
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const load = () => { apiFetch('/api/me/addresses').then(r => r.ok ? r.json() : []).then(setAddresses).catch(() => setAddresses([])); };
  React.useEffect(load, []);

  const saveProfile = async () => {
    setErr(''); setSaved('');
    try {
      const body = { name, phone };
      if (!birthdayLocked && birthDay && birthMonth) { body.birthDay = Number(birthDay); body.birthMonth = Number(birthMonth); }
      const r = await apiFetch('/api/me/profile', { method: 'PUT', body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json(); setErr(d.error || 'Failed'); return; }
      const u = await r.json();
      setCurrentUser(prev => ({ ...prev, ...u }));
      setSaved('Profile updated'); setTimeout(() => setSaved(''), 2000);
    } catch (_) { setErr('Network error'); }
  };

  const saveAddress = async () => {
    setErr('');
    const effectiveNeighborhood = draft.neighborhood === '__other__' ? (draft.customNeighborhood || '').trim() : draft.neighborhood;
    if (!draft.label || !effectiveNeighborhood) { setErr('Label and neighborhood are required'); return; }
    const payload = { ...draft, neighborhood: effectiveNeighborhood };
    delete payload.customNeighborhood;
    try {
      if (editingId) await apiFetch(`/api/me/addresses/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await apiFetch('/api/me/addresses', { method: 'POST', body: JSON.stringify(payload) });
      setAdding(false); setEditingId(null);
      setDraft({ label: 'Home', neighborhood: '', customNeighborhood: '', address: '', location: null, isDefault: false });
      load();
    } catch (_) { setErr('Could not save'); }
  };

  const remove = async (id) => { if (!window.confirm('Delete this address?')) return; await apiFetch(`/api/me/addresses/${id}`, { method: 'DELETE' }); load(); };
  const startEdit = (a) => {
    setEditingId(a.id);
    const known = (window.NEIGHBORHOODS || []).includes(a.neighborhood);
    setDraft({ label: a.label, neighborhood: known ? a.neighborhood : (a.neighborhood ? '__other__' : ''), customNeighborhood: known ? '' : (a.neighborhood || ''), address: a.address || '', location: a.location || null, isDefault: !!a.isDefault });
    setAdding(true);
  };
  const labelIsPreset = draft.label === 'Home' || draft.label === 'Work';

  const inputS = { width: '100%', padding: '11px 14px', border: '1px solid var(--border-input)', borderRadius: 0, fontFamily: 'var(--f-ui)', fontSize: 14, outline: 'none', background: '#fff', color: 'var(--ink)', marginBottom: 12 };
  const lbl = { display: 'block', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, color: 'var(--rd-muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 };
  const section = { border: '1px solid var(--rule-2)', padding: '22px 24px', marginBottom: 20 };
  const h2 = { margin: 0, fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 700, letterSpacing: '-.02em' };
  const pill = (on) => ({ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '7px 13px', border: `1px solid ${on ? 'var(--ink)' : 'var(--border-input)'}`, background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--rd-muted)', cursor: 'pointer' });

  return (
    <div className="rd-gutter" style={{ maxWidth: 720, margin: '0 auto', fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)', paddingTop: isMobile ? 20 : 32, paddingBottom: 40, minHeight: '60vh' }}>
      <button onClick={() => setPage('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--rd-muted)', marginBottom: 14 }}>← Back to home</button>
      <h1 style={{ fontFamily: 'var(--f-display)', fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: '-.03em', margin: '0 0 20px' }}>My Account</h1>

      {/* Profile */}
      <section style={section}>
        <h2 style={{ ...h2, marginBottom: 16 }}>Profile</h2>
        <label style={lbl}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputS} />
        <label style={lbl}>Phone</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} style={inputS} placeholder="+233 24 123 4567" />
        <label style={lbl}>Birthday</label>
        {birthdayLocked ? (
          <div style={{ ...inputS, color: 'var(--rd-muted)', background: 'var(--surface-warm)', display: 'flex', alignItems: 'center' }}>
            {currentUser.birthDay} {MONTHS[currentUser.birthMonth] || ''}
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.1em', color: 'var(--rd-faint)' }}>LOCKED</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <select value={birthDay} onChange={e => setBirthDay(e.target.value)} style={{ ...inputS, flex: 1, marginBottom: 6, cursor: 'pointer' }}><option value="">Day</option>{Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}</select>
              <select value={birthMonth} onChange={e => setBirthMonth(e.target.value)} style={{ ...inputS, flex: 2, marginBottom: 6, cursor: 'pointer' }}><option value="">Month</option>{MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginBottom: 12 }}>Set once to unlock birthday treats — it can't be changed afterwards.</div>
          </>
        )}
        <input value={currentUser.email || ''} readOnly style={{ ...inputS, color: 'var(--rd-muted)', background: 'var(--surface-warm)' }} />
        <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginTop: -6, marginBottom: 12 }}>Email is permanent and cannot be changed.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={saveProfile} style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '11px 22px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>Save profile</button>
          {saved && <span style={{ color: 'var(--wa)', fontSize: 13 }}>✓ {saved}</span>}
          {err && <span style={{ color: 'var(--accent)', fontSize: 13 }}>{err}</span>}
        </div>
      </section>

      <div style={{ marginBottom: 20 }}><NotifyOptIn label="Turn on notifications for order updates & flash-sale alerts" /></div>

      {/* Addresses */}
      <section style={section}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={h2}>Saved addresses</h2>
          {!adding && <button onClick={() => { setAdding(true); setEditingId(null); setDraft({ label: 'Home', neighborhood: '', customNeighborhood: '', address: '', location: null, isDefault: false }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', borderBottom: '1px solid var(--accent)', paddingBottom: 1 }}>+ Add address</button>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--rd-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>Your <strong style={{ color: 'var(--ink)' }}>default</strong> address auto-fills checkout. Add Home, Work, or anywhere else you order to.</div>
        {addresses === null ? <div style={{ fontSize: 13, color: 'var(--rd-muted)' }}>Loading…</div>
          : addresses.length === 0 && !adding ? <div style={{ fontSize: 13, color: 'var(--rd-muted)' }}>No saved addresses yet. Add your home or workplace to skip filling them in at checkout.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {addresses.map(a => (
                <div key={a.id} style={{ border: '1px solid var(--rule-2)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {a.label}
                      {a.isDefault && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.06em', background: 'var(--ink)', color: '#fff', padding: '2px 7px' }}>DEFAULT</span>}
                      {a.isLastUsed && !a.isDefault && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.06em', background: 'var(--rule-2)', color: 'var(--rd-muted)', padding: '2px 7px' }}>LAST USED</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 3 }}>{a.neighborhood}{a.address ? ` · ${a.address}` : ''}{a.location && a.location.address ? <span style={{ fontFamily: 'var(--f-mono)' }}> · {a.location.address}</span> : ''}</div>
                  </div>
                  <button onClick={() => startEdit(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>Edit</button>
                  <button onClick={() => remove(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Delete</button>
                </div>
              ))}
            </div>
          )}

        {adding && (
          <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--rule-2)', background: 'var(--surface-warm)' }}>
            <label style={lbl}>Label <span style={{ color: 'var(--accent)' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {['Home', 'Work'].map(l => <button key={l} onClick={() => setDraft(d => ({ ...d, label: l }))} style={pill(draft.label === l)}>{l}</button>)}
              <button onClick={() => setDraft(d => ({ ...d, label: labelIsPreset ? '' : d.label }))} style={pill(!labelIsPreset)}>Other</button>
            </div>
            {!labelIsPreset && <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Custom label (e.g. Mom's place)" style={inputS} />}
            <label style={lbl}>Neighborhood <span style={{ color: 'var(--accent)' }}>*</span></label>
            <select value={draft.neighborhood} onChange={e => setDraft(d => ({ ...d, neighborhood: e.target.value }))} style={inputS}><option value="">Select neighborhood…</option>{(window.NEIGHBORHOODS || []).map(n => <option key={n} value={n}>{n}</option>)}<option value="__other__">Other (type my own)…</option></select>
            {draft.neighborhood === '__other__' && <input value={draft.customNeighborhood || ''} onChange={e => setDraft(d => ({ ...d, customNeighborhood: e.target.value }))} placeholder="Type your neighborhood / area" style={inputS} />}
            <input value={draft.address} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} placeholder="Address or landmark (optional)" style={inputS} />
            <label style={{ ...lbl, marginTop: 4 }}>Pin the exact spot (optional)</label>
            <div style={{ marginBottom: 12 }}><MapPicker value={draft.location || null} onChange={(loc) => setDraft(d => ({ ...d, location: loc }))} height={220} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.isDefault} onChange={e => setDraft(d => ({ ...d, isDefault: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--ink)' }} />
              Use as my default address
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={saveAddress} style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '11px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>{editingId ? 'Save changes' : 'Add address'}</button>
              <button onClick={() => { setAdding(false); setEditingId(null); }} style={{ background: 'transparent', color: 'var(--rd-muted)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '11px 16px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 20 }}><FeedbackBox /></section>
    </div>
  );
};

Object.assign(window, { AccountPage });
