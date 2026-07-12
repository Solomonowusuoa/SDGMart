// FeedbackBox — general feedback / problem reporting. Rendered in the
// HomePage footer and on the Account page. Two channels:
//   1. In-app send (signed-in users) → POST /api/feedback → admin Issues tab.
//   2. WhatsApp — always available, opens a prefilled chat.
const FeedbackBox = () => {
  const [msg, setMsg] = React.useState('');
  const [state, setState] = React.useState('idle'); // idle | sending | sent
  const [error, setError] = React.useState('');

  let signedIn = false;
  try {
    const u = JSON.parse(sessionStorage.getItem('sdgmart_user') || 'null');
    signedIn = !!(u && u.token && u.role !== 'guest');
  } catch (_) {}

  const openWhatsApp = () => {
    const text = 'Hi SDGMart! I want to report a problem / share feedback' + (msg.trim() ? ': ' + msg.trim() : '.');
    window.open(`https://wa.me/233504082555?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const send = async () => {
    if (!msg.trim()) { setError('Please write a short message first.'); return; }
    setError(''); setState('sending');
    try {
      const r = await apiFetch('/api/feedback', { method: 'POST', body: JSON.stringify({ message: msg.trim() }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Could not send — please try again.'); setState('idle'); return; }
      setState('sent');
    } catch (_) { setError('Network error — please try again.'); setState('idle'); }
  };

  const btnS = { fontSize: 13, fontWeight: 700, borderRadius: 8, padding: '10px 16px', cursor: 'pointer' };

  return (
    <div style={{ background: 'var(--white)', borderRadius: 12, padding: '20px 22px', boxShadow: 'var(--shadow)', color: 'var(--warm-black)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>💬</span>
        <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, margin: 0 }}>Spotted a problem? Tell us.</h3>
      </div>
      <p style={{ fontSize: 13, color: 'var(--warm-gray)', lineHeight: 1.6, marginBottom: 14 }}>
        Your feedback matters deeply to us — every message is read by our team and taken
        seriously. It's how we keep growing and serving Tamale better, so please don't hold back.
      </p>

      {state === 'sent' ? (
        <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '14px 16px', fontSize: 14 }}>
          🙏 <strong>Thank you!</strong> We've received your message and will look into it.
          <button onClick={() => { setMsg(''); setState('idle'); }}
            style={{ display: 'block', marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--sage-dark)', background: 'transparent', padding: 0 }}>
            Send another
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={msg}
            onChange={e => { setMsg(e.target.value); if (error) setError(''); }}
            placeholder="Describe the problem or share your suggestion…"
            rows={3}
            maxLength={1000}
            style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit', background: 'var(--white)', color: 'inherit' }}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--accent-red)', marginTop: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {signedIn ? (
              <button onClick={send} disabled={state === 'sending'}
                style={{ ...btnS, background: 'var(--sage)', color: '#fff', opacity: state === 'sending' ? .6 : 1 }}>
                {state === 'sending' ? 'Sending…' : 'Send to SDGMart'}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--warm-gray)', alignSelf: 'center' }}>
                Sign in to send in-app, or
              </span>
            )}
            <button onClick={openWhatsApp} style={{ ...btnS, background: '#25D366', color: '#fff' }}>
              WhatsApp us instead
            </button>
          </div>
        </>
      )}
    </div>
  );
};

Object.assign(window, { FeedbackBox });
