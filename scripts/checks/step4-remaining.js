/* SDGMart — the last tier reachable without a phone, a crash, or a rate-limit lockout.
 *
 * C-04  quantities and duplicates: 500 lines of one product collapse to one, capped at 99
 * C-09  checkout charges exactly what the catalogue quoted
 * B-13  one review per order
 * B-03  the supplier model: with own-stock mode OFF, a stock:0 product still sells
 *
 * G-03's remaining case (an already-paid order completes while ordering is off) is NOT
 * here: it needs extra.paid, which only the Paystack verify/webhook paths set. It is
 * covered in tests/order-flow.test.js against a stubbed database instead, where the
 * paid flag can be set directly without a real charge.
 *
 * Uses one throwaway customer and deletes every row it makes.
 * Run: node scripts/checks/step4-remaining.js  [--cleanup]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const MARK = 'STEP4 REMAINING TEST';
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
const delivery = (over = {}) => ({
  customer: MARK, phone: '0200000000', neighborhood: 'Tamale Central',
  address: 'STEP4 TEST — not a real delivery',
  location: { lat: 9.4034, lng: -0.8424, accuracy: 12, source: 'test' },
  ...over,
});
async function cleanup(verbose = true) {
  const o = await sb.from('orders').select('id').eq('customer_name', MARK);
  if (o.data && o.data.length) {
    await sb.from('reviews').delete().in('order_id', o.data.map((r) => r.id)).then(() => {}, () => {});
    await sb.from('orders').delete().in('id', o.data.map((r) => r.id));
    if (verbose) console.log('  deleted ' + o.data.length + ' test order(s): ' + o.data.map((r) => r.id).join(', '));
  } else if (verbose) console.log('  no test orders to delete');
  const u = await sb.from('users').select('id').ilike('email', 'sdgtest-step4-%');
  for (const x of (u.data || [])) {
    for (const t of ['reviews', 'addresses', 'sessions', 'recurring_orders', 'carts']) {
      await sb.from(t).delete().eq('user_id', x.id).then(() => {}, () => {});
    }
    await sb.from('users').delete().eq('id', x.id);
    if (verbose) console.log('  deleted test user ' + x.id);
  }
}

if (process.argv.includes('--cleanup')) {
  (async () => { console.log('Cleanup only:'); await cleanup(); })();
} else

(async () => {
  const stamp = Date.now();
  const EMAIL = `sdgtest-step4-${stamp}@example.com`;
  let token = null, userId = null;

  try {
    const su = await call('POST', '/api/auth/signup', {
      name: MARK, email: EMAIL, phone: '0200000000', password: 'Str0ng!Passw0rd42', acceptedTerms: true,
    });
    if (su.status !== 201) { console.error('signup failed ' + su.status + ' ' + su.text.slice(0, 160)); process.exit(1); }
    token = su.json.token; userId = su.json.user.id;
    console.log('throwaway customer ' + userId + '\n');

    // ── B-03 · the supplier model, with own-stock mode OFF ────────────────
    // The regression check for how the shop actually trades: it sells things it
    // does not hold, so stock 0 must NOT block an order while deduct_stock is off.
    console.log('B-03  Stock is ignored while sourcing from suppliers');
    const mode = await db.appConfig.get('deduct_stock');
    rec('B-03', 'own-stock mode is OFF (the supplier model)', !mode,
      'deduct_stock = ' + JSON.stringify(mode) + (mode ? '  *** ON — the rest of this section does not apply ***' : ' → falsy, so stock is advisory only'));

    const zeroProd = await sb.from('products').select('id, name, price, stock').order('id').limit(1).single();
    const restoreStock = zeroProd.data.stock;
    await sb.from('products').update({ stock: 0 }).eq('id', zeroProd.data.id);
    const soldOutOrder = await call('POST', '/api/orders', {
      items: [{ id: zeroProd.data.id, qty: 3 }], ...delivery(), payMethod: 'cash',
      clientRequestId: 'step4-stock0-' + stamp,
    }, token);
    const shelfAfter = (await sb.from('products').select('stock').eq('id', zeroProd.data.id).single()).data.stock;
    rec('B-03', 'a product with stock 0 still sells', soldOutOrder.status === 201,
      'product ' + zeroProd.data.id + ' stock 0 · order ' + (soldOutOrder.json && soldOutOrder.json.id) +
      ' · status ' + soldOutOrder.status + ' · ' + String((soldOutOrder.json && soldOutOrder.json.error) || '').slice(0, 60));
    rec('B-03', 'the shelf count is not touched by the sale', Number(shelfAfter) === 0,
      'stock stayed ' + shelfAfter + ' (own-stock mode off means no deduction)');
    await sb.from('products').update({ stock: restoreStock }).eq('id', zeroProd.data.id);
    const restored = (await sb.from('products').select('stock').eq('id', zeroProd.data.id).single()).data.stock;
    rec('B-03', 'test product restored', Number(restored) === Number(restoreStock),
      'product ' + zeroProd.data.id + ' stock back to ' + restored);

    // ── C-04 · quantities and duplicates ──────────────────────────────────
    console.log('\nC-04  Quantities and duplicates');
    const prod = await sb.from('products').select('id, name, price').gt('price', 1).order('id').limit(1).single();
    const many = Array.from({ length: 500 }, () => ({ id: prod.data.id, qty: 1 }));
    const capped = await call('POST', '/api/orders', {
      items: many, ...delivery(), payMethod: 'cash', clientRequestId: 'step4-cap-' + stamp,
    }, token);
    const cappedRow = capped.json && capped.json.id
      ? (await sb.from('orders').select('items, subtotal, total').eq('id', capped.json.id).single()).data : null;
    const lines = cappedRow ? (cappedRow.items || []) : [];
    rec('C-04', '500 lines of one product become ONE line', lines.length === 1,
      'order ' + (capped.json && capped.json.id) + ' has ' + lines.length + ' line(s) · status ' + capped.status);
    rec('C-04', 'the quantity is capped at 99, not 500', lines.length === 1 && Number(lines[0].qty) === 99,
      'qty = ' + (lines[0] && lines[0].qty) + ' (sent 500 lines of 1)');
    rec('C-04', 'the order still places rather than being refused', capped.status === 201,
      'status ' + capped.status);
    const expectSub = +(Number(prod.data.price) * 99).toFixed(2);
    rec('C-04', 'the total is priced off the capped quantity, not the requested one',
      cappedRow && Math.abs(Number(cappedRow.subtotal) - expectSub) < 0.01,
      'subtotal GHS ' + (cappedRow && cappedRow.subtotal) + ' · expected 99 × ' + prod.data.price + ' = ' + expectSub);

    // ── C-09 · checkout charges what the catalogue quoted ─────────────────
    console.log('\nC-09  Checkout charges what was quoted');
    const cat = await call('GET', '/api/catalog?ts=' + Date.now());
    const list = (cat.json && (cat.json.products || cat.json)) || [];
    const quoted = (Array.isArray(list) ? list : []).find((p) => String(p.id) === String(prod.data.id));
    const qty = 2;
    const order = await call('POST', '/api/orders', {
      items: [{ id: prod.data.id, qty }], ...delivery(), payMethod: 'cash',
      clientRequestId: 'step4-price-' + stamp,
    }, token);
    const row = order.json && order.json.id
      ? (await sb.from('orders').select('items, subtotal, delivery_fee, total, loyalty_used, discount').eq('id', order.json.id).single()).data : null;
    const expected = +(Number(quoted.price) * qty).toFixed(2);
    rec('C-09', 'the order subtotal equals the catalogue price × quantity',
      row && Math.abs(Number(row.subtotal) - expected) < 0.01,
      'catalogue GHS ' + (quoted && quoted.price) + ' × ' + qty + ' = ' + expected +
      ' · order subtotal GHS ' + (row && row.subtotal));
    rec('C-09', 'the stored line price matches the catalogue, not a stale copy',
      row && Math.abs(Number(row.items[0].price) - Number(quoted.price)) < 0.01,
      'line price GHS ' + (row && row.items[0].price) + ' vs catalogue GHS ' + (quoted && quoted.price));
    rec('C-09', 'the total is exactly subtotal + delivery − discounts, with nothing unexplained',
      row && Math.abs(Number(row.total) - (Number(row.subtotal) + Number(row.delivery_fee) - Number(row.discount || 0) - Number(row.loyalty_used || 0))) < 0.01,
      'total ' + (row && row.total) + ' = subtotal ' + (row && row.subtotal) + ' + delivery ' + (row && row.delivery_fee) +
      ' − discount ' + (row && (row.discount || 0)) + ' − loyalty ' + (row && (row.loyalty_used || 0)));

    // ── B-13 · one review per order ───────────────────────────────────────
    console.log('\nB-13  One review per order');
    const toReview = order.json.id;
    await sb.from('orders').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('id', toReview);
    const first = await call('POST', '/api/me/reviews', { orderId: toReview, rating: 5, message: 'step4 check' }, token);
    const second = await call('POST', '/api/me/reviews', { orderId: toReview, rating: 1, message: 'step4 duplicate' }, token);
    const stored = await sb.from('reviews').select('id, rating, message').eq('order_id', toReview);
    rec('B-13', 'rating a delivered order works', first.status < 400,
      'status ' + first.status + ' · ' + String((first.json && first.json.error) || 'accepted').slice(0, 60));
    rec('B-13', 'rating the SAME order again is refused', second.status >= 400,
      'status ' + second.status + ' · ' + String(second.json && second.json.error).slice(0, 70));
    rec('B-13', 'exactly one review row exists for that order', (stored.data || []).length === 1,
      (stored.data || []).length + ' review row(s) · rating ' + ((stored.data || [])[0] || {}).rating +
      ' (the duplicate would have overwritten it with 1 star)');
    const notMine = await sb.from('orders').select('id').neq('user_id', userId).not('user_id', 'is', null).limit(1).single();
    const foreign = await call('POST', '/api/me/reviews', { orderId: notMine.data.id, rating: 5, message: 'not mine' }, token);
    const foreignRows = await sb.from('reviews').select('id').eq('order_id', notMine.data.id);
    rec('B-13', "reviewing someone else's order is refused", foreign.status >= 400 && (foreignRows.data || []).length === 0,
      'order ' + notMine.data.id + ' → ' + foreign.status + ' · ' + String(foreign.json && foreign.json.error).slice(0, 50));
  } finally {
    console.log('\nCleanup');
    await cleanup();
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const zero = await sb.from('products').select('id, name').eq('stock', 0);
    const open = await sb.from('orders').select('id, status').in('status', ['queued', 'assigned', 'in_transit']);
    console.log('  orders ' + o.count + ' · users ' + u.count);
    console.log('  products left at stock 0: ' + ((zero.data || []).map((p) => p.id + ' ' + p.name).join(', ') || 'none'));
    console.log('  open orders: ' + JSON.stringify((open.data || []).map((r) => r.id + ':' + r.status)));

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length + ' checks');
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
