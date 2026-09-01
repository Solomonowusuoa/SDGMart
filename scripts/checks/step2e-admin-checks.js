/* SDGMart — the tier that needs admin and rider sessions.
 *
 * Mints a TEMPORARY admin and a TEMPORARY rider directly in the database and
 * issues each a session token, so no password is ever created, typed or stored,
 * and the real shared admin account is never touched. Both are deleted at the
 * end, along with everything they made.
 *
 * G-03  kill switches (ordering / online payment / loyalty redemption)
 * A-19  product photo upload rejects non-images
 * C-09  cart and catalogue prices are current
 * A-01  a rider cannot overwrite a customer's password
 * C-02  a rider cannot touch another rider's orders
 *
 * ⚠️ G-03 and C-09 mutate LIVE state (trading switches, one product price).
 * Both are reverted immediately and re-verified. Everything is restored in a
 * `finally`, so an exception mid-run still puts the shop back.
 *
 * Run: node scripts/checks/step2e-admin-checks.js
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
// A real 1x1 PNG, and a text file that merely claims to be one.
const PNG_1x1 = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const FAKE_JPG = Buffer.from('This is a text file that has simply been renamed to .jpg\n'.repeat(4), 'utf8');

(async () => {
  const stamp = Date.now();
  let adminId = null, adminTok = null;
  let riderAId = null, riderATok = null, riderBId = null, riderBTok = null;
  const switchKeys = ['ordering_enabled', 'online_payment_enabled', 'loyalty_redemption_enabled'];
  const switchesBefore = {};
  // Snapshot the WHOLE product row, not just the price. PUT /api/products/:id
  // replaces every field it accepts, so sending a partial body silently wipes
  // the rest. An earlier version of this script sent `stock: 0` and restored
  // only the price -- which left a real bestseller flagged out of stock and
  // de-listed as a bestseller until it was spotted three tests later.
  let pricedProduct = null, productSnapshot = null;
  // (no audit-log cleanup: KILL SWITCH rows are the record and stay)

  try {
    // ── Mint the temporary accounts ───────────────────────────────────────
    console.log('Setup — minting temporary admin + two riders (no passwords)');
    const admin = await sb.from('users').insert({
      name: 'Step2e Temp Admin', email: `sdgtest-admin-${stamp}@example.invalid`,
      password_hash: 'x-no-login-' + stamp,      // deliberately unusable
      role: 'admin', email_verified: true, must_change_password: false,
    }).select().single();
    if (admin.error) throw new Error('could not mint admin: ' + admin.error.message);
    adminId = admin.data.id;
    adminTok = await db.sessions.create(adminId, 'user');
    console.log('  admin id ' + adminId + ' (session minted, no password set)');

    for (const tag of ['A', 'B']) {
      const r = await sb.from('riders').insert({
        name: 'Step2e Rider ' + tag, email: `sdgtest-rider${tag.toLowerCase()}-${stamp}@example.invalid`,
        password_hash: 'x-no-login-' + stamp, phone: '0200000000', online: true,
      }).select().single();
      if (r.error) throw new Error('could not mint rider: ' + r.error.message);
      const tok = await db.sessions.create(r.data.id, 'rider');
      if (tag === 'A') { riderAId = r.data.id; riderATok = tok; } else { riderBId = r.data.id; riderBTok = tok; }
    }
    console.log('  riders ' + riderAId + ' and ' + riderBId);

    const whoami = await call('GET', '/api/admin/settings', null, adminTok);
    rec('setup', 'minted admin session is accepted by requireAdmin', whoami.status === 200,
      'GET /api/admin/settings → ' + whoami.status);
    if (whoami.status !== 200) throw new Error('admin session rejected; aborting before touching anything');
    for (const k of switchKeys) switchesBefore[k] = await db.appConfig.get(k);
    console.log('  switches before: ' + JSON.stringify(switchesBefore));

    // ── A-01 · a rider cannot overwrite a customer's password ─────────────
    console.log('\nA-01  Rider cannot reach customer password change');
    const riderPw = await call('POST', '/api/auth/change-password',
      { currentPassword: 'whatever', newPassword: 'Str0ng!Passw0rd42' }, riderATok);
    rec('A-01', "rider is refused at /api/auth/change-password", riderPw.status === 403,
      'status ' + riderPw.status + ' · ' + String(riderPw.json && riderPw.json.error).slice(0, 60));
    const riderMe = await call('GET', '/api/me/orders', null, riderATok);
    rec('A-01', 'rider is refused on customer /api/me/* routes', riderMe.status === 403,
      'GET /api/me/orders → ' + riderMe.status + ' · ' + String(riderMe.json && riderMe.json.error).slice(0, 50));

    // ── C-02 · a rider cannot touch another rider's orders ────────────────
    console.log("\nC-02  Rider cannot touch another rider's orders");
    const someOrder = await sb.from('orders').select('id, status, rider_id').limit(1).single();
    const before = someOrder.data.status;
    const steal = await call('POST', '/api/rider/orders/' + someOrder.data.id + '/status', { status: 'delivered' }, riderBTok);
    const afterRow = await sb.from('orders').select('status, rider_id').eq('id', someOrder.data.id).single();
    rec('C-02', "rider B cannot set status on an order that is not theirs",
      steal.status >= 400 && afterRow.data.status === before,
      'order ' + someOrder.data.id + ' (rider ' + someOrder.data.rider_id + ') · response ' + steal.status +
      ' ' + String(steal.json && steal.json.error).slice(0, 40) + ' · status ' + before + ' → ' + afterRow.data.status);
    rec('C-02', 'the order stays assigned to its original rider',
      String(afterRow.data.rider_id) === String(someOrder.data.rider_id),
      'rider_id ' + someOrder.data.rider_id + ' → ' + afterRow.data.rider_id);
    const badStatus = await call('POST', '/api/rider/orders/' + someOrder.data.id + '/status', { status: 'cancelled' }, riderATok);
    rec('C-02', 'an arbitrary status value is refused', badStatus.status === 400,
      'status=cancelled → ' + badStatus.status + ' · ' + String(badStatus.json && badStatus.json.error).slice(0, 40));

    // ── A-19 · photo upload rejects non-images ────────────────────────────
    console.log('\nA-19  Product photo upload');
    const okUp = await call('POST', '/api/admin/upload-image',
      { dataUrl: 'data:image/png;base64,' + PNG_1x1.toString('base64') }, adminTok);
    rec('A-19', 'a real PNG uploads', okUp.status === 200 && !!(okUp.json && okUp.json.url),
      'status ' + okUp.status + ' · ' + String((okUp.json && okUp.json.url) || okUp.text).slice(0, 80));
    const badUp = await call('POST', '/api/admin/upload-image',
      { dataUrl: 'data:image/jpeg;base64,' + FAKE_JPG.toString('base64') }, adminTok);
    rec('A-19', 'a .txt renamed to .jpg is rejected on its BYTES, not its declared type',
      badUp.status === 400, 'status ' + badUp.status + ' · ' + String(badUp.json && badUp.json.error).slice(0, 70));
    const anon = await call('POST', '/api/admin/upload-image',
      { dataUrl: 'data:image/png;base64,' + PNG_1x1.toString('base64') }, null);
    rec('A-19', 'upload requires admin', anon.status === 401 || anon.status === 403, 'unauthenticated → ' + anon.status);

    // ── C-09 · catalogue prices are current ───────────────────────────────
    console.log('\nC-09  Prices are current');
    const prod = await sb.from('products').select('id, name, price').order('id').limit(1).single();
    pricedProduct = prod.data.id;
    productSnapshot = (await sb.from('products').select('*').eq('id', pricedProduct).single()).data;
    const newPrice = Number((Number(originalPrice) + 3.21).toFixed(2));
    // Echo the product back unchanged except for the price under test.
    const upd = await call('PUT', '/api/products/' + pricedProduct, {
      name: productSnapshot.name, category: productSnapshot.category, price: newPrice,
      unit: productSnapshot.unit, stock: productSnapshot.stock,
      description: productSnapshot.description || '', bestBefore: productSnapshot.best_before,
      bestseller: productSnapshot.bestseller,
      lowStockThreshold: productSnapshot.low_stock_threshold,
    }, adminTok);
    const cat = await call('GET', '/api/catalog?ts=' + Date.now());
    const inCat = (cat.json && (cat.json.products || cat.json)) || [];
    const found = (Array.isArray(inCat) ? inCat : []).find((p) => String(p.id) === String(pricedProduct));
    rec('C-09', 'a price change is visible in /api/catalog immediately',
      !!found && Number(found.price) === newPrice,
      'set ' + originalPrice + ' → ' + newPrice + ' · catalogue says ' + (found ? found.price : 'product not found') +
      ' · update ' + upd.status);

    // ── G-03 · kill switches ──────────────────────────────────────────────
    console.log('\nG-03  Emergency kill switches   ⚠️ live shop briefly affected');
    const off = await call('POST', '/api/admin/settings',
      { orderingEnabled: false, onlinePaymentEnabled: false, loyaltyRedemptionEnabled: false }, adminTok);
    rec('G-03', 'all three switches turn off', off.status === 200, 'status ' + off.status);

    const orderWhileOff = await call('POST', '/api/orders', {
      items: [{ id: pricedProduct, qty: 1 }], name: 'Step2e check', phone: '0200000000',
      address: 'kill-switch check — must be refused', payMethod: 'cash',
    });
    rec('G-03', 'ordering off → checkout refused with a clear message, not an error',
      orderWhileOff.status === 503 && /paused new orders/i.test(orderWhileOff.text),
      'status ' + orderWhileOff.status + ' · ' + String(orderWhileOff.json && orderWhileOff.json.error).slice(0, 80));

    const payWhileOff = await call('POST', '/api/paystack/init', { items: [{ id: pricedProduct, qty: 1 }] }, null);
    rec('G-03', 'online payment off → Paystack init refused with a clear message',
      payWhileOff.status === 503 && /temporarily unavailable|paused/i.test(payWhileOff.text),
      'status ' + payWhileOff.status + ' · ' + String(payWhileOff.json && payWhileOff.json.error).slice(0, 80));

    const read = await call('GET', '/api/admin/settings', null, adminTok);
    rec('G-03', 'settings reflect all three as off',
      read.json && read.json.orderingEnabled === false && read.json.onlinePaymentEnabled === false &&
      read.json.loyaltyRedemptionEnabled === false,
      JSON.stringify({ ordering: read.json && read.json.orderingEnabled, payment: read.json && read.json.onlinePaymentEnabled, loyalty: read.json && read.json.loyaltyRedemptionEnabled }));

    // These rows are LEFT IN PLACE on purpose. The switch-off log is an audit
    // trail the audit deliberately added ("worth an audit trail"), and a test
    // that erases its own entries defeats the control it is meant to verify.
    // Three rows dated today, attributed to the temp admin id, are the correct
    // outcome — they record that the switches really were exercised.
    const logged = await sb.from('error_logs').select('id, message')
      .ilike('message', 'KILL SWITCH%').gte('created_at', new Date(Date.now() - 4 * 60000).toISOString());
    rec('G-03', 'each switch-off is recorded in Admin → Errors', (logged.data || []).length === 3,
      (logged.data || []).length + ' KILL SWITCH entries: ' + (logged.data || []).map((r) => r.message.replace('KILL SWITCH: ', '').split(' turned')[0]).join(', '));
  } finally {
    // ── Restore everything ────────────────────────────────────────────────
    console.log('\nRestore + cleanup');
    if (adminTok) {
      const back = await call('POST', '/api/admin/settings',
        { orderingEnabled: true, onlinePaymentEnabled: true, loyaltyRedemptionEnabled: true }, adminTok);
      console.log('  switches back on: ' + back.status);
      if (pricedProduct != null && productSnapshot) {
        // Restore every field, then prove it round-tripped rather than assuming.
        const { id, created_at: _c, updated_at: _u, ...restore } = productSnapshot;
        await sb.from('products').update(restore).eq('id', pricedProduct);
        const after = (await sb.from('products').select('*').eq('id', pricedProduct).single()).data;
        const drifted = Object.keys(restore).filter((k) => String(after[k]) !== String(productSnapshot[k]));
        console.log('  product ' + pricedProduct + ' restored in full' +
          (drifted.length ? '  *** STILL DIFFERS: ' + drifted.join(', ') + ' ***' : ' (all fields verified identical)'));
      }
    }
    for (const k of switchKeys) {
      const v = await db.appConfig.get(k);
      console.log('    ' + k + ' = ' + JSON.stringify(v) + (v === false ? '   *** STILL OFF ***' : ''));
    }
    console.log('  KILL SWITCH audit rows are left in place deliberately — they are the record');
    if (adminId) { await sb.from('sessions').delete().eq('user_id', adminId).eq('user_type', 'user'); await sb.from('users').delete().eq('id', adminId); }
    for (const rid of [riderAId, riderBId]) {
      if (rid) { await sb.from('sessions').delete().eq('user_id', rid).eq('user_type', 'rider'); await sb.from('riders').delete().eq('id', rid); }
    }
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const rr = await sb.from('riders').select('id', { count: 'exact', head: true });
    const oo = await sb.from('orders').select('id', { count: 'exact', head: true });
    const admins = await sb.from('users').select('id,email').eq('role', 'admin');
    console.log('  users ' + u.count + ' · riders ' + rr.count + ' · orders ' + oo.count);
    console.log('  admin accounts remaining: ' + (admins.data || []).length +
      ' (' + (admins.data || []).map((a) => a.email.replace(/(.{2}).*@/, '$1***@')).join(', ') + ')');

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length + ' checks');
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
