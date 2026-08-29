// CheckoutPage — full checkout with Family Mode + WhatsApp bridge
// GHS 10 delivery for orders under FREE_DELIVERY_MIN, free above it.
const STANDARD_DELIVERY = 10;
const FREE_DELIVERY_MIN = 150;
// Signed-in users also get their first ever order delivered free — but only
// when that order is at least FIRST_ORDER_FREE_MIN (GHS). Mirrors server.js.
const FIRST_ORDER_FREE = true;
const FIRST_ORDER_FREE_MIN = 50;

// Fire a GA4 `purchase` event (order value + line items) so Google
// Analytics/Ads can track completed orders as revenue-bearing conversions —
// more accurate than the /order-confirmed page view alone. gtag is defined in
// SDGMart.html; guarded so checkout still works if analytics is absent/blocked.
// transaction_id = the SDG order code, which keeps each order counted once.
const trackPurchase = (snap, code) => {
  try {
    if (!window.gtag || !snap) return;
    window.gtag('event', 'purchase', {
      transaction_id: String(code || ''),
      value: Number(snap.total || 0),
      currency: 'GHS',
      shipping: Number(snap.delivery || 0),
      items: (snap.items || []).map((it) => ({
        item_id: String(it.id),
        item_name: it.name,
        item_category: it.category,
        price: Number(it.price || 0),
        quantity: Number(it.qty || 1),
      })),
    });
  } catch (_) {}
};

