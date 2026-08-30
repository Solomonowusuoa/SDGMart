// Stock reservation semantics (audit C-10).
//
// Runs against a JS simulation of the SQL functions in
// supabase-schema-stock-holds.sql, so it needs NO database and no framework:
//     node tests/stock.test.js
//
// It verifies the behaviour the application depends on. It does NOT verify the
// SQL itself — that needs a real Postgres, and the migration's section 9 has
// the queries to check it by hand on staging.

const Module = require('module');
const origLoad = Module._load;

// ── The simulated database ───────────────────────────────────────────────
let shelf = {};        // product_id -> stock on shelf
let holds = [];        // { product_id, qty, hold_key, expires_at }
let now = () => Date.now();

const active = () => holds.filter(h => h.expires_at > now());
const heldFor = (id) => active().filter(h => h.product_id === id).reduce((s, h) => s + h.qty, 0);
const availableFor = (id) => Math.max((shelf[id] || 0) - heldFor(id), 0);

const RPC = {
  stock_available: ({ p_ids }) => (p_ids || []).map(id => ({
    product_id: id, on_shelf: shelf[id] || 0, held: heldFor(id), available: availableFor(id),
  })),
  hold_stock: ({ p_items, p_hold_key, p_ttl_minutes }) => {
    if (!p_hold_key) throw new Error('hold_stock requires a hold key');
    const short = [];
    for (const it of p_items) {
      const avail = availableFor(it.id);
      if (it.qty > avail) short.push({ id: it.id, want: it.qty, available: avail });
    }
    if (short.length) return { ok: false, shortfalls: short };   // all or nothing
    for (const it of p_items) {
      holds.push({ product_id: it.id, qty: it.qty, hold_key: p_hold_key,
                   expires_at: now() + p_ttl_minutes * 60000 });
    }
    return { ok: true };
  },
  release_stock_hold: ({ p_hold_key }) => {
    const before = holds.length;
    holds = holds.filter(h => h.hold_key !== p_hold_key);
    return before - holds.length;
  },
  commit_stock_hold: ({ p_hold_key }) => {
    const mine = holds.filter(h => h.hold_key === p_hold_key);
    for (const h of mine) shelf[h.product_id] = Math.max((shelf[h.product_id] || 0) - h.qty, 0);
    holds = holds.filter(h => h.hold_key !== p_hold_key);
    return { ok: true, lines: mine.length };
  },
  consume_stock: ({ p_items }) => {
    const short = [];
    for (const it of p_items) {
      const avail = availableFor(it.id);
      if (it.qty > avail) short.push({ id: it.id, want: it.qty, available: avail });
    }
    if (short.length) return { ok: false, shortfalls: short };
    for (const it of p_items) shelf[it.id] = Math.max((shelf[it.id] || 0) - it.qty, 0);
    return { ok: true };
  },
  restock_items: ({ p_items }) => {
    for (const it of p_items) shelf[it.id] = (shelf[it.id] || 0) + it.qty;
    return { ok: true };
  },
  expire_stock_holds: () => {
    const before = holds.length;
    holds = holds.filter(h => h.expires_at > now() - 86400000);
    return before - holds.length;
  },
};

Module._load = function (req) {
  if (req === '@supabase/supabase-js') {
    return { createClient: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), in: async () => ({ data: [] }), order: async () => ({ data: [] }) }) }),
      storage: { from: () => ({}) },
      rpc: async (name, args) => {
        if (!RPC[name]) return { data: null, error: { message: 'function ' + name + ' does not exist' } };
        try { return { data: RPC[name](args || {}), error: null }; }
        catch (e) { return { data: null, error: { message: e.message } }; }
      },
    }) };
  }
  return origLoad.apply(this, arguments);
};

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy';
const db = require(require('path').join(__dirname, '..', 'database.js'));

const line = (s) => console.log('  ' + s);
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  if (!ok) process.exitCode = 1;
};
const avail = async (id) => (await db.stock.available([id]))[id].available;
const onShelf = async (id) => (await db.stock.available([id]))[id].onShelf;

