// AccountPage — manage profile + saved addresses
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

  const load = () => {
    apiFetch('/api/me/addresses').then(r => r.ok ? r.json() : []).then(setAddresses).catch(() => setAddresses([]));
  };
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
      setSaved('Profile updated');
      setTimeout(() => setSaved(''), 2000);
    } catch (_) { setErr('Network error'); }
  };

  const saveAddress = async () => {
    setErr('');
    // Resolve a custom-typed neighborhood when "Other" is selected
    const effectiveNeighborhood = draft.neighborhood === '__other__'
      ? (draft.customNeighborhood || '').trim()
      : draft.neighborhood;
    if (!draft.label || !effectiveNeighborhood) { setErr('Label and neighborhood are required'); return; }
    const payload = { ...draft, neighborhood: effectiveNeighborhood };
    delete payload.customNeighborhood;
    try {
      if (editingId) {
        await apiFetch(`/api/me/addresses/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/me/addresses', { method: 'POST', body: JSON.stringify(payload) });
      }
      setAdding(false); setEditingId(null);
      setDraft({ label: 'Home', neighborhood: '', customNeighborhood: '', address: '', location: null, isDefault: false });
      load();
    } catch (_) { setErr('Could not save'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this address?')) return;
    await apiFetch(`/api/me/addresses/${id}`, { method: 'DELETE' });
    load();
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    // If the saved neighborhood isn't one of the presets, treat it as "Other"
    const known = (window.NEIGHBORHOODS || []).includes(a.neighborhood);
    setDraft({
      label: a.label,
      neighborhood: known ? a.neighborhood : (a.neighborhood ? '__other__' : ''),
      customNeighborhood: known ? '' : (a.neighborhood || ''),
      address: a.address || '', location: a.location || null, isDefault: !!a.isDefault,
    });
    setAdding(true);
  };
  // Which of the label presets is active (Home/Work), else custom
  const labelIsPreset = draft.label === 'Home' || draft.label === 'Work';

  const inputS = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', background: 'var(--white)', marginBottom: 10 };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? 16 : 28 }}>
      <button onClick={() => setPage('home')}
        style={{ fontSize: 13, color: 'var(--warm-gray)', fontWeight: 600, background: 'transparent', marginBottom: 14 }}>
        ← Back to home
      </button>
      <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginBottom: 18 }}>My Account</h1>

      {/* Profile */}
      <section style={{ background: 'var(--white)', borderRadius: 12, padding: '20px 22px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Profile</h2>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputS} />
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Phone</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} style={inputS} placeholder="+233 24 123 4567" />

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Birthday</label>
        {birthdayLocked ? (
          <div style={{ ...inputS, color: 'var(--warm-gray)', background: 'var(--cream)', display: 'flex', alignItems: 'center' }}>
            🎂 {currentUser.birthDay} {['','January','February','March','April','May','June','July','August','September','October','November','December'][currentUser.birthMonth] || ''}
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>🔒 locked</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <select value={birthDay} onChange={e => setBirthDay(e.target.value)} style={{ ...inputS, flex: 1, marginBottom: 6, cursor: 'pointer' }}>
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={birthMonth} onChange={e => setBirthMonth(e.target.value)} style={{ ...inputS, flex: 2, marginBottom: 6, cursor: 'pointer' }}>
                <option value="">Month</option>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginBottom: 10 }}>Set once to unlock birthday treats 🎁 — it can't be changed afterwards.</div>
          </>
        )}
        <div style={{ marginTop: 4 }}>
          <input value={currentUser.email || ''} readOnly style={{ ...inputS, color: 'var(--warm-gray)', background: 'var(--cream)' }} />
          <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginTop: -6, marginBottom: 10 }}>Email is permanent and cannot be changed.</div>
        </div>
        <button onClick={saveProfile}
          style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px 20px', fontWeight: 700, fontSize: 13 }}>
          Save profile
        </button>
        {saved && <span style={{ marginLeft: 12, color: 'var(--sage)', fontSize: 13 }}>✓ {saved}</span>}
        {err && <span style={{ marginLeft: 12, color: 'var(--accent-red)', fontSize: 13 }}>{err}</span>}
      </section>

      {/* Addresses */}
      <section style={{ background: 'var(--white)', borderRadius: 12, padding: '20px 22px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700 }}>Saved Addresses</h2>
          {!adding && (
            <button onClick={() => { setAdding(true); setEditingId(null); setDraft({ label: 'Home', neighborhood: '', customNeighborhood: '', address: '', location: null, isDefault: false }); }}
              style={{ fontSize: 12, color: 'var(--sage-dark)', fontWeight: 700, background: 'var(--cream)', borderRadius: 6, padding: '6px 12px' }}>
              + Add address
            </button>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: -6, marginBottom: 12 }}>
          Your <strong style={{ color: 'var(--warm-black)' }}>default</strong> address auto-fills checkout. Add Home, Work, or anywhere else you order to.
        </div>
        {addresses === null ? (
          <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Loading…</div>
        ) : addresses.length === 0 && !adding ? (
          <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>No saved addresses yet. Add your home or workplace to skip filling them in at checkout.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {addresses.map(a => (
              <div key={a.id} style={{ border: '1px solid var(--cream-dark)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {a.label}
                    {a.isDefault && <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--sage)', color: '#fff', borderRadius: 999, padding: '1px 8px', fontWeight: 700 }}>DEFAULT</span>}
                    {a.isLastUsed && !a.isDefault && <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 999, padding: '1px 8px', fontWeight: 700 }}>LAST USED</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>
                    {a.neighborhood}{a.address ? ` · ${a.address}` : ''}
                    {a.location && a.location.address ? ` · 📍 ${a.location.address}` : ''}
                  </div>
                </div>
                <button onClick={() => startEdit(a)} style={{ fontSize: 11, color: 'var(--sage-dark)', fontWeight: 700, padding: '6px 8px' }}>Edit</button>
                <button onClick={() => remove(a.id)} style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 700, padding: '6px 8px' }}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {adding && (
          <div style={{ marginTop: 16, padding: 16, background: 'var(--cream)', borderRadius: 10 }}>
            {/* Label picker */}
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>Label <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['Home', 'Work'].map(l => (
                <button key={l} onClick={() => setDraft(d => ({ ...d, label: l }))}
                  style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: draft.label === l ? 'var(--sage)' : 'var(--white)', color: draft.label === l ? '#fff' : 'var(--warm-gray)', border: '1px solid var(--cream-dark)' }}>
                  {l}
                </button>
              ))}
              <button onClick={() => setDraft(d => ({ ...d, label: labelIsPreset ? '' : d.label }))}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: !labelIsPreset ? 'var(--sage)' : 'var(--white)', color: !labelIsPreset ? '#fff' : 'var(--warm-gray)', border: '1px solid var(--cream-dark)' }}>
                Other
              </button>
            </div>
            {!labelIsPreset && (
              <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                placeholder="Custom label (e.g. Mom's place)" style={inputS} />
            )}

            {/* Neighborhood with custom option */}
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Neighborhood <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <select value={draft.neighborhood} onChange={e => setDraft(d => ({ ...d, neighborhood: e.target.value }))} style={inputS}>
              <option value="">Select neighborhood…</option>
              {(window.NEIGHBORHOODS || []).map(n => <option key={n} value={n}>{n}</option>)}
              <option value="__other__">Other (type my own)…</option>
            </select>
            {draft.neighborhood === '__other__' && (
              <input value={draft.customNeighborhood || ''} onChange={e => setDraft(d => ({ ...d, customNeighborhood: e.target.value }))}
                placeholder="Type your neighborhood / area" style={inputS} />
            )}

            <input value={draft.address} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))}
              placeholder="Address or landmark (optional)" style={inputS} />

            {/* Map pin */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>
                Pin the exact spot (optional)
              </label>
              <MapPicker value={draft.location || null} onChange={(loc) => setDraft(d => ({ ...d, location: loc }))} height={220} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 13 }}>
              <input type="checkbox" checked={draft.isDefault} onChange={e => setDraft(d => ({ ...d, isDefault: e.target.checked }))}
                style={{ accentColor: 'var(--sage)' }} />
              Use as my default address
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={saveAddress} style={{ flex: 1, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13 }}>
                {editingId ? 'Save changes' : 'Add address'}
              </button>
              <button onClick={() => { setAdding(false); setEditingId(null); }}
                style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Feedback / complaints */}
      <section style={{ marginBottom: 20 }}>
        <FeedbackBox />
      </section>
    </div>
  );
};

Object.assign(window, { AccountPage });
