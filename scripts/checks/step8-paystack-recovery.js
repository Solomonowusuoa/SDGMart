/* SDGMart — the last Paystack items: the charged amount, and PAID — NEEDS ACTION.
 *
 * RUN THIS AFTER a real test-mode payment has been completed by hand.
 * It finds the most recent paid order carrying a Paystack reference, or takes
 * one:  node scripts/checks/step8-paystack-recovery.js 123
 *
 * WHAT IT DOES, AND WHY IT IS SAFE.
 * The Reconcile screen's "PAID — NEEDS ACTION" state means: Paystack took the
 * money, and no order exists for it. Producing that state by breaking order
 * creation mid-payment would mean deliberately sabotaging the live code path.
 * Instead this RECONSTRUCTS the state from an order that already succeeded:
 *
 *   1. snapshot the order row
 *   2. rebuild its pending_payments draft and delete the order
 *      -> the reference is now genuinely paid, with no order: the exact state
 *   3. read Reconcile, which asks Paystack directly and reports what it charged
 *      -> that answers C-07's "amount charged matches the order total" too
 *   4. press the real "Create the order" recovery endpoint
 *   5. check the recreated order matches the original
 *
 * Nothing is sabotaged and no code path is altered. If anything fails midway,
 * the finally block puts the original order back exactly as it was.
 *
 * Run: node scripts/checks/step8-paystack-recovery.js [orderId]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : pass === null ? 'SKIP' : 'INFO') +
    '  [' + id + '] ' + name + (detail ? '\n            ' + detail : ''));
}
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let t = ''; try { t = await r.text(); } catch (_) {}
  let j = null; try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, text: t, json: j };
}

(async () => {
  const stamp = Date.now();
  let adminId = null, adminTok = null;
  let snapshot = null, restored = false, recoveredId = null;

  try {
    const cfg = await call('GET', '/api/paystack/config');
    const pk = (cfg.json && cfg.json.publicKey) || '';
    if (!pk.startsWith('pk_test_')) {
      console.error('REFUSING: public key is ' + pk.slice(0, 8) + '…, not pk_test_. Swap to test keys first.');
      process.exit(1);
    }

    // WHICH ORDER TO WORK FROM — and why this is deliberately awkward.
    //
    // An earlier version auto-picked "the most recent paid order". On a shop
    // with no fresh test payment yet, that selected a REAL CUSTOMER'S order
    // (a 13-day-old GHS 50 payment) and deleted it. The finally block put it
    // back byte-for-byte, but convenience should never have been able to point
    // this at live customer data in the first place. So: no auto-pick, ever.
    const wanted = process.argv.find((a) => /^\d+$/.test(a));
    if (!wanted) {
      console.error('\nUsage: node scripts/checks/step8-paystack-recovery.js <orderId> [--force]\n');
      console.error('This script DELETES the order and recreates it through the recovery path, so');
      console.error('it will not choose one for you. Complete a test payment, then pass its id.\n');
      const recent = await sb.from('orders').select('id, total, paystack_ref, created_at, customer_name')
        .eq('paid', true).not('paystack_ref', 'is', null).order('id', { ascending: false }).limit(5);
      console.error('Recent paid orders (newest first):');
      for (const r of (recent.data || [])) {
        const mins = Math.round((Date.now() - new Date(r.created_at)) / 60000);
        console.error('   ' + String(r.id).padStart(4) + '  GHS ' + String(r.total).padEnd(8) +
          mins + ' min old   ' + r.customer_name);
      }
      process.exit(1);
    }
    const found = await sb.from('orders').select('*').eq('id', Number(wanted)).maybeSingle();
    if (!found.data) { console.error('order ' + wanted + ' not found'); process.exit(1); }
    if (!found.data.paid || !found.data.paystack_ref) {
      console.error('order ' + wanted + ' is not a paid Paystack order — nothing to reconcile');
      process.exit(1);
    }
    snapshot = found.data;
    const ageMin = Math.round((Date.now() - new Date(snapshot.created_at)) / 60000);
    console.log('working from order ' + snapshot.id + '  ref ' + snapshot.paystack_ref);
    console.log('  GHS ' + snapshot.total + ' · "' + snapshot.customer_name + '" · placed ' + ageMin + ' min ago\n');

    // A payment made under the LIVE keys cannot be verified against the TEST
    // API, so every check below would read UNKNOWN — and the order would have
    // been deleted and recreated for nothing. Age is the available proxy for
    // "made during this test-key window".
    if (ageMin > 360 && !process.argv.includes('--force')) {
      console.error('  ⛔ REFUSING: this order is ' + ageMin + ' minutes old, so it almost certainly');
      console.error('     predates the switch to TEST keys and was paid under LIVE ones. Paystack\'s');
      console.error('     test API will not recognise the reference, and this script would delete');
      console.error('     and recreate a real order to learn nothing.');
      console.error('     Complete a fresh test payment and use that id, or pass --force.\n');
      process.exit(1);
    }

    const ad = await sb.from('users').insert({
      name: 'Step8 Temp Admin', email: `sdgtest-step8-${stamp}@example.invalid`,
      password_hash: 'x-no-login', role: 'admin', email_verified: true, must_change_password: false,
    }).select().single();
    adminId = ad.data.id; adminTok = await db.sessions.create(adminId, 'user');

    // ── Reconstruct the paid-but-orderless state ──────────────────────────
    console.log('Reconstructing the PAID — NEEDS ACTION state');
    const draft = {
      items: (snapshot.items || []).map((i) => ({ id: i.id, qty: i.qty })),
      customer: snapshot.customer_name, phone: snapshot.customer_phone,
      neighborhood: snapshot.neighborhood, address: snapshot.address,
      location: snapshot.location || { lat: 9.4034, lng: -0.8424 },
      payMethod: 'paystack',
    };
    await sb.from('pending_payments').insert({
      reference: snapshot.paystack_ref, user_id: snapshot.user_id, draft,
      created_at: new Date(Date.now() - 20 * 60000).toISOString(),   // older than the 15-min orphan window
    });
    await sb.from('orders').delete().eq('id', snapshot.id);
    console.log('  order ' + snapshot.id + ' removed, its draft restored — the reference is now paid with no order\n');

    // ── C-07 + Reconcile: what does Paystack say it charged? ──────────────
    console.log('Reconcile, and the charged amount (C-07)');
    const orphans = await call('GET', '/api/admin/payments/orphans?minutes=1&limit=50', null, adminTok);
    const mine = (orphans.json || []).find((o) => o.reference === snapshot.paystack_ref);
    rec('E-01', 'the orphaned reference appears in Reconcile', !!mine,
      mine ? 'listed' : 'NOT LISTED — Reconcile would not surface this stuck payment');
    rec('E-01', '⭐ it reads PAID — NEEDS ACTION, not ABANDONED', !!mine && mine.paid === true,
      mine ? 'paid = ' + JSON.stringify(mine.paid) +
        (mine.paid === null ? '  (UNKNOWN — Paystack cannot verify this reference on the current keys)' : '')
        : 'n/a');
    rec('C-07', '⭐ the amount Paystack charged matches the order total',
      !!mine && mine.paystackAmount != null && Math.abs(Number(mine.paystackAmount) - Number(snapshot.total)) < 0.005,
      mine ? 'Paystack charged GHS ' + mine.paystackAmount + ' · the order totalled GHS ' + snapshot.total +
        ' · channel ' + (mine.channel || 'n/a') : 'n/a');

    // ── The recovery button ───────────────────────────────────────────────
    console.log('\n"Create the order" recovery');
    const rec1 = await call('POST', '/api/admin/payments/orphans/' + encodeURIComponent(snapshot.paystack_ref) + '/recover', {}, adminTok);
    recoveredId = rec1.json && rec1.json.id;
    rec('E-01', 'recovery recreates the order', rec1.status === 200 && !!recoveredId,
      'status ' + rec1.status + ' · new order ' + recoveredId + ' · ' + String((rec1.json && rec1.json.error) || '').slice(0, 70));
    if (recoveredId) {
      const back = (await sb.from('orders').select('*').eq('id', recoveredId).single()).data;
      restored = true;
      rec('E-01', 'the recovered order carries the same total', Math.abs(Number(back.total) - Number(snapshot.total)) < 0.005,
        'GHS ' + back.total + ' vs the original GHS ' + snapshot.total);
      rec('E-01', 'it is marked paid and keeps the Paystack reference', back.paid === true && back.paystack_ref === snapshot.paystack_ref,
        'paid=' + back.paid + ' · ref ' + back.paystack_ref);
      const gone = await sb.from('pending_payments').select('reference').eq('reference', snapshot.paystack_ref).maybeSingle();
      rec('E-01', 'the draft is cleared once recovered', !gone.data, gone.data ? 'STILL PRESENT' : 'removed');
      const again = await call('POST', '/api/admin/payments/orphans/' + encodeURIComponent(snapshot.paystack_ref) + '/recover', {}, adminTok);
      rec('E-01', 'recovering twice is refused rather than double-creating', again.status === 409,
        'second attempt → ' + again.status + ' · ' + String(again.json && again.json.error).slice(0, 60));
    }
    const anon = await call('POST', '/api/admin/payments/orphans/x/recover', {}, null);
    rec('E-01', 'recovery requires admin', anon.status === 401 || anon.status === 403, 'unauthenticated → ' + anon.status);
  } finally {
    console.log('\nCleanup / restore');
    // If recovery did not put the order back, restore the snapshot by hand so
    // the shop is never left missing a paid order.
    if (snapshot && !restored) {
      const still = await sb.from('orders').select('id').eq('paystack_ref', snapshot.paystack_ref).maybeSingle();
      if (!still.data) {
        const { id: _drop, ...row } = snapshot;
        const put = await sb.from('orders').insert({ ...row, id: snapshot.id }).select('id').maybeSingle();
        console.log('  restored the original order row: ' + (put.data ? 'ok (id ' + put.data.id + ')' : 'FAILED — ' + JSON.stringify(put.error)));
      }
    }
    await sb.from('pending_payments').delete().eq('reference', snapshot && snapshot.paystack_ref).then(() => {}, () => {});
    if (adminId) {
      await sb.from('sessions').delete().eq('user_id', adminId).eq('user_type', 'user');
      await sb.from('users').delete().eq('id', adminId);
    }
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const p = await sb.from('pending_payments').select('reference', { count: 'exact', head: true });
    console.log('  orders ' + o.count + ' · users ' + u.count + ' · pending_payments ' + p.count);
    if (recoveredId) console.log('  NOTE: the paid order now lives at id ' + recoveredId + ' (was ' + (snapshot && snapshot.id) + ') — recovery creates a new row.');

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length);
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
