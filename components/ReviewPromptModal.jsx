// ReviewPromptModal — shows when a signed-in user has delivered ORDERS not
// yet reviewed (one rating per order, not per item). Star rating + optional
// message. Dismissible (won't re-show for 7d).
const ReviewPromptModal = ({ currentUser }) => {
  const [pending, setPending] = React.useState([]);
  const [idx, setIdx] = React.useState(0);
  const [rating, setRating] = React.useState(0);
  const [message, setMessage] = React.useState('');
  const [closed, setClosed] = React.useState(false);

  React.useEffect(() => {
    if (!currentUser || !currentUser.id || currentUser.role === 'guest') return;
    try {
      const dismissedAt = Number(localStorage.getItem('sdg-review-dismissed') || 0);
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return; // 7-day cooldown
    } catch (_) {}
    apiFetch('/api/me/pending-reviews').then(r => r.ok ? r.json() : []).then(items => {
      if (Array.isArray(items) && items.length) setPending(items);
    }).catch(() => {});
  }, [currentUser]);

  if (closed || !pending.length || idx >= pending.length) return null;
  const cur = pending[idx];

  const submit = async () => {
    if (rating < 1) return;
    await apiFetch('/api/me/reviews', {
      method: 'POST',
      body: JSON.stringify({ orderId: cur.orderId, rating, message }),
    });
    setRating(0); setMessage('');
    if (idx + 1 >= pending.length) finish();
    else setIdx(idx + 1);
  };

  const skip = () => {
    setRating(0); setMessage('');
    if (idx + 1 >= pending.length) finish();
    else setIdx(idx + 1);
  };

  const dismiss = () => {
    try { localStorage.setItem('sdg-review-dismissed', String(Date.now())); } catch (_) {}
    setClosed(true);
  };

  const finish = () => {
    try { localStorage.setItem('sdg-review-dismissed', String(Date.now())); } catch (_) {}
    setClosed(true);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 420, width: '100%' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
          {pending.length > 1 ? `${idx + 1} of ${pending.length} · ` : ''}How did we do?
        </div>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Rate order <em>{window.orderCode(cur.orderId)}</em></h2>
        {cur.itemsSummary && (
          <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginBottom: 12 }}>{cur.itemsSummary}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => setRating(n)} type="button"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              style={{ fontSize: 36, lineHeight: 1, padding: 0, background: 'transparent', color: n <= rating ? '#F0C674' : 'var(--cream-dark)', transition: 'color .15s' }}>
              ★
            </button>
          ))}
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="A short note (optional)" rows={3} maxLength={500}
          style={{ width: '100%', padding: 12, borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 14, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} disabled={rating < 1}
            style={{ flex: 1, background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '10px', fontWeight: 700, fontSize: 13, opacity: rating < 1 ? .5 : 1 }}>
            Submit
          </button>
          <button onClick={skip}
            style={{ background: 'var(--cream-dark)', color: 'var(--warm-gray)', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 13 }}>
            Skip
          </button>
        </div>
        <button onClick={dismiss}
          style={{ marginTop: 12, width: '100%', fontSize: 11, color: 'var(--warm-gray)', background: 'transparent', padding: 6 }}>
          Not now — ask me later
        </button>
      </div>
    </div>
  );
};

Object.assign(window, { ReviewPromptModal });