(async () => {
  console.log('\n=== 1. A hold reduces availability but not the shelf ===');
  shelf = { 1: 10 }; holds = [];
  await db.stock.hold([{ id: 1, qty: 3 }], 'checkout-A', 15);
  check('available drops', await avail(1), 7);
  check('shelf untouched', await onShelf(1), 10);

  console.log('\n=== 2. Abandoned checkout returns the stock ===');
  await db.stock.release('checkout-A');
  check('available restored', await avail(1), 10);
  check('shelf still 10', await onShelf(1), 10);

  console.log('\n=== 3. An expired hold returns stock with no sweep ===');
  shelf = { 1: 10 }; holds = [];
  await db.stock.hold([{ id: 1, qty: 4 }], 'checkout-B', 15);
  check('held', await avail(1), 6);
  const realNow = now;
  now = () => realNow() + 16 * 60000;      // 16 minutes later
  check('lapsed hold ignored', await avail(1), 10);
  now = realNow;

  console.log('\n=== 4. Committing a hold reduces the shelf ===');
  shelf = { 1: 10 }; holds = [];
  await db.stock.hold([{ id: 1, qty: 3 }], 'checkout-C', 15);
  await db.stock.commitHold('checkout-C');
  check('shelf reduced', await onShelf(1), 7);
  check('hold cleared', await avail(1), 7);

  console.log('\n=== 5. Over-holding is refused, all or nothing ===');
  shelf = { 1: 5, 2: 5 }; holds = [];
  const r = await db.stock.hold([{ id: 1, qty: 2 }, { id: 2, qty: 99 }], 'checkout-D', 15);
  check('refused', r.ok, false);
  check('shortfall names the line', r.shortfalls, [{ id: 2, want: 99, available: 5 }]);
  check('nothing held for the OK line', await avail(1), 5);

  console.log('\n=== 6. Two checkouts cannot both take the last one ===');
  shelf = { 1: 1 }; holds = [];
  const a = await db.stock.hold([{ id: 1, qty: 1 }], 'race-A', 15);
  const b = await db.stock.hold([{ id: 1, qty: 1 }], 'race-B', 15);
  check('first wins', a.ok, true);
  check('second refused', b.ok, false);
  check('never oversold', await avail(1), 0);

  console.log('\n=== 7. Cash path: atomic consume ===');
  shelf = { 1: 4 }; holds = [];
  const c1 = await db.stock.consume([{ id: 1, qty: 3 }]);
  check('taken', c1.ok, true);
  check('shelf reduced', await onShelf(1), 1);
  const c2 = await db.stock.consume([{ id: 1, qty: 3 }]);
  check('second refused', c2.ok, false);
  check('shelf unchanged by the refusal', await onShelf(1), 1);

  console.log('\n=== 8. Cash respects OTHER checkouts holds ===');
  shelf = { 1: 5 }; holds = [];
  await db.stock.hold([{ id: 1, qty: 4 }], 'someone-else', 15);
  const c3 = await db.stock.consume([{ id: 1, qty: 3 }]);
  check('refused, only 1 free', c3.ok, false);
  check('shortfall reports availability not shelf', c3.shortfalls[0].available, 1);

  console.log('\n=== 9. Cancel puts it back — the path that never existed ===');
  shelf = { 1: 10 }; holds = [];
  await db.stock.consume([{ id: 1, qty: 4 }]);
  check('after order', await onShelf(1), 6);
  await db.stock.restock([{ id: 1, qty: 4 }]);
  check('after cancel', await onShelf(1), 10);

  console.log('\n=== 10. Birthday gifts and zero quantities are excluded ===');
  shelf = { 1: 10, 2: 10 }; holds = [];
  await db.stock.consume([
    { id: 1, qty: 2 },
    { id: 2, qty: 1, birthdayGift: true },
    { id: 1, qty: 0 },
  ]);
  check('normal line taken', await onShelf(1), 8);
  check('gift not deducted', await onShelf(2), 10);

  console.log('\n=== 11. Duplicate lines are summed, not lost ===');
  shelf = { 1: 10 }; holds = [];
  await db.stock.consume([{ id: 1, qty: 2 }, { id: 1, qty: 3 }]);
  check('5 taken in total', await onShelf(1), 5);

  console.log('\n=== 12. Missing migration is detectable ===');
  const realRpc = RPC.stock_available;
  delete RPC.stock_available;
  check('ready() says no', await db.stock.ready(), false);
  RPC.stock_available = realRpc;
  check('ready() says yes', await db.stock.ready(), true);

  console.log('');
})();
