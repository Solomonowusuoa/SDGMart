// One request can contain a shopping list; keep line breaks for staff.
const RequestProductButton = ({ label, style, prefillProduct, currentUser }) => {
  const emptyForm = () => ({ name: currentUser?.name || '', whatsappNumber: currentUser?.phone || '', callNumber: '', contactWhatsapp: true, contactCall: false, productName: prefillProduct || '', notes: '' });
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState('');
  const dialogRef = React.useRef(null);
  const busyRef = React.useRef(false);
  const id = React.useId();
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const close = () => { if (!busyRef.current) setOpen(false); };

  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current.querySelector('textarea, button').focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { e.preventDefault(); dialogRef.current.focus(); return; }
      if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  React.useEffect(() => {
    if (submitted && dialogRef.current) dialogRef.current.querySelector('button').focus();
  }, [submitted]);

  const submit = async e => {
    e.preventDefault();
    if (busyRef.current) return;
    setErr('');
    if (!form.name.trim() || !form.productName.trim()) { setErr('Your name and at least one item are required'); return; }
    if (!form.whatsappNumber.trim() && !form.callNumber.trim()) { setErr('Please give us at least one number to reach you'); return; }
    if (!form.contactWhatsapp && !form.contactCall) { setErr('Choose how we should contact you'); return; }
    if (form.contactWhatsapp && !form.whatsappNumber.trim()) { setErr('Please add your WhatsApp number'); return; }
    if (form.contactCall && !form.callNumber.trim()) { setErr('Please add your call number'); return; }
    busyRef.current = true; setSubmitting(true);
    try {
      const r = await fetch('/api/product-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not submit your request'); return; }
      setSubmitted(true);
    } catch (_) { setErr('Network error — please try again'); }
    finally { busyRef.current = false; setSubmitting(false); }
  };
  const field = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border-input)', borderRadius: 0, padding: 12, fontFamily: 'var(--f-ui)', fontSize: 16, lineHeight: 1.5, color: 'var(--ink)', background: '#fff', marginTop: 6 };
  const labelStyle = { display: 'block', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 16 };
  const primary = { background: 'var(--ink)', color: '#fff', border: '1px solid var(--ink)', borderRadius: 0, padding: '13px 18px', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase' };
  return <>
    <button type="button" onClick={() => { setForm(emptyForm()); setSubmitted(false); setErr(''); setOpen(true); }} style={style || { ...primary, background: '#fff', color: 'var(--ink)' }}>{label || "Can't find what you want? Request items"}</button>
    {open && <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--rule)', width: '100%', maxWidth: 520, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', overscrollBehavior: 'contain', padding: 24, boxSizing: 'border-box', textAlign: 'left' }}>
        <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--rd-muted)', marginBottom: 10 }}>Your shopping list</div>
        <h2 id={`${id}-title`} style={{ fontFamily: 'var(--f-display)', fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.15, margin: '0 0 12px' }}>{submitted ? 'Request received' : 'Request items'}</h2>
        {submitted ? <>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--rd-body)' }}>We'll check availability and contact you with a price and timeline for the items we can source.</p>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 16, background: 'var(--surface-warm)', borderLeft: '2px solid var(--ink)', margin: '20px 0', fontSize: 14 }}>{form.productName}</div>
          <button type="button" onClick={close} style={{ ...primary, width: '100%' }}>Done</button>
        </> : <form onSubmit={submit}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--rd-body)', marginBottom: 24 }}>Tell us what you'd like to buy. You can request several items at once.</p>
          <fieldset disabled={submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <label style={labelStyle}>Items you're looking for *
              <textarea required value={form.productName} onChange={e => set('productName', e.target.value)} placeholder={'Heinz baked beans, 500g — 2 tins\nBrown bread — 1 loaf'} rows={5} maxLength={2000} aria-describedby={`${id}-help`} style={{ ...field, resize: 'vertical' }} />
              <span id={`${id}-help`} style={{ display: 'block', fontFamily: 'var(--f-ui)', fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: 'none', lineHeight: 1.5, color: 'var(--rd-muted)', marginTop: 6 }}>Put each item on a new line. Include brands, sizes and quantities if you know them.</span>
            </label>
            <label style={labelStyle}>Extra details (optional)<textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything else that will help us find the right items" rows={2} maxLength={600} style={{ ...field, resize: 'vertical' }} /></label>
            <label style={labelStyle}>Your name *<input required autoComplete="name" value={form.name} maxLength={100} onChange={e => set('name', e.target.value)} style={field} /></label>
            <label style={labelStyle}>WhatsApp number<input type="tel" autoComplete="tel" value={form.whatsappNumber} maxLength={30} onChange={e => set('whatsappNumber', e.target.value)} placeholder="024 123 4567" style={field} /></label>
            <label style={labelStyle}>Call number<input type="tel" value={form.callNumber} maxLength={30} onChange={e => set('callNumber', e.target.value)} placeholder="020 765 4321" style={field} /></label>
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 20px' }}>
              <legend style={labelStyle}>How should we reach you?</legend>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.contactWhatsapp} onChange={e => set('contactWhatsapp', e.target.checked)} style={{ accentColor: 'var(--ink)', width: 18, height: 18 }} />WhatsApp</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.contactCall} onChange={e => set('contactCall', e.target.checked)} style={{ accentColor: 'var(--ink)', width: 18, height: 18 }} />Phone call</label>
              </div>
            </fieldset>
          </fieldset>
          {err && <p role="alert" style={{ color: 'var(--accent-red)', fontSize: 13, marginBottom: 14 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
            <button type="submit" disabled={submitting} style={{ ...primary, flex: 1, opacity: submitting ? .6 : 1 }}>{submitting ? 'Sending…' : 'Send request'}</button>
            <button type="button" onClick={close} disabled={submitting} style={{ ...primary, background: '#fff', color: 'var(--ink)' }}>Cancel</button>
          </div>
        </form>}
      </div>
    </div>}
  </>;
};
Object.assign(window, { RequestProductButton });
