/* SDGMart — STEP 10: stock reservations (C-10).
 *
 * The five SQL functions in supabase-schema-stock-holds.sql had never executed
 * anywhere. This runs them, then runs the four behaviours that only appear once
 * own-stock mode is ON.
 *
 *   1280  a hold lowers `available` but never `on_shelf`
 *   1281  releasing restores it
 *   1282  over-holding is refused rather than going negative
 *   1283  commit_stock_hold lowers on_shelf and clears the hold
 *   1284  restock_items puts it back
 *   1287  one unit left: the first order gets it, the second is refused by name
 *   1289  an abandoned checkout's hold expires and the stock is sellable again
 *   1290  a cancelled cash order returns its stock
 *   1291  own-stock mode back OFF -> a stock:0 product sells again (the model
 *         the live shop actually runs on; if this breaks, stop)
 *
 * ⚠️ THIS WRITES TO WHATEVER DATABASE .env POINTS AT, and section B turns
 * own-stock mode ON for the duration. It is meant for staging. It is safe on a
 * live shop only when every product has healthy stock (nothing becomes
 * unsellable) and someone is watching. It restores the toggle and the product
 * in a `finally`, and re-asserts both at the end.
 *
 * Acts on ONE product id, passed explicitly — never one it chose itself, which
 * is the rule that came out of the v96 incident.
 *
 * Run:  node scripts/checks/step10-stock-reservations.js <productId>
 *       node scripts/checks/step10-stock-reservations.js <productId> --cleanup
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const MARK = 'STEP10 STOCK TEST';
const HOLD_A = 'step10-hold-a';
const HOLD_B = 'step10-hold-b';

const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO') + '  [' + id + '] ' + name +
    (detail ? '\n            ' + detail : ''));
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(fn + ': ' + error.message);
  return data;
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
const avail = async (id) => {
  const rows = await rpc('stock_available', { p_ids: [Number(id)] });
  const r = (rows || [])[0] || {};
  return { onShelf: Number(r.on_shelf || 0), held: Number(r.held || 0), available: Number(r.available || 0) };
};

const PID = Number(process.argv[2]);
const CLEANUP_ONLY = process.argv.includes('--cleanup');

// Everything this run creates, so the finally can undo it even on a crash.
const made = { orders: [], holds: [HOLD_A, HOLD_B], userId: null, token: null };
let ORIGINAL = null;          // the product row as we found it
let TOGGLE_EXISTED = null;    // whether app_config had a deduct_stock row at all
let TOGGLE_BEFORE = null;

async function readToggle() {
  const { data } = await sb.from('app_config').select('key, value').eq('key', 'deduct_stock');
  return (data && data.length) ? { existed: true, value: data[0].value } : { existed: false, value: null };
}
async function setToggle(on) {
  await sb.from('app_config').upsert({ key: 'deduct_stock', value: on });
}
async function restoreToggle() {
  if (TOGGLE_EXISTED === false) await sb.from('app_config').delete().eq('key', 'deduct_stock');
  else if (TOGGLE_EXISTED === true) await sb.from('app_config').upsert({ key: 'deduct_stock', value: TOGGLE_BEFORE });
}

async function cleanup() {
  console.log('\n── cleanup ──');
  for (const k of made.holds) {
    try { await rpc('release_stock_hold', { p_hold_key: k }); } catch (_) {}
  }
  const { data: leftover } = await sb.from('orders').select('id').eq('customer', MARK);
  const ids = [...new Set([...(leftover || []).map(o => o.id), ...made.orders])];
  for (const id of ids) {
    try { await sb.from('orders').delete().eq('id', id); console.log('  removed order', id); } catch (_) {}
  }
  if (made.userId) {
    try {
      await sb.from('sessions').delete().eq('user_id', made.userId);
      await sb.from('users').delete().eq('id', made.userId);
      console.log('  removed throwaway customer', made.userId);
    } catch (e) { console.log('  could not remove customer', made.userId, e.message); }
  }
  await restoreToggle();
  const after = await readToggle();
  console.log('  deduct_stock now:', after.existed ? JSON.stringify(after.value) : '(absent — OFF)');
  if (ORIGINAL) {
    await sb.from('products').update({
      name: ORIGINAL.name, category: ORIGINAL.category, price: ORIGINAL.price, unit: ORIGINAL.unit,
      best_before: ORIGINAL.best_before, stock: ORIGINAL.stock, description: ORIGINAL.description,
      bestseller: ORIGINAL.bestseller, low_stock_threshold: ORIGINAL.low_stock_threshold, img: ORIGINAL.img,
    }).eq('id', PID);
    const { data: now } = await sb.from('products').select('*').eq('id', PID).single();
    // Field-by-field, because "the script said it restored it" is what went
    // wrong last time. created_at/updated_at are not ours to compare.
    const drift = Object.keys(ORIGINAL).filter(k => !['created_at', 'updated_at'].includes(k)
      && JSON.stringify(ORIGINAL[k]) !== JSON.stringify(now[k]));
    console.log(drift.length ? '  ⚠️  DRIFT on ' + drift.join(', ') : '  product ' + PID + ' restored, field by field');
  }
}

(async () => {
  if (!Number.isFinite(PID)) {
    console.error('Pass an explicit product id: node scripts/checks/step10-stock-reservations.js <productId>');
    process.exit(1);
  }
  const { data: prod, error } = await sb.from('products').select('*').eq('id', PID).single();
  if (error || !prod) { console.error('No product ' + PID + ': ' + (error && error.message)); process.exit(1); }
  ORIGINAL = { ...prod };
  const t = await readToggle();
  TOGGLE_EXISTED = t.existed; TOGGLE_BEFORE = t.value;

  console.log('target        : #' + PID + ' ' + prod.name + '  (stock ' + prod.stock + ', GHS ' + prod.price + ')');
  console.log('deduct_stock  : ' + (t.existed ? JSON.stringify(t.value) : '(absent — OFF)'));
  console.log('database      : ' + String(process.env.SUPABASE_URL || '').replace(/^https:\/\//, ''));

  if (CLEANUP_ONLY) { await cleanup(); process.exit(0); }

  try {
    // ── A. The SQL functions, with own-stock mode still OFF ──────────────
    // Holds live in their own table. With the toggle off the order path never
    // consults stock at all, so nothing here changes what a customer can buy.
    console.log('\n=== A. The five SQL functions (own-stock mode still OFF) ===');
    const base = await avail(PID);
    rec('A0', 'stock_available reports the shelf', base.onShelf === prod.stock,
      'on_shelf ' + base.onShelf + ', held ' + base.held + ', available ' + base.available);

    const h1 = await rpc('hold_stock', { p_items: [{ id: PID, qty: 2 }], p_hold_key: HOLD_A, p_ttl_minutes: 15 });
    const held = await avail(PID);
    rec('1280', 'a hold lowers available but never on_shelf',
      h1 && h1.ok === true && held.onShelf === base.onShelf && held.available === base.available - 2,
      'on_shelf ' + held.onShelf + ' (unchanged), available ' + base.available + ' -> ' + held.available);

    await rpc('release_stock_hold', { p_hold_key: HOLD_A });
    const rel = await avail(PID);
    rec('1281', 'releasing restores it', rel.available === base.available && rel.onShelf === base.onShelf,
      'available back to ' + rel.available);

    const over = await rpc('hold_stock', { p_items: [{ id: PID, qty: 999999 }], p_hold_key: HOLD_B, p_ttl_minutes: 15 });
    const afterOver = await avail(PID);
    rec('1282', 'over-holding is refused rather than going negative',
      over && over.ok === false && afterOver.available === base.available && afterOver.available >= 0,
      'ok:false, shortfalls reported, available still ' + afterOver.available);

    await rpc('hold_stock', { p_items: [{ id: PID, qty: 3 }], p_hold_key: HOLD_A, p_ttl_minutes: 15 });
    const commit = await rpc('commit_stock_hold', { p_hold_key: HOLD_A });
    const committed = await avail(PID);
    rec('1283', 'commit_stock_hold lowers on_shelf and clears the hold',
      commit && commit.ok === true && committed.onShelf === base.onShelf - 3 && committed.held === 0,
      'on_shelf ' + base.onShelf + ' -> ' + committed.onShelf + ', held ' + committed.held);

    await rpc('restock_items', { p_items: [{ id: PID, qty: 3 }] });
    const restocked = await avail(PID);
    rec('1284', 'restock_items puts it back', restocked.onShelf === base.onShelf,
      'on_shelf back to ' + restocked.onShelf);

    // Section A changes nothing a customer can see. Section B turns own-stock
    // mode ON, so it is the half worth being able to stop before.
    if (process.argv.includes('--section-a-only')) {
      console.log('\n(--section-a-only: stopping before own-stock mode is touched)');
      return;
    }
    console.log('\n=== B. Behaviour with own-stock mode ON ===');
    await setToggle(true);
    const cfgCheck = await readToggle();
    rec('B0', 'own-stock mode is ON for this section', cfgCheck.value === true, JSON.stringify(cfgCheck.value));

    // One unit on the shelf, so the second order has nothing to take.
    await sb.from('products').update({ stock: 1 }).eq('id', PID);
    console.log('  (stock set to 1 for the race)');

    const order = (qty) => ({
      items: [{ id: PID, qty }],
      customer: MARK, phone: '0200000000', neighborhood: 'Tamale Central',
      address: 'STEP10 TEST — not a real delivery', payMethod: 'cash',
      location: { lat: 9.4034, lng: -0.8424, accuracy: 12, source: 'test' },
    });
    const [r1, r2] = await Promise.all([call('POST', '/api/orders', order(1)), call('POST', '/api/orders', order(1))]);
    for (const r of [r1, r2]) if (r.json && r.json.id) made.orders.push(r.json.id);
    const oks = [r1, r2].filter(r => r.status === 201);
    const refused = [r1, r2].find(r => r.status >= 400);
    rec('1287', 'one unit left: exactly one order succeeds', oks.length === 1,
      'statuses ' + r1.status + ' / ' + r2.status);
    rec('1287b', 'the refused customer is told which item ran out',
      !!refused && /spaghetti|no longer available|out of stock|ran out/i.test((refused.json && refused.json.error) || ''),
      refused ? String((refused.json && refused.json.error) || refused.text).slice(0, 140) : 'nothing was refused');
    const afterRace = await avail(PID);
    rec('1287c', 'the shelf is not negative', afterRace.onShelf >= 0, 'on_shelf ' + afterRace.onShelf);

    // 1289 — an abandoned checkout. Rather than waiting 15 real minutes, place
    // the hold already expired and prove the sweep frees it.
    await sb.from('products').update({ stock: 5 }).eq('id', PID);
    await rpc('hold_stock', { p_items: [{ id: PID, qty: 5 }], p_hold_key: HOLD_B, p_ttl_minutes: 15 });
    const heldAll = await avail(PID);
    await sb.from('stock_holds').update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq('hold_key', HOLD_B);
    const swept = await rpc('expire_stock_holds', {});
    const freed = await avail(PID);
    rec('1289', 'an abandoned checkout frees its stock again',
      heldAll.available === 0 && freed.available === 5,
      'available 0 while held -> ' + freed.available + ' after expiry (swept ' + JSON.stringify(swept) + ')');

    // 1290 — a cash order, then cancel it. Cancelling needs a signed-in owner:
    // cancelOrder refuses a guest order outright ("not yours"), which is the
    // A-02 fix that stopped any account walking sequential ids to cancel guest
    // orders. So this leg uses a throwaway customer and the real customer route.
    await sb.from('products').update({ stock: 4 }).eq('id', PID);
    const su = await call('POST', '/api/auth/signup', {
      name: MARK, email: 'sdgtest-step10-' + Date.now() + '@example.com',
      phone: '0200000000', password: 'Str0ng!Passw0rd42', acceptedTerms: true,
    });
    if (su.status === 201) { made.userId = su.json.user.id; made.token = su.json.token; }
    rec('1290a', 'throwaway customer created for the cancel leg', su.status === 201, 'status ' + su.status);

    const cashOrder = await call('POST', '/api/orders', order(2), made.token);
    if (cashOrder.json && cashOrder.json.id) made.orders.push(cashOrder.json.id);
    const afterOrder = await avail(PID);
    const oid = cashOrder.json && cashOrder.json.id;
    const cancelled = oid
      ? await call('POST', '/api/me/orders/' + oid + '/cancel', { reason: MARK }, made.token)
      : null;
    const afterCancel = await avail(PID);
    rec('1290', 'a cancelled cash order returns its stock',
      afterOrder.onShelf === 2 && afterCancel.onShelf === 4,
      'on_shelf 4 -> ' + afterOrder.onShelf + ' on order -> ' + afterCancel.onShelf + ' after cancel'
      + (cancelled ? ' (cancel status ' + cancelled.status + ')' : ''));

    // ── C. The one that matters most: back to the supplier model ─────────
    console.log('\n=== C. Own-stock mode OFF — the model the live shop runs on ===');
    await restoreToggle();
    await sb.from('products').update({ stock: 0 }).eq('id', PID);
    // The catalogue caches for 60s and the toggle is read per request; give the
    // server a moment so this tests the toggle, not the cache.
    await new Promise(r => setTimeout(r, 2000));
    const zeroSale = await call('POST', '/api/orders', order(1));
    if (zeroSale.json && zeroSale.json.id) made.orders.push(zeroSale.json.id);
    rec('1291', 'with own-stock mode OFF a stock:0 product still sells', zeroSale.status === 201,
      'status ' + zeroSale.status + (zeroSale.status !== 201 ? ' — ' + String(zeroSale.text).slice(0, 160) : ''));
  } catch (e) {
    console.error('\n!! run aborted: ' + e.message);
    process.exitCode = 1;
  } finally {
    await cleanup();
    const pass = results.filter(r => r.pass === true).length;
    const fail = results.filter(r => r.pass === false).length;
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    if (fail) process.exitCode = 1;
  }
})();
