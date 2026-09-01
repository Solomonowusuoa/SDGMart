/* SDGMart — STEP 1 of the test plan: the money paths.
 *
 * Requires Paystack TEST keys on Render. Refuses to run against pk_live_.
 *
 * Uses one throwaway customer (deleted at the end) and places REAL order rows
 * against the live database — that is unavoidable for these checks. Every order
 * it creates is recorded and deleted in the `finally`, and the customer's
 * loyalty balance is restored, so the shop is left exactly as it was found.
 *
 * C-03/B-02  duplicate-order protection (idempotency key + concurrent double-tap)
 * A-02       loyalty cannot be spent twice
 * C-01       cancelling restores the credit it took
 * C-01       rewards accrue on DELIVERY, not checkout
 * C-07       Paystack reserves credit up front and releases it on abandon
 * E-01       the webhook returns non-2xx on failure so Paystack retries
 *
 * Run: node scripts/checks/step3-money-paths.js
 */
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO') + '  [' + id + '] ' + name +
    (detail ? '\n            ' + detail : ''));
}
async function call(method, p, body, token, extraHeaders) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(extraHeaders || {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  let t = ''; try { t = await r.text(); } catch (_) {}
  let j = null; try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, text: t, json: j };
}
const delivery = (over = {}) => ({
  customer: 'Step3 Money Path', phone: '0200000000',
  neighborhood: 'Tamale Central', address: 'MONEY-PATH TEST — not a real delivery',
  location: { lat: 9.4034, lng: -0.8424, accuracy: 12, source: 'test' },
  ...over,
});

// Recovery mode: `node scripts/checks/step3-money-paths.js --cleanup` removes any
// test rows a previous run left behind. A killed process skips the finally block,
// and leftover orders sit in `queued`, firing SLA alerts and skewing dashboards.
if (process.argv.includes('--cleanup')) {
  (async () => {
    const orders = await sb.from('orders').select('id, status').eq('customer_name', 'Step3 Money Path');
    if (orders.data && orders.data.length) {
      await sb.from('orders').delete().in('id', orders.data.map((o) => o.id));
      console.log('deleted ' + orders.data.length + ' leftover test order(s): ' + orders.data.map((o) => o.id).join(', '));
    } else console.log('no leftover test orders');
    const users = await sb.from('users').select('id, email').ilike('email', 'sdgtest-%');
    for (const u of (users.data || [])) {
      for (const t of ['addresses', 'sessions', 'recurring_orders', 'carts', 'reviews']) {
        await sb.from(t).delete().eq('user_id', u.id).then(() => {}, () => {});
      }
      await sb.from('users').delete().eq('id', u.id);
      console.log('deleted leftover test user ' + u.id);
    }
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const uc = await sb.from('users').select('id', { count: 'exact', head: true });
    const open = await sb.from('orders').select('id, status').in('status', ['queued', 'assigned', 'in_transit']);
    console.log('now: orders ' + o.count + ' · users ' + uc.count +
      ' · open ' + JSON.stringify((open.data || []).map((r) => r.id + ':' + r.status)));
  })();
} else

