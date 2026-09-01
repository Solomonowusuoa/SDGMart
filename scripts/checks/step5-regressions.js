/* SDGMart — STEP 5 regression sweep, plus the leftovers that needed no device.
 *
 * "Things that were working and must still work" after a session of fixes.
 * Everything here runs against live sdg-mart.com with throwaway accounts and
 * deletes what it makes.
 *
 * Not covered, and honestly so:
 *   - Google sign-in    : needs a real Google account and consent screen
 *   - Push notifications: needs a real device to hold the subscription
 * Both are marked SKIP rather than quietly passed.
 *
 * Run: node scripts/checks/step5-regressions.js  [--cleanup]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const MARK = 'STEP5 REGRESSION';
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  const tag = pass === true ? 'PASS' : pass === false ? 'FAIL' : pass === null ? 'SKIP' : 'INFO';
  console.log('  ' + tag + '  [' + id + '] ' + name + (detail ? '\n            ' + detail : ''));
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
const delivery = (over = {}) => ({
  customer: MARK, phone: '0200000000', neighborhood: 'Tamale Central',
  address: 'STEP5 TEST — not a real delivery',
  location: { lat: 9.4034, lng: -0.8424, accuracy: 12, source: 'test' },
  ...over,
});
async function cleanup(verbose = true) {
  const o = await sb.from('orders').select('id').eq('customer_name', MARK);
  if (o.data && o.data.length) {
    await sb.from('reviews').delete().in('order_id', o.data.map((r) => r.id)).then(() => {}, () => {});
    await sb.from('orders').delete().in('id', o.data.map((r) => r.id));
    if (verbose) console.log('  deleted ' + o.data.length + ' order(s): ' + o.data.map((r) => r.id).join(', '));
  } else if (verbose) console.log('  no test orders');
  for (const [tbl, col] of [['users', 'email'], ['riders', 'email']]) {
    const rows = await sb.from(tbl).select('id').ilike(col, 'sdgtest-step5-%');
    for (const x of (rows.data || [])) {
      const ut = tbl === 'riders' ? 'rider' : 'user';
      await sb.from('sessions').delete().eq('user_id', x.id).eq('user_type', ut);
      if (tbl === 'users') for (const t of ['reviews', 'addresses', 'recurring_orders', 'carts']) {
        await sb.from(t).delete().eq('user_id', x.id).then(() => {}, () => {});
      }
      await sb.from(tbl).delete().eq('id', x.id);
      if (verbose) console.log('  deleted ' + tbl.slice(0, -1) + ' ' + x.id);
    }
  }
  const p = await sb.from('products').select('id').eq('name', MARK + ' PRODUCT');
  if (p.data && p.data.length) {
    await sb.from('products').delete().in('id', p.data.map((r) => r.id));
    if (verbose) console.log('  deleted ' + p.data.length + ' test product(s)');
  }
}

if (process.argv.includes('--cleanup')) {
  (async () => { console.log('Cleanup only:'); await cleanup(); })();
} else

(async () => {
  const stamp = Date.now();
  const EMAIL = `sdgtest-step5-${stamp}@example.com`;
  const PW = 'Str0ng!Passw0rd42';
  let token = null, userId = null, adminId = null, adminTok = null, riderId = null, riderTok = null;

  try {
    // ── Sign up, sign in, sign out ────────────────────────────────────────
    console.log('STEP 5  Sign up / sign in / sign out');
    const su = await call('POST', '/api/auth/signup', { name: MARK, email: EMAIL, phone: '0200000000', password: PW, acceptedTerms: true });
    userId = su.json && su.json.user && su.json.user.id;
    rec('S5', 'sign up creates an account and issues a session', su.status === 201 && !!(su.json && su.json.token),
      'status ' + su.status + ' · user ' + userId);
    const li = await call('POST', '/api/auth/login', { email: EMAIL, password: PW });
    token = li.json && li.json.token;
    rec('S5', 'sign in works', li.status === 200 && !!token, 'status ' + li.status);
    const me = await call('GET', '/api/auth/me', null, token);
    rec('S5', 'the session identifies the right account', me.status === 200 && String(me.json.id) === String(userId),
      'GET /api/auth/me → ' + me.status + ' · id ' + (me.json && me.json.id));
    const out = await call('POST', '/api/auth/logout', {}, token);
    const afterOut = await call('GET', '/api/auth/me', null, token);
    rec('S5', 'sign out invalidates the session', out.status < 400 && afterOut.status >= 400,
      'logout ' + out.status + ' · reusing the token afterwards → ' + afterOut.status);
    const li2 = await call('POST', '/api/auth/login', { email: EMAIL, password: PW });
    token = li2.json.token;
    rec('S5', 'a wrong password is refused', (await call('POST', '/api/auth/login', { email: EMAIL, password: 'wrong-' + stamp })).status >= 400, 'refused');
    rec('S5', 'Google sign-in', null, 'SKIPPED — needs a real Google account and consent screen');

    // ── Saved addresses: add, edit, set default ───────────────────────────
    console.log('\nSTEP 5  Saved addresses');
    const a1 = await call('POST', '/api/me/addresses', { label: 'Home', neighborhood: 'Tamale Central', address: 'First address', isDefault: true }, token);
    const a2 = await call('POST', '/api/me/addresses', { label: 'Work', neighborhood: 'Kalpohin', address: 'Second address' }, token);
    rec('S5', 'add an address', a1.status < 400 && !!(a1.json && a1.json.id), 'id ' + (a1.json && a1.json.id));
    const ed = await call('PUT', '/api/me/addresses/' + a1.json.id, { address: 'First address (edited)' }, token);
    const edRow = (await sb.from('addresses').select('address').eq('id', a1.json.id).single()).data;
    rec('S5', 'edit an address', ed.status < 400 && /edited/.test(edRow.address), 'now: ' + edRow.address);
    await call('PUT', '/api/me/addresses/' + a2.json.id, { isDefault: true }, token);
    const defaults = await sb.from('addresses').select('id, is_default').eq('user_id', userId);
    const nDefault = (defaults.data || []).filter((d) => d.is_default).length;
    rec('S5', 'set default moves the flag, leaving exactly one', nDefault === 1,
      (defaults.data || []).map((d) => d.id + (d.is_default ? '=DEFAULT' : '')).join(', '));

    // ── Guest checkout end to end + tracking code ─────────────────────────
    console.log('\nSTEP 5  Guest checkout and the tracking code');
    const prod = await sb.from('products').select('id, price').gt('price', 1).order('id').limit(1).single();
    const guest = await call('POST', '/api/orders', {
      items: [{ id: prod.data.id, qty: 1 }], ...delivery(), payMethod: 'cash', clientRequestId: 'step5-guest-' + stamp,
    });
    rec('S5', 'a guest can place an order without an account', guest.status === 201, 'order ' + (guest.json && guest.json.id) + ' · status ' + guest.status);
    const tk = guest.json && guest.json.trackToken;
    rec('S5', 'the order comes back with a tracking token', !!tk, tk ? tk.slice(0, 10) + '…' : 'MISSING');
    const track = await call('GET', '/api/orders/' + guest.json.id + '/tracking?t=' + encodeURIComponent(tk));
    rec('S5', 'the tracking link resolves for a guest', track.status === 200,
      'status ' + track.status + ' · order status ' + (track.json && track.json.order && track.json.order.status));
    const badTrack = await call('GET', '/api/orders/' + guest.json.id + '/tracking?t=wrong' + stamp);
    rec('S5', 'a wrong tracking token is refused', badTrack.status >= 400, 'status ' + badTrack.status);

    // ── Admin: create product, upload photo, assign rider ─────────────────
    console.log('\nSTEP 5  Admin: create product, upload photo, assign rider');
    const ad = await sb.from('users').insert({
      name: 'Step5 Admin', email: `sdgtest-step5-admin-${stamp}@example.invalid`,
      password_hash: 'x-no-login', role: 'admin', email_verified: true, must_change_password: false,
    }).select().single();
    adminId = ad.data.id; adminTok = await db.sessions.create(adminId, 'user');
    const rd = await sb.from('riders').insert({
      name: 'Step5 Rider', email: `sdgtest-step5-rider-${stamp}@example.invalid`,
      password_hash: 'x-no-login', phone: '0200000000', online: false,
    }).select().single();
    riderId = rd.data.id; riderTok = await db.sessions.create(riderId, 'rider');

    const np = await call('POST', '/api/products', {
      name: MARK + ' PRODUCT', category: 'Rice & Grains', price: 12.34, unit: 'each', stock: 25,
    }, adminTok);
    rec('S5', 'admin can create a product', np.status < 400 && !!(np.json && np.json.id),
      'product ' + (np.json && np.json.id) + ' · status ' + np.status);
    const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' +
      '01f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
    const up = await call('POST', '/api/admin/upload-image', { dataUrl: 'data:image/png;base64,' + PNG.toString('base64') }, adminTok);
    rec('S5', 'admin can upload a product photo', up.status === 200 && !!(up.json && up.json.url), 'status ' + up.status);
    if (up.json && up.json.url) {
      const name = String(up.json.url).split('/').pop();
      await sb.storage.from('product-photos').remove([name]).then(() => {}, () => {});
    }
    const assign = await call('POST', '/api/admin/orders/' + guest.json.id + '/assign', { riderId }, adminTok);
    const assigned = (await sb.from('orders').select('rider_id, status').eq('id', guest.json.id).single()).data;
    rec('S5', 'admin can assign an order to a rider', assign.status < 400 && String(assigned.rider_id) === String(riderId),
      'order ' + guest.json.id + ' → rider ' + assigned.rider_id + ' · status ' + assigned.status);

    // ── Rider: go online, see orders, in_transit then delivered ───────────
    console.log('\nSTEP 5  Rider: online → sees the order → in transit → delivered');
    const online = await call('POST', '/api/rider/online', { online: true }, riderTok);
    const isOnline = (await sb.from('riders').select('online').eq('id', riderId).single()).data.online;
    rec('S5', 'rider can go online', online.status < 400 && isOnline === true, 'online = ' + isOnline);
    const mine = await call('GET', '/api/rider/orders', null, riderTok);
    rec('S5', 'rider sees their assigned order', mine.status === 200 && (mine.json || []).some((o) => String(o.id) === String(guest.json.id)),
      (mine.json || []).length + ' order(s) listed');
    const t1 = await call('POST', '/api/rider/orders/' + guest.json.id + '/status', { status: 'in_transit' }, riderTok);
    const s1 = (await sb.from('orders').select('status').eq('id', guest.json.id).single()).data.status;
    rec('S5', 'rider can mark in transit', t1.status < 400 && s1 === 'in_transit', 'status → ' + s1);
    const t2 = await call('POST', '/api/rider/orders/' + guest.json.id + '/status', { status: 'delivered' }, riderTok);
    const s2 = (await sb.from('orders').select('status, delivered_at').eq('id', guest.json.id).single()).data;
    rec('S5', 'rider can mark delivered, and delivered_at is stamped', t2.status < 400 && s2.status === 'delivered' && !!s2.delivered_at,
      'status → ' + s2.status + ' · delivered_at ' + String(s2.delivered_at).slice(0, 19));
    rec('S5', 'push notifications arrive', null, 'SKIPPED — needs a real device holding the push subscription');

    // ── Squad and referral pages ──────────────────────────────────────────
    console.log('\nSTEP 5  Squad and referral data');
    const sq = await call('GET', '/api/squads/' + userId, null, token);
    rec('S5', 'the squad endpoint returns this account\'s squad', sq.status === 200 && !!(sq.json && sq.json.members),
      'status ' + sq.status + ' · ' + ((sq.json && sq.json.members) || []).length + ' member(s) · goal ' + (sq.json && sq.json.goal));
    const lb = await call('GET', '/api/leaderboard');
    rec('S5', 'the referral leaderboard renders', lb.status === 200 && (Array.isArray(lb.json) || typeof lb.json === 'object'),
      'status ' + lb.status);

    // ── C-01 leftovers ────────────────────────────────────────────────────
    console.log('\nC-01  Cancel restores the first-order perk, and earns no credit');
    await sb.from('users').update({ first_order_done: false, loyalty_balance: 0, lifetime_spent: 0, total_spent: 0 }).eq('id', userId);
    // The perk only applies at FIRST_ORDER_FREE_MIN (GHS 50) or above -- an
    // earlier version of this test ordered GHS 5.50 and read the perk correctly
    // NOT being claimed as a failure. Size the basket past the threshold.
    const perkQty = Math.max(1, Math.ceil(60 / Number(prod.data.price)));
    const o1 = await call('POST', '/api/orders', {
      items: [{ id: prod.data.id, qty: perkQty }], ...delivery(), payMethod: 'cash', clientRequestId: 'step5-perk-' + stamp,
    }, token);
    console.log('            (basket ' + perkQty + ' x GHS ' + prod.data.price + ' = GHS ' +
      (perkQty * Number(prod.data.price)).toFixed(2) + ', above the GHS 50 perk threshold)');
    const afterPlace = (await sb.from('users').select('first_order_done').eq('id', userId).single()).data.first_order_done;
    await call('POST', '/api/me/orders/' + o1.json.id + '/cancel', { reason: 'step5' }, token);
    const afterCancel = (await sb.from('users').select('first_order_done, loyalty_balance').eq('id', userId).single()).data;
    rec('C-01', 'the first-order perk is claimed when the order is placed', afterPlace === true, 'first_order_done = ' + afterPlace);
    rec('C-01', 'cancelling releases the perk so it is available again', afterCancel.first_order_done === false,
      'first_order_done ' + afterPlace + ' → ' + afterCancel.first_order_done);
    rec('C-01', 'a cancelled order earns NO loyalty credit', Number(afterCancel.loyalty_balance) === 0,
      'balance = ' + afterCancel.loyalty_balance + ' (this was the free-money loop)');

    // ── B-11 · the admin day matches Accra, not UTC ───────────────────────
    console.log('\nB-11  The admin day is the shop\'s day');
    const accra = db.businessDate();
    const rev = await call('GET', '/api/admin/revenue', null, adminTok);
    rec('B-11', 'the revenue screen defaults to the Accra business date, not UTC',
      rev.status === 200 && rev.json && rev.json.date === accra,
      'endpoint says ' + (rev.json && rev.json.date) + ' · businessDate() says ' + accra +
      ' · this machine (UTC) says ' + new Date().toISOString().slice(0, 10));

    // ── B-10 · an existing recurring order actually runs ──────────────────
    console.log('\nB-10  A due recurring order actually places');
    const today = db.businessDate();
    const mkRec = await call('POST', '/api/me/recurring', {
      items: [{ id: prod.data.id, qty: 1 }], cadenceDays: 7, nextRunAt: today,
      deliveryInfo: delivery(),
    }, token);
    rec('B-10', 'a recurring order can be created for today', mkRec.status < 400 && !!(mkRec.json && mkRec.json.id),
      'row ' + (mkRec.json && mkRec.json.id) + ' · next_run_at ' + (mkRec.json && mkRec.json.nextRunAt));
    // Force the daily job to run again today, then trigger it.
    await sb.from('app_config').update({ value: '1970-01-01' }).eq('key', 'daily_job_last_run');
    const before = (await sb.from('orders').select('id', { count: 'exact', head: true })).count;
    await fetch(BASE + '/healthz');
    await new Promise((r) => setTimeout(r, 9000));
    const after = (await sb.from('orders').select('id', { count: 'exact', head: true })).count;
    const recRow = (await sb.from('recurring_orders').select('next_run_at, active').eq('id', mkRec.json.id).single()).data;
    const marker = (await sb.from('app_config').select('value').eq('key', 'daily_job_last_run').single()).data.value;
    rec('B-10', 'the daily job ran', String(marker).includes(today), 'daily_job_last_run = ' + JSON.stringify(marker));
    rec('B-10', 'the due recurring order placed an order', after > before, 'orders ' + before + ' → ' + after);
    rec('B-10', 'next_run_at advanced by the cadence', recRow && recRow.next_run_at !== today,
      'next_run_at ' + today + ' → ' + (recRow && recRow.next_run_at) + ' (cadence 7)');
    await sb.from('recurring_orders').delete().eq('id', mkRec.json.id);
    // Anything the cron placed belongs to this user — sweep it.
    const cronOrders = await sb.from('orders').select('id').eq('user_id', userId);
    if (cronOrders.data && cronOrders.data.length) {
      await sb.from('orders').delete().in('id', cronOrders.data.map((r) => r.id));
      console.log('            (removed ' + cronOrders.data.length + ' order(s) belonging to the test account)');
    }
  } finally {
    console.log('\nCleanup');
    await cleanup();
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const r = await sb.from('riders').select('id', { count: 'exact', head: true });
    const pr = await sb.from('products').select('id', { count: 'exact', head: true });
    const open = await sb.from('orders').select('id, status').in('status', ['queued', 'assigned', 'in_transit']);
    console.log('  orders ' + o.count + ' · users ' + u.count + ' · riders ' + r.count + ' · products ' + pr.count);
    console.log('  open orders: ' + JSON.stringify((open.data || []).map((x) => x.id + ':' + x.status)));

    const pass = results.filter((x) => x.pass === true).length;
    const fail = results.filter((x) => x.pass === false);
    const skip = results.filter((x) => x.pass === null);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, ' + skip.length + ' skipped, out of ' + results.length);
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