// Hoisted out of CheckoutPage so React doesn't recreate the component on
// every render (which would unmount the input and steal focus on each
// keystroke).
const CheckoutField = ({ label, k, type='text', placeholder='', half, value, error, onChange }) => (
  <div style={{ flex: half ? '1 1 45%' : '1 1 100%', minWidth: 0 }}>
    <label style={{ display: 'block', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, color: 'var(--rd-muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>{label}</label>
    <input
      type={type}
      value={value || ''}
      placeholder={placeholder}
      onChange={e => onChange(k, e.target.value)}
      style={{
        width: '100%', padding: '11px 14px', borderRadius: 0,
        border: `1px solid ${error ? 'var(--accent)' : 'var(--border-input)'}`,
        background: '#fff', fontFamily: 'var(--f-ui)', fontSize: 14, color: 'var(--ink)', outline: 'none', transition: 'border .15s',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--ink)'}
      onBlur={e => e.target.style.borderColor = error ? 'var(--accent)' : 'var(--border-input)'}
    />
    {error && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>{error}</div>}
  </div>
);

const CheckoutPage = ({ cart, setCart, setPage, currentUser, setCurrentUser, openTracking, onOrderPlaced }) => {
  const [step, setStep] = React.useState(1); // 1=details, 2=review, 3=confirm
  const isMobile = useMobile();
  const [familyMode, setFamilyMode] = React.useState(false);
  const [downloadReceipt, setDownloadReceipt] = React.useState(false);
  // Recurring orders: opt-in checkbox + cadence (every N days)
  const [autoReorder, setAutoReorder] = React.useState(false);
  const [reorderCadence, setReorderCadence] = React.useState(14);
  // Scheduled delivery: ASAP (default) or a future date + time slot
  const [scheduleLater, setScheduleLater] = React.useState(false);
  const [scheduledDate, setScheduledDate] = React.useState('');
  const [scheduledSlot, setScheduledSlot] = React.useState('');
  const [slots, setSlots] = React.useState([]);
  // Birthday free gift (eligible only during the user's birth month)
  const [bdayGifts, setBdayGifts] = React.useState({ eligible: false, products: [] });
  const [chosenGift, setChosenGift] = React.useState(null);
  // Saved-address book for one-tap checkout. When a default/last-used address
  // auto-fills, step 1 collapses to just name + phone + an "using your saved
  // address" note (appliedAddress) — the full fields return via "Change".
  const [savedAddresses, setSavedAddresses] = React.useState([]);
  const [appliedAddress, setAppliedAddress] = React.useState(null);
  const [editingAddress, setEditingAddress] = React.useState(false);
  // Family Mode keeps the compact saved-address card too: the user's own
  // details stay pre-filled and we only ADD the recipient section below.
  // Delivery still defaults to the saved address; "Change / add details"
  // reveals the full form when the gift goes to a different location.
  const compactAddress = !!(appliedAddress && !editingAddress);
  React.useEffect(() => {
    if (!currentUser || !currentUser.id || currentUser.role === 'guest') return;
    apiFetch('/api/me/addresses').then(r => r.ok ? r.json() : []).then(list => {
      setSavedAddresses(list || []);
      // Auto-pre-select last-used or default address
      const preferred = list.find(a => a.isDefault) || list.find(a => a.isLastUsed);
      if (preferred && !form.neighborhood) {
        setForm(f => ({
          ...f,
          neighborhood: preferred.neighborhood || f.neighborhood,
          address: preferred.address || f.address,
          location: preferred.location || f.location,
        }));
        setAppliedAddress(preferred);
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
    setAppliedAddress(a);
  };
  // Map is optional — collapsed by default so Leaflet isn't loaded for everyone.
  const [mapOpen, setMapOpen] = React.useState(false);
  // Online payment (Paystack) availability + in-flight state
  const [paystackEnabled, setPaystackEnabled] = React.useState(false);
  const [paying, setPaying] = React.useState(false);
  // Duplicate-order protection (server pairs this with orders.client_request_id).
  // Deliberately stable across retries of the same attempt, so tapping again
  // after a dropped connection returns the original order rather than a second
  // one. Regenerated only once an order actually succeeds.
  const newRequestId = () => 'cr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  const requestIdRef = React.useRef(newRequestId());
  // Credit this order will earn once delivered. 0 for most baskets — the tier
  // only crosses every GHS 1,000 — so the line is shown only when non-zero.
  const [loyaltyPending, setLoyaltyPending] = React.useState(0);
  // null | 'network' | 'server' — drives the retry panel above the buttons.
  const [submitError, setSubmitError] = React.useState(null);

  // Whether the payment options are known, or merely absent because the
  // request failed. Without this the two are indistinguishable on screen.
  const [payConfigFailed, setPayConfigFailed] = React.useState(false);
  const loadPaystackConfig = React.useCallback(async () => {
    try {
      const r = await fetch('/api/paystack/config');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const cfg = await r.json();
      setPayConfigFailed(false);
      if (cfg && cfg.enabled) { setPaystackEnabled(true); setForm(f => ({ ...f, payMethod: 'paystack' })); }
    } catch (e) {
      setPayConfigFailed(true);
      reportClientError('checkout: payment config failed', e);
    }
  }, []);
  React.useEffect(() => { loadPaystackConfig(); }, [loadPaystackConfig]);

  React.useEffect(() => {
    // A missing slot list degrades to the default slot, which is honest — but
    // it should still be visible in the error log rather than nowhere.
    fetch('/api/delivery/slots').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(d => { if (Array.isArray(d.slots)) setSlots(d.slots); })
      .catch(e => reportClientError('checkout: delivery slots failed', e));
  }, []);

  React.useEffect(() => {
    if (!currentUser || !currentUser.id || currentUser.role === 'guest') return;
    apiFetch('/api/birthday/gifts').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(d => { if (d && d.eligible) setBdayGifts({ eligible: true, products: d.products || [] }); })
      .catch(e => reportClientError('checkout: birthday gifts failed', e));
  }, []);

  const [form, setForm] = React.useState({
    name: (currentUser && currentUser.name && currentUser.role !== 'guest') ? currentUser.name : '',
    phone: (currentUser && currentUser.phone) || '',
    neighborhood: '', customNeighborhood: '', address: '',
    recipientName: '', recipientPhone: '', recipientAddress: '', mapsPin: '',
    giftMessage: '', payMethod: 'cash',
  });
  const [errors, setErrors] = React.useState({});
  const [orderPlaced, setOrderPlaced] = React.useState(false);
  // Signed track token for the placed order — powers the shareable/storable
  // tracking code on the success screen (works on any device).
  const [placedTrackToken, setPlacedTrackToken] = React.useState(null);
  const [codeCopied, setCodeCopied] = React.useState(false);
  // orderId is a placeholder code for the pre-placement preview; after the
  // order is created it's replaced with the real SDG-<id> code. placedOrderId
  // holds the numeric DB id used for tracking.
  const [orderId, setOrderId] = React.useState(() => 'SDG-' + Math.random().toString(36).substring(2,8).toUpperCase());
  const [placedOrderId, setPlacedOrderId] = React.useState(null);
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
  const isFirstOrderEligible = FIRST_ORDER_FREE
    && currentUser && currentUser.id && currentUser.role !== 'guest'
    && currentUser.firstOrderDone === false;
  // afterLoyalty is the customer's effective subtotal (post-squad, post-loyalty)
  const isFirstOrderFree = isFirstOrderEligible && afterLoyalty >= FIRST_ORDER_FREE_MIN;
  const qualifiesFreeByThreshold = afterLoyalty >= FREE_DELIVERY_MIN;
  const delivery = (isFirstOrderFree || qualifiesFreeByThreshold) ? 0 : STANDARD_DELIVERY;
  const total = afterLoyalty + delivery;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const err = (k, msg) => setErrors(e => ({ ...e, [k]: msg }));
  const clearErr = (k) => setErrors(e => { const n = {...e}; delete n[k]; return n; });

  // Scheduled-delivery date bounds: tomorrow … +7 days
  const _pad = (n) => String(n).padStart(2, '0');
  const _ymd = (d) => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
  const minSchedDate = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return _ymd(d); })();
  const maxSchedDate = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return _ymd(d); })();

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
    // Need EITHER a typed address/landmark OR a pinned map location — not both.
    const hasPin = !!(form.location && typeof form.location.lat === 'number');
    if (!form.address.trim() && !hasPin) { err('address','Add a landmark OR pin your location on the map'); ok=false; }
    if (familyMode) {
      if (!form.recipientName.trim()) { err('recipientName','Required'); ok=false; }
      if (!form.recipientPhone.trim()) { err('recipientPhone','Required'); ok=false; }
    }
    if (scheduleLater) {
      if (!scheduledDate) { err('scheduledDate', 'Pick a date'); ok = false; }
      if (!scheduledSlot) { err('scheduledSlot', 'Pick a time slot'); ok = false; }
    }
    return ok;
  };

  // Convert "+233 59 918 9773" or "0599189773" → "233599189773" (wa.me format)
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
    lines.push(`Payment: ${snap.form.payMethod === 'cash' ? 'Cash on Delivery' : 'Paid online (Card / MoMo)'}`);
    if (snap.familyMode && snap.form.giftMessage) lines.push(`Gift Message: ${snap.form.giftMessage}`);
    return lines.join('\n');
  };

  const buildWhatsAppMsg = () => encodeURIComponent(buildReceiptText(orderSnapshot));

  // Map a checkout snapshot to the normalized shape the PDF generator wants.
  const snapToReceipt = (snap, code) => {
    const s = snap || orderSnapshot;
    if (!s) return null;
    return {
      orderId: code || orderId,
      date: new Date().toLocaleDateString('en-GB'),
      items: s.items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal: s.subtotal,
      discount: s.discount,
      loyaltyUsed: s.loyaltyUsed || 0,
      delivery: s.delivery,
      total: s.total,
      neighborhood: s.neighborhood,
      recipient: s.familyMode ? s.form.recipientName : s.form.name,
      phone: s.familyMode ? s.form.recipientPhone : s.form.phone,
      location: s.form.mapsPin || s.form.address || '',
      payMethod: s.form.payMethod,
      giftMessage: s.familyMode ? s.form.giftMessage : '',
    };
  };

  const generateReceipt = (snap, code) => {
    const data = snapToReceipt(snap, code);
    if (data && window.generateReceiptPDF) {
      window.generateReceiptPDF(data);
      return;
    }
    // Fallback to plain text if jsPDF somehow didn't load
    const text = buildReceiptText(snap || orderSnapshot).replace(/\*/g, '');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SDGMart-${orderId}.txt`;
    a.click();
  };

  // Snapshot the cart + form before we clear it (used by success screen + receipts).
  const takeSnapshot = () => {
    const snap = {
      items: cart.map(i => ({ ...i })),
      subtotal, discount, delivery, total,
      neighborhood: effectiveNeighborhood,
      familyMode,
      form: { ...form, neighborhood: effectiveNeighborhood },
    };
    setOrderSnapshot(snap);
    return snap;
  };

  // The order payload sent to the server (same shape for COD + Paystack).
  const buildDraft = (snap) => ({
    id: orderId,
    clientRequestId: requestIdRef.current,
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
    mapsPin: snap.form.mapsPin,
    location: snap.form.location || null,
    deliveryDate: scheduleLater && scheduledDate ? scheduledDate : null,
    deliverySlot: scheduleLater && scheduledSlot ? scheduledSlot : null,
    birthdayGift: chosenGift || null,
    discountApplied: canUseDiscount,
    loyaltyUsed,
  });

  // After an order is created (paid or COD): set up recurring, refresh the
  // user, show the success screen, clear the cart. `serverId` is the real DB
  // order id used for the display code + tracking.
  const finishOrder = async (snap, serverId, trackToken, pendingCredit, serverPricing) => {
    setLoyaltyPending(Number(pendingCredit || 0));
    // The server is the only authority on what was charged. The client computes
    // its own preview with different rounding — it rounds nothing, while the
    // server rounds each discounted unit price before multiplying — so the two
    // can disagree by a few pesewas per line (B-05). Everything below (success
    // screen, PDF receipt, WhatsApp message, GA4 revenue) used the client copy,
    // which meant a customer's receipt could state a different amount from the
    // order in your database. Overwrite the snapshot with the real figures.
    if (serverPricing && serverPricing.total != null) {
      snap = { ...snap, total: Number(serverPricing.total) };
      if (serverPricing.subtotal != null) snap.subtotal = Number(serverPricing.subtotal);
      if (serverPricing.delivery != null) snap.delivery = Number(serverPricing.delivery);
      if (serverPricing.discount != null) snap.discount = Number(serverPricing.discount);
      if (serverPricing.loyaltyUsed != null) snap.loyaltyUsed = Number(serverPricing.loyaltyUsed);
      setOrderSnapshot(snap);
    }
    const code = serverId != null ? window.orderCode(serverId) : orderId;
    if (serverId != null) { setPlacedOrderId(serverId); setOrderId(code); }
    if (trackToken) setPlacedTrackToken(trackToken);
    // Guests have no My Orders — remember this order locally (with its signed
    // track token) so they can still follow it after closing the app.
    const isGuest = !currentUser || !currentUser.id || currentUser.role === 'guest';
    if (isGuest && serverId != null && trackToken) {
      try {
        const list = JSON.parse(localStorage.getItem('sdgmart_guest_orders') || '[]');
        list.unshift({ id: serverId, code, token: trackToken, total: snap.total, at: new Date().toISOString() });
        localStorage.setItem('sdgmart_guest_orders', JSON.stringify(list.slice(0, 10)));
      } catch (_) {}
    }
    if (downloadReceipt) generateReceipt(snap, code);
    if (autoReorder && currentUser && currentUser.id && currentUser.role !== 'guest') {
      try {
        const next = new Date(); next.setDate(next.getDate() + Number(reorderCadence || 14));
        await apiFetch('/api/me/recurring', {
          method: 'POST',
          body: JSON.stringify({
            items: snap.items, cadenceDays: Number(reorderCadence) || 14,
            nextRunAt: next.toISOString().slice(0, 10),
            deliveryInfo: { neighborhood: snap.neighborhood, address: snap.form.address, location: snap.form.location || null, payMethod: snap.form.payMethod },
          }),
        });
      } catch (_) {}
    }
    if (currentUser && currentUser.id && setCurrentUser) {
      try {
        const ures = await apiFetch('/api/auth/me');
        if (ures.ok) { const updated = await ures.json(); setCurrentUser(prev => ({ ...prev, ...updated })); }
      } catch (_) {}
    }
    setOrderPlaced(true);
    setCart([]);
    requestIdRef.current = newRequestId();   // next checkout is a new attempt
    // Switch the URL to /order-confirmed + fire the Analytics conversion view,
    // then the GA4 purchase event (value + items) on the confirmation page.
    try { if (onOrderPlaced) onOrderPlaced(); } catch (_) {}
    trackPurchase(snap, code);
  };

  // Cash on Delivery — create the order directly.
  // The success screen is shown ONLY when the server confirms it saved the
  // order and returns a real id. finishOrder() clears the cart and issues the
  // tracking code, so reaching it after a failure would tell the customer their
  // order is placed when it does not exist.
  const placeOrder = async () => {
    if (paying) return;               // double-tap guard: one order per intent
    // Fail fast rather than sending into a void: without this the request goes
    // out, fails, and the customer waits through the whole timeout first.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSubmitError('network');
      return;
    }
    setSubmitError(null);
    setPaying(true);
    const snap = takeSnapshot();
    try {
      const r = await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(buildDraft(snap)) });
      // fetch does NOT reject on 4xx/5xx — an error status arrives as a normal
      // response, so it must be checked explicitly or it slips straight past.
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // A 4xx is a decision about this basket (sold out, empty, paused) and
        // the server's wording is more useful than anything generic.
        const err = new Error(d.error || 'server');
        err.kind = (r.status >= 400 && r.status < 500) ? 'rejected' : 'server';
        err.unavailable = d.unavailable || [];
        throw err;
      }
      if (!d || d.id == null) throw new Error('server');
      await finishOrder(snap, d.id, d.trackToken || null, d.loyaltyPending, d);
      // paying stays true — the success screen replaces this view.
    } catch (e) {
      // Cart is deliberately left intact so retrying is a single tap.
      setSubmitError(e && e.kind === 'rejected'
        ? { kind: 'rejected', message: e.message, unavailable: e.unavailable || [] }
        : (e && e.message === 'server' ? 'server' : 'network'));
      setPaying(false);
    }
  };

  // Load the Paystack inline popup script on demand.
  const loadPaystack = () => new Promise((resolve, reject) => {
    if (window.PaystackPop) return resolve();
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v2/inline.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load payment popup'));
    document.head.appendChild(s);
  });

  // Pay online (card / mobile money) via Paystack, then create the order.
  const payWithPaystack = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSubmitError('network');
      return;
    }
    const snap = takeSnapshot();
    const draft = buildDraft(snap);
    setPaying(true);
    try {
      const initRes = await apiFetch('/api/paystack/init', {
        method: 'POST',
        body: JSON.stringify({ email: (currentUser && currentUser.email) || '', amount: snap.total, draft }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) { alert(initData.error || 'Could not start payment'); setPaying(false); return; }
      await loadPaystack();
      const popup = new window.PaystackPop();
      popup.resumeTransaction(initData.accessCode, {
        onSuccess: async () => {
          try {
            const vr = await apiFetch('/api/paystack/verify', { method: 'POST', body: JSON.stringify({ reference: initData.reference, draft }) });
            const vd = await vr.json();
            if (!vr.ok) { alert(vd.error || 'We could not confirm your payment. If you were charged, contact us on WhatsApp.'); setPaying(false); return; }
            await finishOrder(snap, vd && vd.id != null ? vd.id : null, (vd && vd.trackToken) || null, vd && vd.loyaltyPending, vd);
          } catch (_) { alert('Payment confirmed but the order could not be saved — please contact us on WhatsApp.'); }
          finally { setPaying(false); }
        },
        onCancel: () => { setPaying(false); },
        onError: () => { alert('Payment error — please try again.'); setPaying(false); },
      });
    } catch (e) {
      alert('Could not open the payment window. Check your connection and try again.');
      setPaying(false);
    }
  };

  const inputStyle = (k) => ({
    width: '100%', padding: '11px 14px', borderRadius: 0,
    border: `1px solid ${errors[k] ? 'var(--accent)' : 'var(--border-input)'}`,
    background: '#fff', fontFamily: 'var(--f-ui)', fontSize: 14, color: 'var(--ink)', outline: 'none', transition: 'border .15s',
  });
  // Design-refresh style helpers (checkout-local)
  const ckLbl = { display: 'block', fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, color: 'var(--rd-muted)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 };
  const ckNotice = (accent) => ({ border: '1px solid var(--rule-2)', borderLeft: `2px solid ${accent}`, background: 'var(--surface-warm)', padding: '13px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 3 });
  const ckPrimary = { width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', padding: '15px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 };
  const ckLabelBtn = { fontFamily: 'var(--f-label)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' };
  const ckEyebrow = { fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent)' };

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
    // Portable tracking code (order code + signed token): works on any device
    // via the Track Your Order page, and as a direct link.
    const trackingCode = placedTrackToken && placedOrderId != null ? `${orderId}-${placedTrackToken}` : null;
    const trackingUrl = trackingCode ? `${window.location.origin}/?track=${placedOrderId}&t=${placedTrackToken}` : null;
    const waHref = waValid
      ? `https://wa.me/${normalizedWa}?text=${buildWhatsAppMsg()}${trackingCode ? encodeURIComponent(`\n\nTracking code (keep this to track on any device): ${trackingCode}\nTrack live: ${trackingUrl}`) : ''}`
      : '#';
    const copyTrackingCode = async () => {
      try { await navigator.clipboard.writeText(`${trackingCode} — track live: ${trackingUrl}`); }
      catch (_) { window.prompt('Copy your tracking code:', trackingCode); }
      setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
    };
    return (
    <div className="rd-gutter" style={{ maxWidth: 640, margin: '48px auto 64px', fontFamily: 'var(--f-ui)', color: 'var(--ink)' }}>
      <div style={{ borderTop: '2px solid var(--ink)', paddingTop: 22 }}>
        <div style={ckEyebrow}>Order {orderId} confirmed</div>
        <h1 style={{ margin: '12px 0 2px', fontFamily: 'var(--f-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-.03em' }}>Order received.</h1>
        <div style={{ fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 24, color: 'var(--rd-body)' }}>Your rider is lacing up the boots.</div>
        {(() => {
          const now = new Date();
          const afterCutoff = now.getHours() >= 12;
          const txt = (scheduleLater && scheduledDate)
            ? `Scheduled: ${scheduledDate}${scheduledSlot ? ` · ${scheduledSlot}` : ''}`
            : (afterCutoff
              ? 'Delivery: tomorrow from 12 PM (priority queue)'
              : 'Delivery: today, starting from 12 PM');
          return (
            <div style={{ marginTop: 20, display: 'inline-block', border: '1px solid var(--border-input)', padding: '9px 16px', fontFamily: 'var(--f-mono)', fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink)' }}>
              {txt}
            </div>
          );
        })()}

        {loyaltyPending > 0 && (
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)', padding: '13px 16px', textAlign: 'left' }}>
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 700, letterSpacing: '-.02em' }}>
              GHS {Number(loyaltyPending).toFixed(2)}
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--rd-body)', lineHeight: 1.5 }}>
              in credit lands in your account once this order is delivered.
            </span>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {window.NotifyOptIn && <window.NotifyOptIn label="Get notified the moment your rider sets off" />}
        </div>

        {trackingCode && (
          <div style={{ border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)', padding: '16px 18px', marginTop: 24, textAlign: 'left' }}>
            <div style={ckEyebrow}>Your tracking code — save it</div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 500, background: '#fff', border: '1px solid var(--border-input)', padding: '11px 12px', marginTop: 10, wordBreak: 'break-all' }}>{trackingCode}</div>
            <div style={{ fontSize: 12, color: 'var(--rd-body)', marginTop: 8, lineHeight: 1.5 }}>Enter this on the <strong style={{ color: 'var(--ink)' }}>Track Order</strong> page from any device to follow your delivery. It stops working 7 days after delivery.</div>
            <button onClick={copyTrackingCode} style={{ ...ckLabelBtn, marginTop: 12, width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', padding: '11px', fontSize: 12.5 }}>{codeCopied ? 'Copied ✓' : 'Copy tracking code'}</button>
          </div>
        )}

        <div style={{ border: '1px solid var(--rule-2)', padding: '16px 18px', marginTop: 16, textAlign: 'left' }}>
          <div style={ckLbl}>Send a copy (incl. tracking code) to your WhatsApp</div>
          <input
            type="tel"
            value={waNumber}
            onChange={e => setWaNumber(e.target.value)}
            placeholder={form.phone || 'e.g. 0599189773 or +233599189773'}
            style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--border-input)', borderRadius: 0, background: '#fff', fontFamily: 'var(--f-ui)', fontSize: 14, color: 'var(--ink)', outline: 'none' }}
          />
          <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginTop: 6 }}>
            Defaults to the phone you entered at checkout. Ghana numbers (starting with 0) are accepted.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)', marginTop: 16 }}>
          {(() => {
            const cell = { ...ckLabelBtn, border: 'none', padding: '15px', fontSize: 12, textAlign: 'center', textDecoration: 'none', display: 'block' };
            return (<>
              <a href={waHref} target="_blank" rel="noopener noreferrer"
                onClick={e => { if (!waValid) { e.preventDefault(); alert('Please enter a valid WhatsApp number first.'); } }}
                style={{ ...cell, background: waValid ? 'var(--wa)' : '#9a9a94', color: '#fff', cursor: waValid ? 'pointer' : 'not-allowed' }}>Send order to my WhatsApp</a>
              {openTracking && placedOrderId != null && (
                <button onClick={() => openTracking(placedOrderId)} style={{ ...cell, background: 'var(--ink)', color: '#fff' }}>Track this order</button>
              )}
              <button onClick={() => generateReceipt(orderSnapshot, orderId)} style={{ ...cell, background: '#fff', color: 'var(--ink)' }}>Download PDF receipt</button>
              <button onClick={() => setPage('home')} style={{ ...cell, background: '#fff', color: 'var(--rd-muted)' }}>Continue shopping</button>
            </>);
          })()}
        </div>
      </div>
    </div>
    );
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: isMobile ? '20px 16px' : '34px 24px', fontFamily: 'var(--f-ui)', color: 'var(--ink)', background: 'var(--panel)' }}>
      {/* Step indicator */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)', marginBottom: 32 }}>
        {[['1','Delivery Details'],['2','Review Order'],['3','Confirm & Pay']].map(([n, label], idx) => {
          const active = step === idx + 1, done = step > idx + 1;
          return (
            <div key={n} onClick={() => { if (done) setStep(idx + 1); }}
              style={{ background: active ? 'var(--ink)' : '#fff', padding: isMobile ? '12px 12px' : '16px 22px', display: 'flex', flexDirection: 'column', gap: 3, cursor: done ? 'pointer' : 'default' }}>
              <span style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: active ? 'var(--accent-amber)' : (done ? 'var(--accent)' : 'var(--rd-faint)') }}>Step {n} of 3</span>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: active ? '#fff' : (done ? 'var(--ink)' : 'var(--rd-faint)') }}>{label}</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 380px', gap: 24, alignItems: 'start' }}>
        {/* Main form */}
        <div style={{ border: '1px solid var(--rule-2)', background: '#fff', padding: isMobile ? '20px' : '28px' }}>

          {step === 1 && (
            <>
              <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 16 }}>Delivery Details</h2>

              {bdayGifts.eligible && bdayGifts.products.length > 0 && (
                <div style={{ marginBottom: 20, padding: '16px 18px', border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)' }}>
                  <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 16 }}>Happy Birthday{currentUser && currentUser.name ? `, ${String(currentUser.name).split(' ')[0]}` : ''}</div>
                  <div style={{ fontSize: 13, color: 'var(--rd-body)', marginTop: 2, marginBottom: 12 }}>Add one free gift to your order — on us.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {bdayGifts.products.map(p => (
                      <button key={p.id} type="button" onClick={() => setChosenGift(chosenGift === p.id ? null : p.id)}
                        style={{ textAlign: 'left', padding: '11px 14px', border: `1px solid ${chosenGift === p.id ? 'var(--ink)' : 'var(--border-input)'}`, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                        <span style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: chosenGift === p.id ? 'var(--accent)' : 'var(--rd-muted)' }}>{chosenGift === p.id ? 'Free ✓' : 'Free'}</span>
                      </button>
                    ))}
                  </div>
                  {chosenGift && <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginTop: 8 }}>Tap again to deselect. Your gift is added free at checkout.</div>}
                </div>
              )}

              {/* Delivery window notice — depends on time of day */}
              {(() => {
                const now = new Date();
                const afterCutoff = now.getHours() >= 12;
                return (
                  <div style={ckNotice(afterCutoff ? 'var(--accent)' : 'var(--ink)')}>
                    <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: afterCutoff ? 'var(--accent)' : 'var(--ink)' }}>{afterCutoff ? 'Order after the 12 PM cut-off' : 'Same-day delivery'}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--rd-body)' }}>{afterCutoff
                      ? <>Today's deliveries are already on the road. Your order will be delivered <strong style={{ color: 'var(--ink)' }}>tomorrow from 12 PM</strong>, and we'll prioritise it ahead of new same-day orders.</>
                      : <>Order before 12 PM and your delivery will be made today. Riders begin their routes at 12 PM.</>}</div>
                  </div>
                );
              })()}

              {/* Delivery timing — ASAP or scheduled for later */}
              <div style={{ marginBottom: 16, padding: '14px 16px', border: '1px solid var(--rule-2)' }}>
                <div style={ckLbl}>When should we deliver?</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule-2)', border: '1px solid var(--rule-2)' }}>
                  {[['Deliver ASAP', false], ['Schedule for later', true]].map(([lab, val]) => {
                    const on = scheduleLater === val;
                    return <button key={lab} type="button" onClick={() => setScheduleLater(val)} style={{ padding: '11px', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--rd-muted)' }}>{lab}</button>;
                  })}
                </div>
                {scheduleLater && (
                  <>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                      <input type="date" value={scheduledDate} min={minSchedDate} max={maxSchedDate}
                        onChange={e => { setScheduledDate(e.target.value); clearErr('scheduledDate'); }}
                        style={{ flex: 1, minWidth: 150, padding: '11px 12px', borderRadius: 0, border: `1px solid ${errors.scheduledDate ? 'var(--accent)' : 'var(--border-input)'}`, fontFamily: 'var(--f-ui)', fontSize: 14, background: '#fff', color: 'var(--ink)', outline: 'none' }} />
                      <select value={scheduledSlot} onChange={e => { setScheduledSlot(e.target.value); clearErr('scheduledSlot'); }}
                        style={{ flex: 1, minWidth: 150, padding: '11px 12px', borderRadius: 0, border: `1px solid ${errors.scheduledSlot ? 'var(--accent)' : 'var(--border-input)'}`, fontFamily: 'var(--f-ui)', fontSize: 14, background: '#fff', color: 'var(--ink)', outline: 'none', cursor: 'pointer' }}>
                        <option value="">Pick a time slot…</option>
                        {slots.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    {(errors.scheduledDate || errors.scheduledSlot) && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--accent)', marginTop: 6 }}>Pick a delivery date and time slot.</div>}
                    <div style={{ fontSize: 11.5, color: 'var(--rd-muted)', marginTop: 8 }}>Choose any day within the next 7 days. Delivery fee is unchanged.</div>
                  </>
                )}
              </div>

              {/* First-order-free notice */}
              {isFirstOrderFree && (
                <div style={ckNotice('var(--accent)')}>
                  <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>Welcome — your first delivery is free</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--rd-body)' }}>No delivery fee on this order (first orders above GHS {FIRST_ORDER_FREE_MIN}). Future orders are a flat GHS 10.</div>
                </div>
              )}
              {isFirstOrderEligible && !isFirstOrderFree && (
                <div style={ckNotice('var(--accent)')}>
                  <div style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>Your first delivery is free above GHS {FIRST_ORDER_FREE_MIN}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--rd-body)' }}>Add <strong style={{ color: 'var(--ink)' }}>GHS {(FIRST_ORDER_FREE_MIN - afterLoyalty).toFixed(2)}</strong> more to skip the GHS {STANDARD_DELIVERY} delivery fee — or keep it for a bigger order; it doesn't expire until you use it.</div>
                </div>
              )}

              {/* Saved-address quick picker (hidden while the compact saved-address note is shown) */}
              {!compactAddress && savedAddresses.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={ckLbl}>Deliver to one of your saved addresses</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {savedAddresses.map(a => {
                      const active = form.neighborhood === a.neighborhood && (a.location && form.location && Math.abs(a.location.lat - (form.location.lat || 0)) < 0.0005);
                      return (
                        <button key={a.id} type="button" onClick={() => applyAddress(a)}
                          style={{ fontFamily: 'var(--f-ui)', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', border: `1px solid ${active ? 'var(--ink)' : 'var(--border-input)'}`, background: active ? 'var(--surface-warm)' : '#fff', cursor: 'pointer' }}>
                          {a.label}{a.isLastUsed ? ' (last used)' : ''}
                          <span style={{ color: 'var(--rd-muted)', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{a.neighborhood}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Family mode toggle */}
              <div style={{ marginBottom: 24, padding: '14px 18px', border: `1px solid ${familyMode ? 'var(--ink)' : 'var(--rule-2)'}`, background: familyMode ? 'var(--surface-warm)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
                onClick={() => setFamilyMode(f => !f)}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Family Mode — ordering for someone else?</div>
                  <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>Send a gift with a custom message and GPS pin</div>
                </div>
                <div style={{ width: 44, height: 24, background: familyMode ? 'var(--ink)' : 'var(--rule-2)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2, left: familyMode ? 22 : 2, width: 20, height: 20, background: '#fff', transition: 'left .2s' }} />
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <CheckoutField {...fieldProps('name')} label="Your Name" placeholder="Kwame Asante" />
                <CheckoutField {...fieldProps('phone')} label="Your phone (Call)" placeholder="+233 50 123 4567" />
                {compactAddress && (
                  <div style={{ flex: '1 1 100%', border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--ink)', background: 'var(--surface-warm)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Delivering to {appliedAddress.label}{appliedAddress.isDefault ? ' (your default address)' : ''}</div>
                      <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>{appliedAddress.neighborhood}{appliedAddress.address ? ` · ${appliedAddress.address}` : ''}</div>
                    </div>
                    <button type="button" onClick={() => setEditingAddress(true)}
                      style={{ fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink)', background: '#fff', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '8px 14px' }}>Change / add details</button>
                  </div>
                )}
                {!compactAddress && (
                <div style={{ flex: '1 1 100%' }}>
                  <label style={ckLbl}>Neighborhood</label>
                  <select value={form.neighborhood} onChange={e => { set('neighborhood', e.target.value); clearErr('neighborhood'); if (e.target.value !== '__other__') set('customNeighborhood', ''); }}
                    style={{ ...inputStyle('neighborhood'), cursor: 'pointer' }}>
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
                  {errors.neighborhood && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>{errors.neighborhood}</div>}
                </div>
                )}
                {!compactAddress && (
                <>
                <CheckoutField {...fieldProps('address')} label="Delivery Address / Landmark" placeholder="e.g. Blue gate opposite Lamashegu market" />
                {errors.address && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--accent)', marginTop: -6, marginBottom: 8 }}>{errors.address}</div>}
                </>
                )}
              </div>

              {!compactAddress && (
              <div style={{ textAlign: 'center', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--rd-muted)', letterSpacing: '.04em', textTransform: 'uppercase', margin: '10px 0' }}>
                Type a landmark above, or pin your spot on the map below
              </div>
              )}

              {/* Pin exact spot on the map (lazy-loads the map) */}
              {!compactAddress && (
              <div style={{ marginTop: 4 }}>
                {!mapOpen ? (
                  <button type="button" onClick={() => setMapOpen(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '13px 16px', background: '#fff', border: '1px dashed var(--border-input)', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Pin exact spot on map</div>
                      <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>
                        {form.location ? 'Location pinned — tap to adjust' : 'Search a landmark or drop a pin. Skip this if you typed an address above.'}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--f-label)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>{form.location ? 'Edit' : 'Open map'}</span>
                  </button>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rd-muted)' }}>Pin your exact spot</label>
                      <button type="button" onClick={() => setMapOpen(false)}
                        style={{ fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--rd-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Hide map</button>
                    </div>
                    <MapPicker
                      value={form.location || null}
                      onChange={(loc) => set('location', loc)}
                      height={260}
                    />
                  </div>
                )}
              </div>
              )}

              {familyMode && (
                <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1.5px dashed var(--cream-dark)' }}>
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 16 }}>Recipient Details</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    <CheckoutField {...fieldProps('recipientName')} label="Recipient Name" placeholder="Abena Mensah" />
                    <CheckoutField {...fieldProps('recipientPhone')} label="Recipient Phone" placeholder="+233 24 000 0000" />
                    <CheckoutField {...fieldProps('recipientAddress')} label="Recipient Address" placeholder="House number and street" />
                    <div style={{ flex: '1 1 100%' }}>
                      <label style={ckLbl}>Google Maps Pin (Optional)</label>
                      <input value={form.mapsPin} onChange={e => set('mapsPin', e.target.value)}
                        placeholder="Paste Google Maps link here..."
                        style={inputStyle('mapsPin')}
                      />
                      <div style={{ fontSize: 11, color: 'var(--warm-gray)', marginTop: 4 }}>Share the pin from Google Maps for precise delivery</div>
                    </div>
                    <div style={{ flex: '1 1 100%' }}>
                      <label style={ckLbl}>Gift Message (Optional)</label>
                      <textarea value={form.giftMessage} onChange={e => set('giftMessage', e.target.value)}
                        placeholder="Write a personal message for the recipient..."
                        rows={3} style={{ ...inputStyle('giftMessage'), resize: 'vertical' }} />
                    </div>
                  </div>
                </div>
              )}

              <button onClick={() => { if (validate1()) setStep(2); }} style={{ ...ckPrimary, marginTop: 28 }}>Continue to Review →</button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 20 }}>Review Your Order</h2>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {cart.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
                    <div style={{ width: 56, height: 56, flex: 'none', background: '#fff', border: '1px solid var(--rule-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {item.img ? <img src={item.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={e => { e.target.style.visibility = 'hidden'; }} /> : <span style={{ width: '100%', height: '100%', background: 'repeating-linear-gradient(135deg,#f4f4f1 0 6px,#eceae5 6px 12px)' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--rd-faint)', marginTop: 2 }}>{item.unit} × {item.qty}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: 15, letterSpacing: '-.02em' }}>GHS {(item.price * item.qty).toFixed(2)}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20, padding: '16px 18px', border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--ink)', background: 'var(--surface-warm)' }}>
                <div style={{ fontFamily: 'var(--f-label)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rd-muted)', marginBottom: 8 }}>Delivering to</div>
                <div style={{ fontSize: 13.5, color: 'var(--rd-body)' }}>
                  <strong style={{ color: 'var(--ink)' }}>{familyMode ? form.recipientName : form.name}</strong> · {form.neighborhood}
                  {familyMode && form.giftMessage && <div style={{ marginTop: 6, fontFamily: 'var(--f-serif)', fontStyle: 'italic', fontSize: 15, color: 'var(--ink)' }}>"{form.giftMessage}"</div>}
                  {scheduleLater && scheduledDate && <div style={{ marginTop: 6, fontFamily: 'var(--f-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink)' }}>Scheduled: {scheduledDate}{scheduledSlot ? ` · ${scheduledSlot}` : ''}</div>}
                </div>
              </div>

              {/* Auto-reorder — signed-in users only */}
              {currentUser && currentUser.id && currentUser.role !== 'guest' && (
                <div style={{ marginTop: 20, padding: '14px 16px', border: '1px solid var(--rule-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoReorder} onChange={e => setAutoReorder(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--ink)', marginTop: 2 }} />
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Auto-reorder these items</div>
                      <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>We'll re-create this exact order every chosen interval. Pause or cancel any time from My Orders.</div>
                    </span>
                  </label>
                  {autoReorder && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 26 }}>
                      <span style={{ fontSize: 13, color: 'var(--rd-muted)' }}>Every</span>
                      <select value={reorderCadence} onChange={e => setReorderCadence(Number(e.target.value))}
                        style={{ padding: '8px 10px', borderRadius: 0, border: '1px solid var(--border-input)', fontFamily: 'var(--f-ui)', fontSize: 13, background: '#fff', color: 'var(--ink)' }}>
                        <option value={7}>7 days (weekly)</option>
                        <option value={14}>14 days (fortnightly)</option>
                        <option value={30}>30 days (monthly)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, background: 'transparent', color: 'var(--rd-muted)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '13px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>← Back</button>
                <button onClick={() => setStep(3)} style={{ ...ckPrimary, flex: 2 }}>Confirm Order →</button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 20 }}>Confirm & Pay</h2>

              {/* Payment method */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ ...ckLbl, marginBottom: 12 }}>Payment Method</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {payConfigFailed && !paystackEnabled && (
                    <div style={{ ...ckNotice('var(--accent)'), marginBottom: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--rd-body)', lineHeight: 1.5 }}>
                        We couldn't check whether online payment is available just now.
                        Cash on delivery still works.{' '}
                        <button onClick={loadPaystackConfig}
                          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'var(--ink)', textDecoration: 'underline', cursor: 'pointer' }}>
                          Try again
                        </button>
                      </div>
                    </div>
                  )}
                  {paystackEnabled && (
                    <button onClick={() => set('payMethod', 'paystack')}
                      style={{ textAlign: 'left', padding: '14px 16px', border: form.payMethod === 'paystack' ? '2px solid var(--ink)' : '1px solid var(--border-input)', background: '#fff', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Pay Now — Card or Mobile Money</div>
                      <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>Secure checkout via Paystack. Enter your MoMo number, approve with your PIN, done.</div>
                    </button>
                  )}
                  {paystackEnabled && form.payMethod === 'paystack' && (
                    <div style={{ ...ckNotice('var(--accent)'), marginBottom: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--rd-body)', lineHeight: 1.5 }}>Approving with mobile money? If the OTP code doesn't arrive by SMS (network can be slow), wait about a minute on the payment screen — a <strong style={{ color: 'var(--ink)' }}>"Get OTP via WhatsApp"</strong> option appears as a reliable backup. Don't close the window while you wait.</div>
                    </div>
                  )}
                  <button onClick={() => set('payMethod', 'cash')}
                    style={{ textAlign: 'left', padding: '14px 16px', border: form.payMethod === 'cash' ? '2px solid var(--ink)' : '1px solid var(--border-input)', background: '#fff', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Cash on Delivery</div>
                    <div style={{ fontSize: 12, color: 'var(--rd-muted)', marginTop: 2 }}>Pay the rider in cash when your order arrives.</div>
                  </button>
                </div>
              </div>


              {/* Download receipt checkbox */}
              <label style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 16px', border: '1px solid var(--rule-2)', cursor: 'pointer', marginBottom: 24 }}>
                <input type="checkbox" checked={downloadReceipt} onChange={e => setDownloadReceipt(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--ink)', cursor: 'pointer' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Download PDF Receipt</div>
                  <div style={{ fontSize: 12, color: 'var(--rd-muted)' }}>Get a printable PDF receipt of your order</div>
                </div>
              </label>

              {/* WhatsApp preview */}
              <div style={{ background: '#f7f8f5', border: '1px solid var(--rule-2)', padding: '16px', marginBottom: 24 }}>
                <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--wa)', marginBottom: 10 }}>WhatsApp message preview</div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, lineHeight: 1.7, color: 'var(--ink-2)' }}>
                  <strong>ORDER #{orderId}</strong><br/>
                  Items: {cart.slice(0,3).map(i=>`${i.name} x${i.qty}`).join(', ')}{cart.length > 3 ? '...' : ''}<br/>
                  Total: GHS {total.toFixed(2)}<br/>
                  Neighborhood: {form.neighborhood || '[neighborhood]'}<br/>
                  Recipient: {familyMode ? (form.recipientName || '[name]') : (form.name || '[name]')} / {familyMode ? (form.recipientPhone || '[phone]') : (form.phone || '[phone]')}<br/>
                  Location: {form.mapsPin || form.address || form.neighborhood || '[location]'}
                </div>
              </div>

              {submitError && (
                <div style={{ border: '1px solid var(--rule-2)', borderLeft: '3px solid var(--accent)', background: 'var(--surface-warm, #FFF7F2)', padding: '14px 16px', marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 700, marginBottom: 5 }}>
                    {submitError.kind === 'rejected' ? 'We couldn’t place this order'
                      : submitError === 'network' ? 'Your order didn’t go through'
                      : 'We couldn’t save your order'}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--rd-body)' }}>
                    {submitError.kind === 'rejected' ? (
                      <>
                        {submitError.message}{' '}
                        {!!(submitError.unavailable || []).length && (
                          <span>Affected: {submitError.unavailable.map((u) => u.name || ('item #' + u.id)).join(', ')}. </span>
                        )}
                        <strong>Nothing was charged.</strong> Adjust your cart and try again.
                      </>
                    ) : (
                      <>
                        {submitError === 'network'
                          ? 'Your connection dropped before we could send it. '
                          : 'Something went wrong on our side. '}
                        <strong>Nothing was charged and your items are still in your cart.</strong>{' '}
                        {submitError === 'network'
                          ? 'Check your internet, then tap Place Order again.'
                          : 'Please tap Place Order again.'}
                      </>
                    )}
                  </div>
                  <a href={'https://wa.me/233599189773?text=' + encodeURIComponent('Hi SDGMart, I tried to place an order but it kept failing. Can you help?')}
                     target="_blank" rel="noopener noreferrer"
                     style={{ display: 'inline-block', marginTop: 10, fontFamily: 'var(--f-ui)', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'underline' }}>
                    Still not working? Message us on WhatsApp →
                  </a>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(2)} disabled={paying} style={{ flex: 1, background: 'transparent', color: 'var(--rd-muted)', border: '1px solid var(--border-input)', cursor: 'pointer', padding: '13px', fontFamily: 'var(--f-ui)', fontSize: 14, fontWeight: 600 }}>← Back</button>
                {form.payMethod === 'paystack' ? (
                  <button onClick={() => { setWaNumber(form.phone || ''); payWithPaystack(); }} disabled={paying}
                    style={{ ...ckPrimary, flex: 2, opacity: paying ? .6 : 1, cursor: paying ? 'wait' : 'pointer' }}>
                    {paying ? 'Opening payment…' : `Pay GHS ${total.toFixed(2)} →`}
                  </button>
                ) : (
                  <button onClick={() => { setWaNumber(form.phone || ''); placeOrder(); }} disabled={paying}
                    style={{ ...ckPrimary, flex: 2, opacity: paying ? .6 : 1, cursor: paying ? 'wait' : 'pointer' }}>
                    {paying ? 'Placing your order…' : (submitError ? 'Place Order again →' : 'Place Order →')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Order summary sidebar */}
        <div style={{ border: '1px solid var(--rule-2)', padding: '24px', position: isMobile ? 'static' : 'sticky', top: 120, background: '#fff' }}>
          <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-.02em', marginBottom: 16 }}>Order Summary</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {cart.map(i => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--rd-muted)' }}>{i.name} <span style={{ fontWeight: 700, color: 'var(--ink)' }}>×{i.qty}</span></span>
                <span style={{ fontFamily: 'var(--f-display)', fontWeight: 600 }}>GHS {(i.price * i.qty).toFixed(2)}</span>
              </div>
            ))}
            {chosenGift && bdayGifts.products.find(p => p.id === chosenGift) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: 'var(--accent)' }}>
                <span>{bdayGifts.products.find(p => p.id === chosenGift).name} <span style={{ fontWeight: 700 }}>(birthday)</span></span>
                <span style={{ fontFamily: 'var(--f-label)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11 }}>Free</span>
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: 'var(--rd-muted)' }}>Subtotal</span>
              <span style={{ fontFamily: 'var(--f-display)', fontWeight: 600 }}>GHS {subtotal.toFixed(2)}</span>
            </div>
            {canUseDiscount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--accent)' }}>
                <span>Squad Discount (5%)</span>
                <span style={{ fontFamily: 'var(--f-display)', fontWeight: 600 }}>−GHS {discount.toFixed(2)}</span>
              </div>
            )}
            {loyaltyAvailable > 0 && (
              <div style={{ border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)', padding: '10px 12px', marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={useLoyalty} onChange={e => setUseLoyalty(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--ink)', marginTop: 1 }} />
                  <span style={{ flex: 1 }}>
                    <strong>Loyalty credit:</strong> GHS {loyaltyAvailable.toFixed(2)} available
                    {useLoyalty && loyaltyUsed > 0 && <span style={{ color: 'var(--accent)' }}> — using GHS {loyaltyUsed.toFixed(2)}</span>}
                  </span>
                </label>
              </div>
            )}
            {useLoyalty && loyaltyUsed > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--accent)' }}>
                <span>Loyalty credit</span>
                <span style={{ fontFamily: 'var(--f-display)', fontWeight: 600 }}>−GHS {loyaltyUsed.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 14 }}>
              <span style={{ color: 'var(--rd-muted)' }}>Delivery</span>
              <span style={{ fontFamily: delivery === 0 ? 'var(--f-label)' : 'var(--f-display)', fontWeight: 700, letterSpacing: delivery === 0 ? '.06em' : '0', textTransform: delivery === 0 ? 'uppercase' : 'none', fontSize: delivery === 0 ? 11 : 13, color: delivery === 0 ? 'var(--wa)' : 'var(--ink)' }}>
                {delivery === 0 ? (isFirstOrderFree ? 'First order free' : 'Free') : `GHS ${delivery.toFixed(2)}`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '2px solid var(--ink)', paddingTop: 12 }}>
              <span style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-.02em' }}>Total</span>
              <RPrice amount={total} size="md" />
            </div>
          </div>
          {afterLoyalty < FREE_DELIVERY_MIN && !isFirstOrderFree && (
            <div style={{ marginTop: 14, border: '1px solid var(--rule-2)', borderLeft: '2px solid var(--accent)', background: 'var(--surface-warm)', padding: '10px 12px', fontSize: 12, color: 'var(--rd-body)' }}>
              {isFirstOrderEligible
                ? <>Add <strong style={{ color: 'var(--ink)' }}>GHS {(FIRST_ORDER_FREE_MIN - afterLoyalty).toFixed(2)}</strong> more — your FIRST delivery is free above GHS {FIRST_ORDER_FREE_MIN}.</>
                : <>Add <strong style={{ color: 'var(--ink)' }}>GHS {(FREE_DELIVERY_MIN - afterLoyalty).toFixed(2)}</strong> more for free delivery.</>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { CheckoutPage });