(async () => {
  const stamp = Date.now();
  // NOT @example.invalid: Paystack rejects the .invalid TLD outright
  // ("Invalid Email Address Passed"), which fails the init for a reason that has
  // nothing to do with the code under test. example.com is reserved for testing
  // and Paystack accepts it.
  const EMAIL = `sdgtest-money-${stamp}@example.com`;
  const PASSWORD = 'Str0ng!Passw0rd42';
  let token = null, userId = null;
  const madeOrders = [];
  const madeRefs = [];

  try {
    // ── Guard: refuse to touch the money path on live keys ────────────────
    const cfg = await call('GET', '/api/paystack/config');
    const pk = (cfg.json && cfg.json.publicKey) || '';
    console.log('Paystack public key mode: ' + (pk.slice(0, 8) || 'none'));
    if (!pk.startsWith('pk_test_')) {
      console.error('\nREFUSING TO RUN: public key is ' + pk.slice(0, 8) + '…, not pk_test_.');
      console.error('Swap Render to the Paystack TEST keys first. Every check below moves money.');
      process.exit(1);
    }
    rec('setup', 'Paystack is on TEST keys', true, pk.slice(0, 12) + '…');

    // ── Throwaway customer, with a known loyalty balance ──────────────────
    const su = await call('POST', '/api/auth/signup', {
      name: 'Step3 Money Path', email: EMAIL, phone: '0200000000',
      password: PASSWORD, acceptedTerms: true,
    });
    if (su.status !== 201) { console.error('signup failed: ' + su.status + ' ' + su.text.slice(0, 200)); process.exit(1); }
    token = su.json.token; userId = su.json.user.id;
    await sb.from('users').update({ loyalty_balance: 50 }).eq('id', userId);
    console.log('  throwaway customer id ' + userId + ', loyalty seeded to GHS 50\n');

    const prod = await sb.from('products').select('id, name, price').gt('price', 20).order('id').limit(1).single();
    const ITEM = { id: prod.data.id, qty: 1 };
    console.log('  using product ' + prod.data.id + ' "' + prod.data.name + '" @ GHS ' + prod.data.price + '\n');
    const balanceOf = async () => Number((await sb.from('users').select('loyalty_balance').eq('id', userId).single()).data.loyalty_balance);

    // ── B-02 · duplicate-order protection (idempotency key) ───────────────
    console.log('B-02  Duplicate-order protection');
    const key = 'step3-' + stamp;
    const body = { items: [ITEM], ...delivery(), payMethod: 'cash', clientRequestId: key };
    const first = await call('POST', '/api/orders', body, token);
    if (first.json && first.json.id) madeOrders.push(first.json.id);
    const second = await call('POST', '/api/orders', body, token);
    if (second.json && second.json.id && !madeOrders.includes(second.json.id)) madeOrders.push(second.json.id);
    rec('B-02', 'first order is created', first.status === 201 && !!(first.json && first.json.id),
      'status ' + first.status + ' · order ' + (first.json && first.json.id));
    rec('B-02', 'the same clientRequestId returns the SAME order, not a second one',
      !!(second.json && first.json && String(second.json.id) === String(first.json.id)),
      'first ' + (first.json && first.json.id) + ' · retry ' + (second.json && second.json.id) +
      ' · status ' + second.status);

    // Concurrent double-tap: five at once on one fresh key.
    const key2 = 'step3-concurrent-' + stamp;
    const body2 = { items: [ITEM], ...delivery(), payMethod: 'cash', clientRequestId: key2 };
    const burst = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/orders', body2, token)));
    const ids = [...new Set(burst.map((r) => r.json && r.json.id).filter(Boolean))];
    for (const id of ids) if (!madeOrders.includes(id)) madeOrders.push(id);
    rec('B-02', 'five concurrent submits produce exactly ONE order', ids.length === 1,
      'distinct order ids: ' + JSON.stringify(ids) + ' · statuses ' + burst.map((r) => r.status).join(','));

    // ── A-02 · loyalty cannot be spent twice ──────────────────────────────
    console.log('\nA-02  Loyalty cannot be spent twice');
    await sb.from('users').update({ loyalty_balance: 50 }).eq('id', userId);
    const startBal = await balanceOf();
    const spend = (k) => ({ items: [ITEM], ...delivery(), payMethod: 'cash', useLoyalty: 50, loyaltyUsed: 50, clientRequestId: k });
    const two = await Promise.all([
      call('POST', '/api/orders', spend('step3-loy-a-' + stamp), token),
      call('POST', '/api/orders', spend('step3-loy-b-' + stamp), token),
    ]);
    for (const r of two) if (r.json && r.json.id) madeOrders.push(r.json.id);
    const endBal = await balanceOf();
    const orderRows = await sb.from('orders').select('id, loyalty_used, total').in('id', two.map((r) => r.json && r.json.id).filter(Boolean));
    const totalSpent = (orderRows.data || []).reduce((s, o) => s + Number(o.loyalty_used || 0), 0);
    rec('A-02', 'balance never goes negative', endBal >= 0, 'balance ' + startBal + ' → ' + endBal);
    rec('A-02', 'total loyalty consumed is at most the starting balance', totalSpent <= startBal,
      'consumed ' + totalSpent + ' of ' + startBal + ' across orders ' +
      JSON.stringify((orderRows.data || []).map((o) => ({ id: o.id, used: o.loyalty_used }))));

    // ── C-01 · cancelling restores the credit it took ─────────────────────
    console.log('\nC-01  Cancelling restores what it took');
    await sb.from('users').update({ loyalty_balance: 20 }).eq('id', userId);
    const beforeCancel = await balanceOf();
    const toCancel = await call('POST', '/api/orders',
      { items: [ITEM], ...delivery(), payMethod: 'cash', useLoyalty: 20, loyaltyUsed: 20, clientRequestId: 'step3-cancel-' + stamp }, token);
    if (toCancel.json && toCancel.json.id) madeOrders.push(toCancel.json.id);
    const afterPlace = await balanceOf();
    const cancelRes = await call('POST', '/api/me/orders/' + (toCancel.json && toCancel.json.id) + '/cancel', { reason: 'step3 check' }, token);
    const afterCancel = await balanceOf();
    const row = await sb.from('orders').select('status, loyalty_used').eq('id', toCancel.json && toCancel.json.id).single();
    rec('C-01', 'placing an order takes the credit', afterPlace < beforeCancel,
      'balance ' + beforeCancel + ' → ' + afterPlace + ' (order used ' + (row.data && row.data.loyalty_used) + ')');
    rec('C-01', 'cancelling inside the window gives it back exactly', afterCancel === beforeCancel,
      'balance ' + afterPlace + ' → ' + afterCancel + ' (started at ' + beforeCancel + ') · cancel ' + cancelRes.status +
      ' · order now ' + (row.data && row.data.status));

    // ── C-01 · rewards accrue on DELIVERY, not checkout ───────────────────
    console.log('\nC-01  Rewards land on delivery, not checkout');
    await sb.from('users').update({ loyalty_balance: 0, total_spent: 0 }).eq('id', userId);
    const bigItem = { id: prod.data.id, qty: 40 };
    const big = await call('POST', '/api/orders',
      { items: [bigItem], ...delivery(), payMethod: 'cash', clientRequestId: 'step3-reward-' + stamp }, token);
    if (big.json && big.json.id) madeOrders.push(big.json.id);
    const afterBigOrder = await balanceOf();
    rec('C-01', 'a large order does NOT credit loyalty at checkout', afterBigOrder === 0,
      'order ' + (big.json && big.json.id) + ' total GHS ' + (big.json && big.json.total) + ' · balance = ' + afterBigOrder);
    // Mark delivered the way a rider would, then look again.
    await db.orders.setStatus(big.json.id, 'delivered', null).catch(async () => {
      await sb.from('orders').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('id', big.json.id);
    });
    await new Promise((r) => setTimeout(r, 1200));
    const afterDelivered = await balanceOf();
    rec('C-01', 'loyalty is credited once the order is DELIVERED', afterDelivered > afterBigOrder,
      'balance ' + afterBigOrder + ' → ' + afterDelivered + ' after marking delivered');

    // ── C-07 · Paystack reserves credit up front, releases on abandon ─────
    console.log('\nC-07  Paystack reserves credit up front');
    await sb.from('users').update({ loyalty_balance: 30 }).eq('id', userId);
    const beforeInit = await balanceOf();
    const init = await call('POST', '/api/paystack/init',
      { email: EMAIL, draft: { items: [ITEM], ...delivery(), useLoyalty: 30, loyaltyUsed: 30 } }, token);
    if (init.json && init.json.reference) madeRefs.push(init.json.reference);
    const afterInit = await balanceOf();
    rec('C-07', 'the SECRET key is valid — Paystack accepted the initialize call',
      init.status === 200 && !!(init.json && init.json.accessCode),
      'status ' + init.status + ' · ref ' + (init.json && init.json.reference) + ' · ' +
      String((init.json && init.json.error) || '').slice(0, 60));
    rec('C-07', 'credit is reserved BEFORE the payment popup', afterInit < beforeInit,
      'balance ' + beforeInit + ' → ' + afterInit);
    const pend = await sb.from('pending_payments').select('reference, draft').eq('reference', init.json && init.json.reference).maybeSingle();
    rec('C-07', 'the draft is stored with the reservation flagged',
      !!(pend.data && pend.data.draft && pend.data.draft._reserved),
      pend.data ? '_reserved = ' + JSON.stringify(pend.data.draft._reserved) : 'no pending_payments row');

    // Abandon it. NOTE: the release is NOT immediate — releaseStaleReservations()
    // uses listStaleForUser(userId, 30), so it only reclaims drafts older than 30
    // MINUTES. That is deliberate: releasing instantly would hand the credit back
    // while the customer still has the Paystack popup open and could still pay.
    // So an immediate second init must NOT release, and one after the window must.
    const immediate = await call('POST', '/api/paystack/init',
      { email: EMAIL, draft: { items: [ITEM], ...delivery() } }, token);
    if (immediate.json && immediate.json.reference) madeRefs.push(immediate.json.reference);
    const afterImmediate = await balanceOf();
    rec('C-07', 'credit is NOT released while the popup could still be open (<30 min)',
      afterImmediate === afterInit,
      'balance stayed ' + afterImmediate + ' — correct, the first payment may still complete');

    // Age the abandoned draft past the window and try again.
    await sb.from('pending_payments')
      .update({ created_at: new Date(Date.now() - 31 * 60000).toISOString() })
      .eq('reference', init.json.reference);
    const afterWindow = await call('POST', '/api/paystack/init',
      { email: EMAIL, draft: { items: [ITEM], ...delivery() } }, token);
    if (afterWindow.json && afterWindow.json.reference) madeRefs.push(afterWindow.json.reference);
    const afterRelease = await balanceOf();
    const goneRow = await sb.from('pending_payments').select('reference').eq('reference', init.json.reference).maybeSingle();
    rec('C-07', 'once past the 30-minute window, returning to checkout releases the credit',
      afterRelease > afterImmediate,
      'balance ' + afterImmediate + ' → ' + afterRelease + ' · abandoned draft row ' +
      (goneRow.data ? 'STILL PRESENT' : 'cleaned up'));

    // ── E-01 · the webhook must NOT answer 200 on failure ─────────────────
    console.log('\nE-01  Webhook retries instead of giving up');
    const junk = JSON.stringify({ event: 'charge.success', data: { reference: 'SDG_does_not_exist_' + stamp, amount: 100 } });
    const unsigned = await call('POST', '/api/paystack/webhook', junk, null);
    rec('E-01', 'an UNSIGNED webhook is rejected', unsigned.status >= 400,
      'status ' + unsigned.status + ' · ' + unsigned.text.slice(0, 60));
    const badSig = await call('POST', '/api/paystack/webhook', junk, null, { 'x-paystack-signature': 'deadbeef' });
    rec('E-01', 'a webhook with a BAD signature is rejected', badSig.status >= 400,
      'status ' + badSig.status + ' · ' + badSig.text.slice(0, 60));
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────
    console.log('\nCleanup');
    if (madeOrders.length) {
      await sb.from('orders').delete().in('id', madeOrders);
      console.log('  deleted ' + madeOrders.length + ' test order(s): ' + madeOrders.join(', '));
    }
    if (madeRefs.length) {
      await sb.from('pending_payments').delete().in('reference', madeRefs);
      console.log('  deleted ' + madeRefs.length + ' pending_payment draft(s)');
    }
    if (userId) {
      for (const t of ['addresses', 'sessions', 'recurring_orders', 'carts', 'reviews']) {
        await sb.from(t).delete().eq('user_id', userId).then(() => {}, () => {});
      }
      await sb.from('users').delete().eq('id', userId);
    }
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const pp = await sb.from('pending_payments').select('reference', { count: 'exact', head: true });
    const open = await sb.from('orders').select('id,status').in('status', ['queued', 'assigned', 'in_transit']);
    console.log('  orders ' + o.count + ' · users ' + u.count + ' · pending_payments ' + pp.count);
    console.log('  still-open orders: ' + JSON.stringify((open.data || []).map((r) => r.id + ':' + r.status)));

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length + ' checks');
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
