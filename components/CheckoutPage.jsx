// CheckoutPage — full checkout with Family Mode + WhatsApp bridge
// GHS 10 delivery for orders under FREE_DELIVERY_MIN, free above it.
const STANDARD_DELIVERY = 10;
const FREE_DELIVERY_MIN = 150;
// Signed-in users also get their first ever order delivered free.
const FIRST_ORDER_FREE = true;

// Hoisted out of CheckoutPage so React doesn't recreate the component on
// every render (which would unmount the input and steal focus on each
// keystroke).
const CheckoutField = ({ label, k, type='text', placeholder='', half, value, error, onChange }) => (
  <div style={{ flex: half ? '1 1 45%' : '1 1 100%', minWidth: 0 }}>
    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
    <input
      type={type}
      value={value || ''}
      placeholder={placeholder}
      onChange={e => onChange(k, e.target.value)}
      style={{
        width: '100%', padding: '11px 14px', borderRadius: 10,
        border: `1.5px solid ${error ? 'var(--accent-red)' : 'var(--cream-dark)'}`,
        background: 'var(--white)', fontSize: 14, outline: 'none', transition: 'border .15s',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--sage)'}
      onBlur={e => e.target.style.borderColor = error ? 'var(--accent-red)' : 'var(--cream-dark)'}
    />
    {error && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 3 }}>{error}</div>}
  </div>
);

