// RequestProductButton — opens a modal where customers ask for an item we
// don't stock yet. Admin sees the request in their dashboard.
//
// Props:
//   label          — button text (default: "📝 Request an item")
//   style          — extra styles for the button
//   prefillProduct — pre-fill the product name field (used from empty search)
//   currentUser    — used to pre-fill name + phone if signed in
//
const RequestProductButton = ({ label, style, prefillProduct, currentUser }) => {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    name: (currentUser && currentUser.name) || '',
    phone: (currentUser && currentUser.phone) || '',
    productName: prefillProduct || '',
    notes: '',
  });
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    if (open && prefillProduct) setForm(f => ({ ...f, productName: prefillProduct }));
  }, [open, prefillProduct]);

  const submit = async () => {
    setErr('');
    if (!form.name.trim() || !form.phone.trim() || !form.productName.trim()) {
      setErr('Name, phone and item are required'); return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/product-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not submit'); setSubmitting(false); return; }
      setSubmitted(true);
    } catch (_) { setErr('Network error — try again'); }
    finally { setSubmitting(false); }
  };

  const reset = () => {
    setOpen(false);
    setSubmitted(false);
    setErr('');
    setForm({
      name: (currentUser && currentUser.name) || '',
      phone: (currentUser && currentUser.phone) || '',
      productName: '', notes: '',
    });
  };

  const inputS = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', background: 'var(--white)', marginBottom: 10 };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={style || {
        background: 'var(--cream)', color: 'var(--sage-dark)', borderRadius: 8,
        padding: '10px 16px', fontWeight: 700, fontSize: 13, border: '1.5px solid var(--cream-dark)',
      }}>
        {label || "📝 Can't find what you want? Request it"}
      </button>

      {open && (
        <div onClick={reset} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 460, width: '100%' }}>
            {submitted ? (
              <>
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ fontSize: 48 }}>📬</div>
                  <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginTop: 8, marginBottom: 10 }}>Request received!</h2>
                  <p style={{ fontSize: 13, color: 'var(--warm-gray)', lineHeight: 1.55 }}>
                    We'll source <strong style={{ color: 'var(--warm-black)' }}>{form.productName}</strong> and get back to you on WhatsApp at <strong style={{ color: 'var(--warm-black)' }}>{form.phone}</strong> if we can find it. Thanks for letting us know what you need!
                  </p>
                </div>
                <button onClick={reset} style={{ width: '100%', background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13 }}>
                  Done
                </button>
              </>
            ) : (
              <>
                <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Request a product</h2>
                <p style={{ fontSize: 13, color: 'var(--warm-gray)', marginBottom: 14 }}>
                  Tell us what you'd like to buy. If we can source it locally, we'll WhatsApp you with a price and timeline.
                </p>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Item you're looking for *</label>
                <input value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))}
                  placeholder="e.g. Heinz baked beans (500g)" style={inputS} />
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Extra details (brand, quantity, etc.)</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional — anything that helps us find the right thing" rows={3}
                  style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Your name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputS} />
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em' }}>WhatsApp number *</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+233 24 123 4567" style={inputS} />
                {err && <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={submit} disabled={submitting}
                    style={{ flex: 1, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '11px', fontWeight: 700, fontSize: 14, opacity: submitting ? .6 : 1, cursor: submitting ? 'wait' : 'pointer' }}>
                    {submitting ? 'Sending…' : 'Send request'}
                  </button>
                  <button onClick={reset}
                    style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 8, padding: '11px 18px', fontWeight: 700, fontSize: 13 }}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

Object.assign(window, { RequestProductButton });
