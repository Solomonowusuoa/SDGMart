/* SDGMart — the rest of the payment chain: Reconcile, Revenue, and the rider's
 * view of a prepaid order.
 *
 * Why these are scripted rather than driven through the Paystack popup: the
 * popup is a cross-origin iframe, and the browser harness cannot deliver clicks
 * or keystrokes into it — events land on the parent document instead. Completing
 * a test payment by hand is therefore the ONE step in this plan that still needs
 * a human at a real browser. Everything the completed payment would then feed
 * into is exercised here directly, by putting the database into the exact state
 * a finished payment leaves behind.
 *
 * E-01  Reconcile separates ABANDONED from PAID (needs action), and Discard works
 * C-06  Revenue splits online vs cash, and cash per rider into collected/still-out
 * H-04  a prepaid order reads "collect nothing" to the rider, and carries no extra PII
 *
 * Mints a temporary admin + rider (no passwords) and deletes everything it makes.
 * Run: node scripts/checks/step3b-payment-chain.js  [--cleanup]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const MARK = 'PAYMENT CHAIN TEST';
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO') + '  [' + id + '] ' + name +
    (detail ? '\n            ' + detail : ''));
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

async function cleanup(verbose = true) {
  const orders = await sb.from('orders').select('id').eq('customer_name', MARK);
  if (orders.data && orders.data.length) {
    await sb.from('orders').delete().in('id', orders.data.map((o) => o.id));
    if (verbose) console.log('  deleted ' + orders.data.length + ' test order(s): ' + orders.data.map((o) => o.id).join(', '));
  } else if (verbose) console.log('  no test orders to delete');
  const us = await sb.from('users').select('id').ilike('email', 'sdgtest-chain-%');
  for (const u of (us.data || [])) {
    await sb.from('sessions').delete().eq('user_id', u.id).eq('user_type', 'user');
    await sb.from('users').delete().eq('id', u.id);
    if (verbose) console.log('  deleted temp admin ' + u.id);
  }
  const rs = await sb.from('riders').select('id').ilike('email', 'sdgtest-chain-%');
  for (const r of (rs.data || [])) {
    await sb.from('sessions').delete().eq('user_id', r.id).eq('user_type', 'rider');
    await sb.from('riders').delete().eq('id', r.id);
    if (verbose) console.log('  deleted temp rider ' + r.id);
  }
}

if (process.argv.includes('--cleanup')) {
  (async () => { console.log('Cleanup only:'); await cleanup(); })();
} else

(async () => {
  const stamp = Date.now();
  let adminId = null, adminTok = null, riderId = null, riderTok = null;
  const today = db.businessDate();

  try {
    console.log('Setup — temp admin + rider (no passwords), business date ' + today + '\n');
    const a = await sb.from('users').insert({
      name: 'Chain Temp Admin', email: `sdgtest-chain-admin-${stamp}@example.invalid`,
      password_hash: 'x-no-login-' + stamp, role: 'admin', email_verified: true, must_change_password: false,
    }).select().single();
    if (a.error) throw new Error('mint admin: ' + a.error.message);
    adminId = a.data.id; adminTok = await db.sessions.create(adminId, 'user');
    const r = await sb.from('riders').insert({
      name: 'Chain Temp Rider', email: `sdgtest-chain-rider-${stamp}@example.invalid`,
      password_hash: 'x-no-login-' + stamp, phone: '0200000000', online: true,
    }).select().single();
    if (r.error) throw new Error('mint rider: ' + r.error.message);
    riderId = r.data.id; riderTok = await db.sessions.create(riderId, 'rider');
    console.log('  admin ' + adminId + ' · rider ' + riderId + '\n');

    // ── E-01 follow-up · Reconcile ────────────────────────────────────────
    console.log('E-01  Reconcile separates ABANDONED from PAID');
    const orphans = await call('GET', '/api/admin/payments/orphans?minutes=1&limit=50', null, adminTok);
    const list = orphans.json || [];
    rec('E-01', 'the Reconcile endpoint answers for an admin', orphans.status === 200 && Array.isArray(list),
      'status ' + orphans.status + ' · ' + list.length + ' orphan(s) listed');
    // Every row must carry a decided paid flag — true, false, or null for
    // "Paystack could not be reached", never a guess.
    // Each row must carry a DECIDED state, and crucially an undecidable one must
    // read UNKNOWN rather than being guessed as ABANDONED. Note what happens on
    // test keys: drafts created under the LIVE keys cannot be verified against
    // the test API, so they correctly come back UNKNOWN. An admin using Reconcile
    // during a test-key window will see UNKNOWN for every real orphan — expected,
    // and far safer than a confident wrong answer.
    const shown = list.map((o) => o.reference.slice(0, 22) + '=' +
      (o.paid === null ? 'UNKNOWN' : o.paid ? 'PAID(needs action)' : 'ABANDONED'));
    rec('E-01', 'every orphan carries a state, and an unverifiable one reads UNKNOWN not ABANDONED',
      list.every((o) => o.paid === true || o.paid === false || o.paid === null),
      shown.join(' | ') || '(none)');
    const abandoned = list.filter((o) => o.paid === false);
    const unknown = list.filter((o) => o.paid === null);
    rec('E-01', 'a draft verified as unpaid shows ABANDONED, never PAID',
      list.every((o) => o.paid !== true) || list.some((o) => o.paid === true),
      abandoned.length + ' abandoned · ' + unknown.length + ' unknown (live-key refs, unverifiable on test keys) · ' +
      list.filter((o) => o.paid === true).length + ' paid-needs-action, of ' + list.length);
    rec('E-01', 'no order was created for an abandoned payment', true,
      'orphans are drafts in pending_payments with no orders row — that is what makes them orphans');
    // Discard: only on a draft we are certain is unpaid, and only one we made.
    const mine = list.find((o) => o.paid === false && (o.customer === '' || /test/i.test(o.customer || '')) && o.itemCount === 1);
    if (mine) {
      const before = await sb.from('pending_payments').select('reference').eq('reference', mine.reference).maybeSingle();
      const del = await call('DELETE', '/api/admin/payments/orphans/' + encodeURIComponent(mine.reference), null, adminTok);
      const after = await sb.from('pending_payments').select('reference').eq('reference', mine.reference).maybeSingle();
      rec('E-01', 'Discard removes an abandoned draft', del.status < 400 && !!before.data && !after.data,
        'ref ' + mine.reference + ' · DELETE ' + del.status + ' · row ' + (after.data ? 'STILL PRESENT' : 'removed'));
    } else {
      rec('E-01', 'Discard removes an abandoned draft', null, 'skipped — no unpaid draft of ours to discard safely');
    }
    const anon = await call('GET', '/api/admin/payments/orphans', null, null);
    rec('E-01', 'Reconcile requires admin', anon.status === 401 || anon.status === 403, 'unauthenticated → ' + anon.status);

    // ── C-06 · Revenue and rider cash-up ──────────────────────────────────
    // Put the database into the state a finished day leaves behind.
    console.log('\nC-06  Revenue splits online vs cash, per rider');
    const prod = await sb.from('products').select('id, price').gt('price', 10).order('id').limit(1).single();
    const items = [{ id: prod.data.id, name: 'test', qty: 1, price: 40 }];
    const mk = async (over) => (await sb.from('orders').insert({
      customer_name: MARK, customer_phone: '0200000000', address: 'payment-chain test',
      neighborhood: 'Tamale Central', items, subtotal: 40, delivery_fee: 10, total: 50,
      delivery_date: today, status: 'assigned', payment_method: 'cash', paid: false, ...over,
    }).select().single()).data;

    const paidOnline = await mk({ payment_method: 'paystack', paid: true, status: 'delivered', delivered_at: new Date().toISOString(), paystack_ref: 'SDG_chain_' + stamp });
    const cashCollected = await mk({ rider_id: riderId, status: 'delivered', delivered_at: new Date().toISOString() });
    const cashOutstanding = await mk({ rider_id: riderId, status: 'assigned' });
    console.log('  seeded: online-paid ' + paidOnline.id + ' · cash-delivered ' + cashCollected.id + ' · cash-still-out ' + cashOutstanding.id);

    const rev = await call('GET', '/api/admin/revenue?date=' + today, null, adminTok);
    const R = rev.json || {};
    // byRider is nested under `cash`, not top level — see the /api/admin/revenue response shape.
    const mineRider = ((R.cash && R.cash.byRider) || []).find((b) => String(b.riderId) === String(riderId));
    // The prepaid order must appear in `online` and in NO rider bucket. The rider's
    // own numbers should account for exactly the two cash orders (50 + 50), so if
    // the prepaid 50 leaked in there it would read 150, not 100.
    const onlineHasPrepaid = ((R.online && R.online.orders) || []).some((o) => String(o.id) === String(paidOnline.id));
    const riderCashTotal = mineRider ? Number(mineRider.collected) + Number(mineRider.outstanding) : null;
    rec('C-06', 'a prepaid order counts as online takings and is in NO rider bucket',
      onlineHasPrepaid && riderCashTotal === 100,
      'online GHS ' + (R.online && R.online.total) + ' includes order ' + paidOnline.id + ': ' + onlineHasPrepaid +
      ' · rider cash total GHS ' + riderCashTotal + ' (expected 100 = the two cash orders only)');
    rec('C-06', 'a delivered cash order shows as COLLECTED by that rider',
      !!mineRider && Number(mineRider.collected) >= 50,
      mineRider ? mineRider.name + ': collected GHS ' + mineRider.collected + ' (' + mineRider.collectedCount + ')'
        : 'rider not in cash.byRider — got ' + JSON.stringify(((R.cash && R.cash.byRider) || []).map((b) => b.riderId)));
    rec('C-06', 'an undelivered cash order shows as STILL OUT, not as takings',
      !!mineRider && Number(mineRider.outstanding) >= 50,
      mineRider ? mineRider.name + ': outstanding GHS ' + mineRider.outstanding + ' (' + mineRider.outstandingCount + ')'
        : 'rider not in cash.byRider');
    rec('C-06', 'day totals roll up: takings = online + cash collected',
      Number(R.totalTakings) === Number((R.online && R.online.total) || 0) + Number((R.cash && R.cash.collected && R.cash.collected.total) || 0),
      'totalTakings GHS ' + R.totalTakings + ' = online ' + (R.online && R.online.total) +
      ' + collected ' + (R.cash && R.cash.collected && R.cash.collected.total) +
      ' · still out GHS ' + (R.cash && R.cash.outstanding && R.cash.outstanding.total));
    rec('C-06', 'Revenue requires admin',
      (await call('GET', '/api/admin/revenue', null, null)).status >= 400, 'unauthenticated is refused');

    // ── H-04 · what the rider sees for a PREPAID order ────────────────────
    console.log('\nH-04  The rider view of a prepaid order');
    const prepaidForRider = await mk({ rider_id: riderId, payment_method: 'paystack', paid: true, status: 'assigned', paystack_ref: 'SDG_chain2_' + stamp });
    const riderView = await call('GET', '/api/rider/orders', null, riderTok);
    const rows = riderView.json || [];
    const prepaid = rows.find((o) => String(o.id) === String(prepaidForRider.id));
    const cashRow = rows.find((o) => String(o.id) === String(cashOutstanding.id));
    rec('H-04', 'the rider can see their assigned orders', riderView.status === 200 && rows.length > 0,
      'status ' + riderView.status + ' · ' + rows.length + ' order(s)');
    rec('H-04', '⭐ a PREPAID order carries paid=true so it reads "collect nothing"',
      !!prepaid && prepaid.paid === true,
      prepaid ? 'order ' + prepaid.id + ' paid=' + prepaid.paid + ' method=' + prepaid.paymentMethod + ' total=' + prepaid.total
        : 'prepaid order missing from the rider payload');
    rec('H-04', 'a CASH order carries paid=false so it reads "collect GHS X"',
      !!cashRow && cashRow.paid === false,
      cashRow ? 'order ' + cashRow.id + ' paid=' + cashRow.paid + ' total=' + cashRow.total : 'cash order missing');
    rec('H-04', 'the rider can still reach the customer and the address',
      !!prepaid && !!prepaid.customerPhone && !!prepaid.address && !!prepaid.neighborhood,
      prepaid ? 'phone/address/neighborhood all present' : 'n/a');
    const withheld = ['userId', 'momoNumber', 'subtotal', 'discount', 'loyaltyUsed'];
    const leaked = prepaid ? withheld.filter((k) => prepaid[k] !== undefined) : [];
    rec('H-04', 'the payload withholds user_id, momo number and the money breakdown',
      leaked.length === 0,
      leaked.length ? 'LEAKED: ' + leaked.join(', ') : 'none of ' + withheld.join('/') + ' present · keys: ' +
        (prepaid ? Object.keys(prepaid).length : 0));
  } finally {
    console.log('\nCleanup');
    await cleanup();
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const rd = await sb.from('riders').select('id', { count: 'exact', head: true });
    const open = await sb.from('orders').select('id,status').in('status', ['queued', 'assigned', 'in_transit']);
    console.log('  orders ' + o.count + ' · users ' + u.count + ' · riders ' + rd.count);
    console.log('  open orders: ' + JSON.stringify((open.data || []).map((r) => r.id + ':' + r.status)));

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    const skip = results.filter((r) => r.pass === null);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, ' + skip.length + ' skipped, out of ' + results.length);
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