const CheckoutPage = ({ cart, setCart, setPage, currentUser, setCurrentUser, openTracking }) => {
  const [step, setStep] = React.useState(1); // 1=details, 2=review, 3=confirm
  const isMobile = useMobile();
  const [familyMode, setFamilyMode] = React.useState(false);
  const [downloadReceipt, setDownloadReceipt] = React.useState(false);
  // Recurring orders: opt-in checkbox + cadence (every N days)
  const [autoReorder, setAutoReorder] = React.useState(false);
  const [reorderCadence, setReorderCadence] = React.useState(14);
  // Saved-address book for one-tap checkout
  const [savedAddresses, setSavedAddresses] = React.useState([]);
  React.useEffect(() => {
    if (!currentUser || !currentUser.id || currentUser.role === 'guest') return;
    apiFetch('/api/me/addresses').then(r => r.ok ? r.json() : []).then(list => {
      setSavedAddresses(list || []);
      // Auto-pre-select last-used or default address
      const preferred = list.find(a => a.isLastUsed) || list.find(a => a.isDefault);
      if (preferred && !form.neighborhood) {
        setForm(f => ({
          ...f,
          neighborhood: preferred.neighborhood || f.neighborhood,
          address: preferred.address || f.address,
          location: preferred.location || f.location,
        }));
      }
    }).catch(() => {});
  }, []);
  const applyAddress = (a) => {
    setForm(f => ({
      ...f,
      neighborhood: a.neighborhood || '',
      address: a.address || '',
      location: a.location || null,
    }));
  };
  // MoMo: customer's own number, admin's merchant numbers per telco, picked telco
  const [customerMomo, setCustomerMomo] = React.useState('');
  const [telco, setTelco] = React.useState('mtn');
  const [merchantNumbers, setMerchantNumbers] = React.useState({ mtn: '', telecel: '', at: '', name: '' });
  const [copyState, setCopyState] = React.useState('');

  React.useEffect(() => {
    fetch('/api/momo/numbers').then(r => r.ok ? r.json() : {}).then(setMerchantNumbers).catch(() => {});
  }, []);

  const copyMerchant = () => {
    const n = merchantNumbers[telco] || '';
    if (!n) return;
    try {
      navigator.clipboard.writeText(n).then(() => {
        setCopyState('✓ Copied');
        setTimeout(() => setCopyState(''), 1500);
      });
    } catch (_) {}
  };
  const [form, setForm] = React.useState({
    name: (currentUser && currentUser.name && currentUser.role !== 'guest') ? currentUser.name : '',
    phone: (currentUser && currentUser.phone) || '',
    neighborhood: '', customNeighborhood: '', address: '',
    recipientName: '', recipientPhone: '', recipientAddress: '', mapsPin: '',
    giftMessage: '', payMethod: 'momo',
  });
  const [errors, setErrors] = React.useState({});
  const [orderPlaced, setOrderPlaced] = React.useState(false);
  const [orderId] = React.useState(() => 'SDG-' + Math.random().toString(36).substring(2,8).toUpperCase());
  const [waNumber, setWaNumber] = React.useState('');
  // Snapshot taken at place-order time so the WhatsApp + text receipts still
  // have the full order details after the cart has been cleared.
  const [orderSnapshot, setOrderSnapshot] = React.useState(null);

  // Squad discount eligibility (only for signed-in members)
  // Legacy 'discountPending' (5%-off-subtotal squad reward) is deprecated.
  // Squad rewards now go straight into loyalty_balance as a flat GHS 25 credit.
  // We still honour an existing discountPending flag for users who earned it
  // under the old rules but haven't redeemed yet.
  const canUseDiscount = !!(currentUser && currentUser.id && currentUser.discountPending);
  // Loyalty: GHS 50 credit per GHS 1000 lifetime spend, applied as a flat
  // discount the user can opt to use on this order (capped at the subtotal).
  const loyaltyAvailable = Number(currentUser && currentUser.loyaltyBalance || 0);
  const [useLoyalty, setUseLoyalty] = React.useState(false);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = canUseDiscount ? subtotal * 0.05 : 0;
  const subtotalAfterDiscount = subtotal - discount;
  // Loyalty applies after squad discount, capped at remaining subtotal
  const loyaltyUsed = useLoyalty ? Math.min(loyaltyAvailable, subtotalAfterDiscount) : 0;
  const afterLoyalty = subtotalAfterDiscount - loyaltyUsed;
  // First-order-free for signed-in users (prevents guest abuse: guests pay normally)
  const isFirstOrderFree = FIRST_ORDER_FREE
    && currentUser && currentUser.id && currentUser.role !== 'guest'
    && currentUser.firstOrderDone === false;
  // afterLoyalty is the customer's effective subtotal (post-squad, post-loyalty)
  const qualifiesFreeByThreshold = afterLoyalty >= FREE_DELIVERY_MIN;
  const delivery = (isFirstOrderFree || qualifiesFreeByThreshold) ? 0 : STANDARD_DELIVERY;
  const total = afterLoyalty + delivery;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const err = (k, msg) => setErrors(e => ({ ...e, [k]: msg }));
  const clearErr = (k) => setErrors(e => { const n = {...e}; delete n[k]; return n; });

  // The neighborhood actually used everywhere (display, receipts, API):
  // either the dropdown choice, or — when "Other" is picked — the typed value.
  const effectiveNeighborhood = form.neighborhood === '__other__'
    ? (form.customNeighborhood || '').trim()
    : form.neighborhood;

  const validate1 = () => {
    let ok = true;
    if (!form.name.trim()) { err('name','Required'); ok=false; }
    if (!form.phone.trim() || !/^\+?[\d\s]{9,}$/.test(form.phone)) { err('phone','Valid phone required'); ok=false; }
    if (!effectiveNeighborhood) { err('neighborhood', form.neighborhood === '__other__' ? 'Type your area' : 'Select a neighborhood'); ok=false; }
    if (familyMode) {
      if (!form.recipientName.trim()) { err('recipientName','Required'); ok=false; }
      if (!form.recipientPhone.trim()) { err('recipientPhone','Required'); ok=false; }
    }
    return ok;
  };

  // Convert "+233 50 408 2555" or "0504082555" → "233504082555" (wa.me format)
  const normalizeWaNumber = (raw) => {
    let n = String(raw || '').replace(/[^\d]/g, '');
    if (n.startsWith('00')) n = n.slice(2);
    if (n.startsWith('0')) n = '233' + n.slice(1); // assume Ghana local number
    return n;
  };

  // Build a full receipt as a plain string from a snapshot. Used by both the
  // text-file download and the WhatsApp message so they stay in sync.
  const buildReceiptText = (snap) => {
    if (!snap) return '';
    const itemLines = snap.items.map(i => `• ${i.name} ×${i.qty} — GHS ${(i.price * i.qty).toFixed(2)}`).join('\n');
    const recipient = snap.familyMode
      ? `${snap.form.recipientName} / ${snap.form.recipientPhone}`
      : `${snap.form.name} / ${snap.form.phone}`;
    const location = snap.form.mapsPin || snap.form.address || snap.neighborhood;
    const lines = [
      `*SDGMart Order #${orderId}*`,
      `Date: ${new Date().toLocaleDateString('en-GB')}`,
      ``,
      `*Items*`,
      itemLines,
      ``,
      `Subtotal: GHS ${snap.subtotal.toFixed(2)}`,
    ];
    if (snap.discount > 0) lines.push(`Squad Discount (5%): −GHS ${snap.discount.toFixed(2)}`);
    lines.push(`Delivery: ${snap.delivery === 0 ? 'FREE' : `GHS ${snap.delivery.toFixed(2)}`}`);
    lines.push(`*TOTAL: GHS ${snap.total.toFixed(2)}*`);
    lines.push(``);
    lines.push(`Neighborhood: ${snap.neighborhood}`);
    lines.push(`Recipient: ${recipient}`);
    lines.push(`Location: ${location}`);
    lines.push(`Payment: ${snap.form.payMethod === 'momo' ? 'Mobile Money (MoMo)' : 'Cash on Delivery'}`);
    if (snap.familyMode && snap.form.giftMessage) lines.push(`Gift Message: ${snap.form.giftMessage}`);
    return lines.join('\n');
  };

  const buildWhatsAppMsg = () => encodeURIComponent(buildReceiptText(orderSnapshot));

  const generateReceipt = (snap) => {
    const text = buildReceiptText(snap || orderSnapshot)
      // Strip WhatsApp markdown for the text file
      .replace(/\*/g, '');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SDGMart-${orderId}.txt`;
    a.click();
  };

  const placeOrder = async () => {
    // Snapshot everything that the success screen + receipts need BEFORE we
    // clear the cart. This is what fixes the "WhatsApp message had no items
    // and the total looked like just delivery" bug.
    const snap = {
      items: cart.map(i => ({ ...i })),
      subtotal,
      discount,
      delivery,
      total,
      neighborhood: effectiveNeighborhood,
      familyMode,
      form: { ...form, neighborhood: effectiveNeighborhood },
    };
    setOrderSnapshot(snap);
    if (downloadReceipt) generateReceipt(snap);

    // Persist order to backend (fire-and-forget; WhatsApp bridge remains primary).
    // apiFetch automatically attaches the Bearer token; the server derives the
    // userId from the session and ignores any client-supplied value.
    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          id: orderId,
          customer: snap.familyMode ? snap.form.recipientName : snap.form.name,
          phone: snap.familyMode ? snap.form.recipientPhone : snap.form.phone,
          neighborhood: snap.neighborhood,
          address: snap.form.address,
          items: snap.items,
          subtotal: snap.subtotal,
          total: snap.total,
          delivery: snap.delivery,
          familyMode: snap.familyMode,
          recipientName: snap.form.recipientName,
          recipientPhone: snap.form.recipientPhone,
          recipientAddress: snap.form.recipientAddress,
          giftMessage: snap.form.giftMessage,
          payMethod: snap.form.payMethod,
          momoNumber: snap.form.payMethod === 'momo' ? customerMomo : '',
          momoTelco: snap.form.payMethod === 'momo' ? telco : '',
          mapsPin: snap.form.mapsPin,
          location: snap.form.location || null,
          discountApplied: canUseDiscount,
          loyaltyUsed,
        }),
      });
      // Set up a recurring order if the user opted in (signed-in users only)
      if (autoReorder && currentUser && currentUser.id && currentUser.role !== 'guest') {
        try {
          const next = new Date(); next.setDate(next.getDate() + Number(reorderCadence || 14));
          await apiFetch('/api/me/recurring', {
            method: 'POST',
            body: JSON.stringify({
              items: snap.items,
              cadenceDays: Number(reorderCadence) || 14,
              nextRunAt: next.toISOString().slice(0, 10),
              deliveryInfo: {
                neighborhood: snap.neighborhood, address: snap.form.address,
                location: snap.form.location || null, payMethod: snap.form.payMethod,
              },
            }),
          });
        } catch (_) {}
      }

      // Refresh local user (clear consumed discount; sync new totalSpent)
      if (currentUser && currentUser.id && setCurrentUser) {
        try {
          const ures = await apiFetch('/api/auth/me');
          if (ures.ok) {
            const updated = await ures.json();
            setCurrentUser(prev => ({ ...prev, ...updated }));
          }
        } catch (_) {}
      }
    } catch (_) {
      // Proceed even if backend is unreachable
    }

    setOrderPlaced(true);
    setCart([]);
  };

  const inputStyle = (k) => ({
    width: '100%', padding: '11px 14px', borderRadius: 10,
    border: `1.5px solid ${errors[k] ? 'var(--accent-red)' : 'var(--cream-dark)'}`,
    background: 'var(--white)', fontSize: 14, outline: 'none', transition: 'border .15s',
  });

  // Stable handler that updates a field and clears its error in one go.
  const handleFieldChange = React.useCallback((k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  }, []);
  // Helper to keep call-site markup short. NOT a component — just builds props
  // for the hoisted CheckoutField (so React preserves DOM identity).
  const fieldProps = (k) => ({ k, value: form[k], error: errors[k], onChange: handleFieldChange });

  if (orderPlaced) {
    const normalizedWa = normalizeWaNumber(waNumber || form.phone);
    const waValid = normalizedWa.length >= 11; // e.g. 233 + 9 digits
    const waHref = waValid
      ? `https://wa.me/${normalizedWa}?text=${buildWhatsAppMsg()}`
      : '#';
    return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '40px 32px', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontSize: 56 }}>🎉</div>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginTop: 16 }}>Order Received!</h1>
        <div style={{ color: 'var(--warm-gray)', marginTop: 8, fontSize: 14, lineHeight: 1.55 }}>
          🛵 Your rider is lacing up the boots.<br/>
          <span style={{ fontSize: 12, opacity: .85 }}>Order <strong>{orderId}</strong> is confirmed.</span>
        </div>
        {(() => {
          const now = new Date();
          const afterCutoff = now.getHours() >= 12;
          const txt = afterCutoff
            ? '📅 Delivery: tomorrow from 12 PM (priority queue)'
            : '🛵 Delivery: today, starting from 12 PM';
          return (
            <div style={{ marginTop: 14, display: 'inline-block', background: 'var(--cream)', border: '1px solid var(--cream-dark)', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: 'var(--warm-black)' }}>
              {txt}
            </div>
          );
        })()}

        <div style={{ background: 'var(--cream)', borderRadius: 10, padding: '16px', marginTop: 22, textAlign: 'left' }}>
          <div style={{ fontSize: 12, color: 'var(--warm-gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            Send a copy of this order to your WhatsApp
          </div>
          <input
            type="tel"
            value={waNumber}
            onChange={e => setWaNumber(e.target.value)}
            placeholder={form.phone || 'e.g. 0504082555 or +233504082555'}
            style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', fontSize: 14, outline: 'none' }}
          />
          <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginTop: 6 }}>
            Defaults to the phone you entered at checkout. Ghana numbers (starting with 0) are accepted.
          </div>
        </div>

        <a href={waHref} target="_blank" rel="noopener noreferrer"
          onClick={e => { if (!waValid) { e.preventDefault(); alert('Please enter a valid WhatsApp number first.'); } }}
          style={{ display: 'block', marginTop: 16, background: waValid ? '#25D366' : '#888', color: '#fff', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 15, textDecoration: 'none', cursor: waValid ? 'pointer' : 'not-allowed' }}>
          📱 Send Order to My WhatsApp
        </a>
        {currentUser && currentUser.id && openTracking && (
          <button onClick={() => openTracking(orderId)}
            style={{ marginTop: 10, width: '100%', background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 14 }}>
            🛵 Track this order
          </button>
        )}
        <button onClick={() => setPage('home')}
          style={{ marginTop: 10, width: '100%', background: 'var(--cream)', color: 'var(--warm-black)', borderRadius: 10, padding: '12px', fontWeight: 600, fontSize: 14 }}>
          Continue Shopping
        </button>
      </div>
    </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '16px' : '28px 24px' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 32, background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '6px', boxShadow: 'var(--shadow)' }}>
        {[['1','Delivery Details'],['2','Review Order'],['3','Confirm & Pay']].map(([n, label], idx) => (
          <div key={n} style={{ flex: 1, textAlign: 'center', padding: '10px', borderRadius: 10, background: step === idx+1 ? 'var(--sage)' : 'transparent', color: step === idx+1 ? '#fff' : step > idx+1 ? 'var(--sage)' : 'var(--warm-gray)', transition: 'all .2s', cursor: step > idx+1 ? 'pointer' : 'default' }}
            onClick={() => { if (step > idx+1) setStep(idx+1); }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
            <div style={{ fontSize: 11, opacity: .75, marginTop: 2 }}>Step {n} of 3</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap: 24, alignItems: 'start' }}>
        {/* Main form */}
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px', boxShadow: 'var(--shadow)' }}>

          {step === 1 && (
            <>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 14 }}>Delivery Details</h2>

              {/* Delivery window notice — depends on time of day */}
              {(() => {
                const now = new Date();
                const afterCutoff = now.getHours() >= 12;
                if (afterCutoff) {
                  return (
                    <div style={{ background: '#FFF4E0', border: '1px solid #F0C674', borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>⏰</span>
                      <div style={{ fontSize: 13, lineHeight: 1.5, color: '#7A5A00' }}>
                        <div style={{ fontWeight: 700 }}>Order after the 12 PM cut-off</div>
                        Today's deliveries are already on the road. Your order will be delivered <strong>tomorrow from 12 PM</strong>, and we'll prioritise it ahead of new same-day orders.
                      </div>
                    </div>
                  );
                }
                return (
                  <div style={{ background: '#E8F4EC', border: '1px solid #B6D9C4', borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>🛵</span>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: '#1F5D3A' }}>
                      <div style={{ fontWeight: 700 }}>Same-day delivery</div>
                      Order before 12 PM and your delivery will be made today. Riders begin their routes at 12 PM.
                    </div>
                  </div>
                );
              })()}

              {/* First-order-free notice */}
              {isFirstOrderFree && (
                <div style={{ background: '#FFF8E1', border: '1px solid #F0DCA0', borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🎁</span>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: '#7A5A00' }}>
                    <div style={{ fontWeight: 700 }}>Welcome — your first delivery is FREE</div>
                    No delivery fee on this order. (Future orders are a flat GHS 10.)
                  </div>
                </div>
              )}

              {/* Saved-address quick picker */}
              {savedAddresses.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                    Deliver to one of your saved addresses
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {savedAddresses.map(a => {
                      const active = form.neighborhood === a.neighborhood && (a.location && form.location && Math.abs(a.location.lat - (form.location.lat || 0)) < 0.0005);
                      return (
                        <button key={a.id} type="button" onClick={() => applyAddress(a)}
                          style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 999, border: `1.5px solid ${active ? 'var(--sage)' : 'var(--cream-dark)'}`, background: active ? 'rgba(0,0,0,.04)' : 'var(--white)' }}>
                          {a.label}{a.isLastUsed ? ' (last used)' : ''}
                          <span style={{ color: 'var(--warm-gray)', fontWeight: 500, marginLeft: 6, fontSize: 11 }}>{a.neighborhood}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Family mode toggle */}
              <div style={{ marginBottom: 24, padding: '14px 18px', background: familyMode ? 'rgba(212,160,23,.12)' : 'var(--cream)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setFamilyMode(f => !f)}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 20 }}>🎁</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Family Mode — Ordering for Someone Else?</div>
                    <div style={{ fontSize: 12, color: 'var(--warm-gray)' }}>Send a gift with a custom message and GPS pin</div>
                  </div>
                </div>
                <div style={{ width: 44, height: 24, borderRadius: 12, background: familyMode ? 'var(--sage)' : 'var(--cream-dark)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2, left: familyMode ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <CheckoutField {...fieldProps('name')} label="Your Name" placeholder="Kwame Asante" />
                <CheckoutField {...fieldProps('phone')} label="Your Phone (MoMo)" placeholder="+233 50 123 4567" />
                <div style={{ flex: '1 1 100%' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Neighborhood</label>
                  <select value={form.neighborhood} onChange={e => { set('neighborhood', e.target.value); clearErr('neighborhood'); if (e.target.value !== '__other__') set('customNeighborhood', ''); }}
                    style={{ ...inputStyle('neighborhood'), appearance: 'none', cursor: 'pointer' }}>
                    <option value="">Select your neighborhood...</option>
                    {window.NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
                    <option value="__other__">Other (enter below)…</option>
                  </select>
                  {form.neighborhood === '__other__' && (
                    <input
                      autoFocus
                      placeholder="Type your area / suburb…"
                      value={form.customNeighborhood || ''}
                      onChange={e => { handleFieldChange('customNeighborhood', e.target.value); }}
                      style={{ ...inputStyle('customNeighborhood'), marginTop: 8 }}
                    />
                  )}
                  {errors.neighborhood && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 3 }}>{errors.neighborhood}</div>}
                </div>
                <CheckoutField {...fieldProps('address')} label="Street Address (Optional)" placeholder="House number and street" />
              </div>

              {/* Pin exact delivery spot on the map */}
              <div style={{ marginTop: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Pin your exact location <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>*</span>
                </label>
                <MapPicker
                  value={form.location || null}
                  onChange={(loc) => set('location', loc)}
                  height={260}
                />
              </div>

              {familyMode && (
                <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1.5px dashed var(--cream-dark)' }}>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🎁 Recipient Details</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    <CheckoutField {...fieldProps('recipientName')} label="Recipient Name" placeholder="Abena Mensah" />
                    <CheckoutField {...fieldProps('recipientPhone')} label="Recipient Phone" placeholder="+233 24 000 0000" />
                    <CheckoutField {...fieldProps('recipientAddress')} label="Recipient Address" placeholder="House number and street" />
                    <div style={{ flex: '1 1 100%' }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Google Maps Pin (Optional)</label>
                      <input value={form.mapsPin} onChange={e => set('mapsPin', e.target.value)}
                        placeholder="Paste Google Maps link here..."
                        style={inputStyle('mapsPin')}
                      />
                      <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginTop: 4 }}>Share the pin from Google Maps for precise delivery</div>
                    </div>
                    <div style={{ flex: '1 1 100%' }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Gift Message (Optional)</label>
                      <textarea value={form.giftMessage} onChange={e => set('giftMessage', e.target.value)}
                        placeholder="Write a personal message for the recipient..."
                        rows={3} style={{ ...inputStyle('giftMessage'), resize: 'vertical' }} />
                    </div>
                  </div>
                </div>
              )}

              <button onClick={() => { if (validate1()) setStep(2); }}
                style={{ marginTop: 28, width: '100%', background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 15 }}>
                Continue to Review →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Review Your Order</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cart.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: 'var(--cream)', borderRadius: 10 }}>
                    <span style={{ fontSize: 24 }}>{['🌾','🥛','🧴','🍚','🫙','🍪','🥫','🥤','🍫'][window.CATEGORIES.indexOf(item.category)] || '📦'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--warm-gray)' }}>{item.unit} × {item.qty}</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--sage-dark)' }}>GHS {(item.price * item.qty).toFixed(2)}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20, padding: '16px', background: 'var(--cream-dark)', borderRadius: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Delivering to</div>
                <div style={{ fontSize: 13, color: 'var(--warm-gray)' }}>
                  {familyMode ? form.recipientName : form.name} · {form.neighborhood}
                  {familyMode && form.giftMessage && <div style={{ marginTop: 6, fontStyle: 'italic' }}>"{form.giftMessage}"</div>}
                </div>
              </div>

              {/* Auto-reorder — signed-in users only */}
              {currentUser && currentUser.id && currentUser.role !== 'guest' && (
                <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--cream)', borderRadius: 10, border: '1px solid var(--cream-dark)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoReorder} onChange={e => setAutoReorder(e.target.checked)}
                      style={{ accentColor: 'var(--sage)', width: 18, height: 18 }} />
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>🔁 Auto-reorder these items</div>
                      <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>
                        We'll re-create this exact order every chosen interval. Pause or cancel any time from My Orders.
                      </div>
                    </span>
                  </label>
                  {autoReorder && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 28 }}>
                      <span style={{ fontSize: 13, color: 'var(--warm-gray)' }}>Every</span>
                      <select value={reorderCadence} onChange={e => setReorderCadence(Number(e.target.value))}
                        style={{ padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--cream-dark)', fontSize: 13, background: 'var(--white)' }}>
                        <option value={7}>7 days (weekly)</option>
                        <option value={14}>14 days (fortnightly)</option>
                        <option value={30}>30 days (monthly)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, background: 'var(--cream)', color: 'var(--warm-gray)', borderRadius: 10, padding: '12px', fontWeight: 600, fontSize: 14 }}>← Back</button>
                <button onClick={() => setStep(3)} style={{ flex: 2, background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 15 }}>Confirm Order →</button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Confirm & Pay</h2>

              {/* Payment method */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Payment Method</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[['momo','📱 Mobile Money'],['cash','💵 Cash on Delivery']].map(([val, label]) => (
                    <button key={val} onClick={() => set('payMethod', val)}
                      style={{ flex: 1, padding: '14px 10px', borderRadius: 10, border: `2px solid ${form.payMethod === val ? 'var(--sage)' : 'var(--cream-dark)'}`, background: form.payMethod === val ? 'rgba(0,0,0,.06)' : 'var(--white)', fontWeight: 700, fontSize: 13, transition: 'all .15s', color: 'var(--warm-black)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* MoMo telco picker — only shown when MoMo selected */}
              {form.payMethod === 'momo' && (
                <div style={{ marginBottom: 24, padding: '16px', background: 'var(--cream)', borderRadius: 12, border: '1px solid var(--cream-dark)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Choose your network</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {[
                      ['mtn',     'MTN MoMo',     '#FFCC08', '#000'],
                      ['telecel', 'Telecel Cash', '#E60012', '#fff'],
                      ['at',      'AT Money',     '#1A1A1A', '#fff'],
                    ].map(([key, label, bg, fg]) => {
                      const active = telco === key;
                      return (
                        <button key={key} onClick={() => setTelco(key)}
                          style={{
                            flex: 1, padding: '12px 6px', borderRadius: 10,
                            border: active ? `2.5px solid ${bg}` : '2px solid var(--cream-dark)',
                            background: active ? bg : 'var(--white)',
                            color: active ? fg : 'var(--warm-black)',
                            fontWeight: 700, fontSize: 12, transition: 'all .15s',
                          }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Customer's MoMo number */}
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 6 }}>
                    Your {telco === 'mtn' ? 'MTN' : telco === 'telecel' ? 'Telecel' : 'AT'} number
                  </label>
                  <input value={customerMomo} onChange={e => setCustomerMomo(e.target.value)}
                    placeholder="e.g. 024 123 4567" type="tel" inputMode="tel"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid var(--cream-dark)', fontSize: 14, outline: 'none', background: 'var(--white)', marginBottom: 14 }} />

                  {/* Merchant payout details */}
                  {merchantNumbers[telco] ? (
                    <div style={{ background: 'var(--white)', borderRadius: 10, padding: '14px 16px', border: '1.5px dashed var(--sage)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warm-gray)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Send GHS {total.toFixed(2)} to</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: 'var(--sage-dark)', letterSpacing: '.04em' }}>
                            {merchantNumbers[telco]}
                          </div>
                          {merchantNumbers.name && (
                            <div style={{ fontSize: 12, color: 'var(--warm-gray)', marginTop: 2 }}>Account name: <strong>{merchantNumbers.name}</strong></div>
                          )}
                        </div>
                        <button onClick={copyMerchant} type="button"
                          style={{ background: 'var(--sage)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 12 }}>
                          {copyState || '📋 Copy'}
                        </button>
                      </div>
                      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--warm-gray)', lineHeight: 1.55 }}>
                        Dial <strong style={{ color: 'var(--warm-black)' }}>
                          {telco === 'mtn' ? '*170#' : telco === 'telecel' ? '*110#' : '*100#'}
                        </strong> on the number above → choose <em>Transfer Money</em> → MoMo to MoMo → paste the number above → enter <strong>GHS {total.toFixed(2)}</strong> → confirm with your PIN.
                      </div>
                      <a href={`tel:${telco === 'mtn' ? '*170' : telco === 'telecel' ? '*110' : '*100'}%23`}
                        style={{ marginTop: 10, display: 'inline-block', fontSize: 12, fontWeight: 700, color: 'var(--sage-dark)' }}>
                        📞 Open dialer with {telco === 'mtn' ? '*170#' : telco === 'telecel' ? '*110#' : '*100#'}
                      </a>
                    </div>
                  ) : (
                    <div style={{ background: '#FFF4E0', border: '1px solid #F0C674', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#7A5A00' }}>
                      ⚠ The shop hasn't configured a {telco === 'mtn' ? 'MTN' : telco === 'telecel' ? 'Telecel' : 'AT'} number yet. Please pick another network, or choose Cash on Delivery.
                    </div>
                  )}
                </div>
              )}

              {/* Download receipt checkbox */}
              <label style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 16px', background: 'var(--cream)', borderRadius: 10, cursor: 'pointer', marginBottom: 24 }}>
                <input type="checkbox" checked={downloadReceipt} onChange={e => setDownloadReceipt(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--sage)', cursor: 'pointer' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Download Receipt</div>
                  <div style={{ fontSize: 12, color: 'var(--warm-gray)' }}>Get a text receipt of your order</div>
                </div>
              </label>

              {/* WhatsApp preview */}
              <div style={{ background: '#DCF8C6', borderRadius: 12, padding: '16px', marginBottom: 24, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--warm-gray)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>WhatsApp Message Preview</div>
                <strong>ORDER #{orderId}</strong><br/>
                Items: {cart.slice(0,3).map(i=>`${i.name} x${i.qty}`).join(', ')}{cart.length > 3 ? '...' : ''}<br/>
                Total: GHS {total.toFixed(2)}<br/>
                Neighborhood: {form.neighborhood || '[neighborhood]'}<br/>
                Recipient: {familyMode ? (form.recipientName || '[name]') : (form.name || '[name]')} / {familyMode ? (form.recipientPhone || '[phone]') : (form.phone || '[phone]')}<br/>
                Location: {form.mapsPin || form.address || form.neighborhood || '[location]'}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(2)} style={{ flex: 1, background: 'var(--cream)', color: 'var(--warm-gray)', borderRadius: 10, padding: '12px', fontWeight: 600, fontSize: 14 }}>← Back</button>
                <button onClick={() => { setWaNumber(form.phone || ''); placeOrder(); }} style={{ flex: 2, background: 'var(--sage)', color: '#fff', borderRadius: 10, padding: '14px', fontWeight: 700, fontSize: 15 }}>
                  Place Order →
                </button>
              </div>
            </>
          )}
        </div>

        {/* Order summary sidebar */}
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '24px', boxShadow: 'var(--shadow)', position: isMobile ? 'static' : 'sticky', top: 120 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Order Summary</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {cart.map(i => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--warm-gray)' }}>{i.name} <span style={{ fontWeight: 700 }}>×{i.qty}</span></span>
                <span style={{ fontWeight: 600 }}>GHS {(i.price * i.qty).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1.5px solid var(--cream-dark)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: 'var(--warm-gray)' }}>Subtotal</span>
              <span>GHS {subtotal.toFixed(2)}</span>
            </div>
            {canUseDiscount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--sage)' }}>
                <span>🎉 Squad Discount (5%)</span>
                <span>−GHS {discount.toFixed(2)}</span>
              </div>
            )}
            {loyaltyAvailable > 0 && (
              <div style={{ background: '#FFF8E1', border: '1px solid #F0DCA0', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={useLoyalty} onChange={e => setUseLoyalty(e.target.checked)} style={{ accentColor: 'var(--sage)' }} />
                  <span style={{ flex: 1 }}>
                    <strong>⭐ Loyalty credit:</strong> GHS {loyaltyAvailable.toFixed(2)} available
                    {useLoyalty && loyaltyUsed > 0 && <span style={{ color: 'var(--sage)' }}> — using GHS {loyaltyUsed.toFixed(2)}</span>}
                  </span>
                </label>
              </div>
            )}
            {useLoyalty && loyaltyUsed > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#7A5A00' }}>
                <span>⭐ Loyalty credit</span>
                <span>−GHS {loyaltyUsed.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: 'var(--warm-gray)' }}>Delivery</span>
              <span style={{ color: delivery === 0 ? 'var(--sage)' : 'inherit', fontWeight: delivery === 0 ? 700 : 400 }}>
                {delivery === 0
                  ? (isFirstOrderFree ? '🎁 FIRST ORDER FREE' : (qualifiesFreeByThreshold ? 'FREE 🎉' : 'FREE'))
                  : `GHS ${delivery.toFixed(2)}`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
              <span>Total</span>
              <span style={{ color: 'var(--sage-dark)' }}>GHS {total.toFixed(2)}</span>
            </div>
          </div>
          {afterLoyalty < FREE_DELIVERY_MIN && !isFirstOrderFree && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(0,0,0,.06)', borderRadius: 8, fontSize: 12, color: 'var(--sage-dark)', fontWeight: 600 }}>
              Add <strong>GHS {(FREE_DELIVERY_MIN - afterLoyalty).toFixed(2)}</strong> more for free delivery 🚚
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { CheckoutPage });
