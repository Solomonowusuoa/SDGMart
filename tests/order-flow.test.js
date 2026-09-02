// Order-flow wiring for stock reservations (audit C-10).
//
// Boots the real server.js with a stubbed database and own-stock mode ON, to
// check that a cash order consumes stock atomically BEFORE confirming, refuses
// honestly when short, and that the admin toggle will not turn own-stock mode
// on without its migration. Section D is the important one: with the toggle
// off the shop must still sell from zero stock, which is the supplier model
// the live shop runs on today.
//
//     node tests/order-flow.test.js

const Module = require('module');
const origLoad = Module._load;
const path = require('path');
const ROOT = path.join(__dirname, '..');

let shelf = { 1: 5, 2: 5 };
let holds = [];
const now = () => Date.now();
const heldFor = (id) => holds.filter(h => h.product_id === id && h.expires_at > now()).reduce((s, h) => s + h.qty, 0);
const availableFor = (id) => Math.max((shelf[id] || 0) - heldFor(id), 0);
let migrationPresent = true;
const PENDING = {};   // reference -> { draft } for the webhook test in section F
const LOGGED = [];    // everything written to error_logs, for section G

const RPC = {
  stock_available: ({ p_ids }) => {
    if (!migrationPresent) throw new Error('function stock_available does not exist');
    return (p_ids || []).map(id => ({ product_id: id, on_shelf: shelf[id] || 0, held: heldFor(id), available: availableFor(id) }));
  },
  consume_stock: ({ p_items }) => {
    const short = [];
    for (const it of p_items) if (it.qty > availableFor(it.id)) short.push({ id: it.id, want: it.qty, available: availableFor(it.id) });
    if (short.length) return { ok: false, shortfalls: short };
    for (const it of p_items) shelf[it.id] = Math.max((shelf[it.id] || 0) - it.qty, 0);
    return { ok: true };
  },
  restock_items: ({ p_items }) => { for (const it of p_items) shelf[it.id] = (shelf[it.id] || 0) + it.qty; return { ok: true }; },
  hold_stock: () => ({ ok: true }),
  release_stock_hold: () => 0,
  commit_stock_hold: () => ({ ok: true, lines: 1 }),
  expire_stock_holds: () => 0,
};

const SAMPLE = [
  { id: 1, name: 'Rice 5kg', category: 'Rice & Grains', price: 20, unit: '5kg', stock: 5, bestseller: false, img: null },
  { id: 2, name: 'Cooking Oil 1L', category: 'Cooking Oil', price: 10, unit: '1L', stock: 5, bestseller: false, img: null },
];
let created = [];
const CONFIG = { deduct_stock: true };

const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => Promise.resolve(null) });
const stubDb = {
  ADMIN_EMAIL: 'a@b.c',
  rateCheck: () => ({ allowed: true }),
  rateClear: () => {},
  bootstrap: async () => {},
  checkSchema: async () => ({ ok: true, missing: [] }),
  makeEmailToken: async () => 'tok',
  consumeEmailToken: async () => null,
  createRider: async () => ({}),
  cancelOrder: async () => ({ ok: true }),
  uploadProductPhoto: async () => '',
  sniffImageType: () => null,
  verifyPassword: async () => false,
  hashPassword: async () => 'x:y',
  validatePasswordStrength: () => null,
  burnPasswordTiming: async () => {},
  getVapidKeys: async () => null,
  businessDate: () => new Date().toISOString().slice(0, 10),
  businessHour: () => 9,
  businessDatePlus: (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10),
  rowOut: (r) => r, rowsOut: (r) => r,
  appConfig: { get: async (k) => CONFIG[k], set: async (k, v) => { CONFIG[k] = v; }, claim: async () => false },
  products: { list: async () => SAMPLE, listForCatalog: async () => SAMPLE, listByIds: async (ids) => SAMPLE.filter(p => ids.map(Number).includes(p.id)), get: async (id) => SAMPLE.find(p => p.id == id) },
  promotions: { listActive: async () => [], activeMap: async () => ({}) },
  orders: { create: async (o) => { const row = { id: created.length + 1, ...o }; created.push(row); return row; }, findByPaystackRef: async () => null, list: async () => [], get: async () => null },
  sessions: { get: async () => ({ userId: 1, userType: 'user' }), create: async () => 'tok', destroy: async () => {} },
  users: { get: async () => ({ id: 1, role: 'admin', mustChangePassword: false, name: 'A', email: 'a@b.c', firstOrderDone: true, loyaltyBalance: 0, discountPending: false }) },
  errorLog: { record: async (r) => { LOGGED.push(r); } },
  squads: noop, addresses: noop, carts: noop, stats: noop, searchLog: noop, pushSubs: noop,
  dataRequests: noop, issueReports: noop, productRequests: noop, recurring: noop, metrics: noop,
  leaderboard: noop, reviews: noop, riders: noop, retention: { sweep: async () => ({}) },
  // Section F drives the webhook, which looks a draft up by reference.
  pendingPayments: Object.assign(Object.create(noop), {
    get: async (ref) => PENDING[ref] || null,
    delete: async (ref) => { delete PENDING[ref]; },
    listStaleForUser: async () => [],
  }),
  sb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
};

let httpServer = null;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: () => ({}), storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }) }) };
  const mod = origLoad.apply(this, arguments);
  // Grab the server express is about to create, so we can close it at the end.
  if (req === 'http' && mod && mod.createServer && !mod.__patched) {
    const real = mod.createServer;
    mod.createServer = function (...a) { httpServer = real.apply(this, a); return httpServer; };
    mod.__patched = true;
  }
  return mod;
};

// Real db.stock, backed by the simulation.
const realStock = {
  TTL_MIN: 15,
  lines: (items) => {
    const m = new Map();
    for (const it of items || []) {
      if (!it || it.id == null || it.birthdayGift) continue;
      const q = Math.max(0, parseInt(it.qty, 10) || 0);
      if (q) m.set(String(it.id), (m.get(String(it.id)) || 0) + q);
    }
    return [...m.entries()].map(([id, qty]) => ({ id: Number(id), qty }));
  },
  ready: async () => { try { RPC.stock_available({ p_ids: [] }); return true; } catch (_) { return false; } },
  available: async (ids) => { const out = {}; for (const r of RPC.stock_available({ p_ids: ids.map(Number) })) out[r.product_id] = { onShelf: r.on_shelf, held: r.held, available: r.available }; return out; },
  consume: async (items) => { const l = realStock.lines(items); return l.length ? RPC.consume_stock({ p_items: l }) : { ok: true }; },
  restock: async (items) => { const l = realStock.lines(items); return l.length ? RPC.restock_items({ p_items: l }) : { ok: true }; },
  hold: async () => ({ ok: true }), release: async () => 0, commitHold: async () => ({ ok: true, lines: 1 }), expireHolds: async () => 0,
};
stubDb.stock = realStock;

const dbPath = require.resolve(path.join(ROOT, 'database.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stubDb };
// A fake Paystack secret, set BEFORE server.js reads it, so section F can sign a
// webhook the way Paystack does. Nothing here talks to Paystack.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_orderflow_fake';
process.env.PORT = process.env.PORT || '4010';
require(path.join(ROOT, 'server.js'));

const BASE = 'http://localhost:' + process.env.PORT;
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const put = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  if (!ok) process.exitCode = 1;
};
const order = (items) => ({
  items, customer: 'Ama', phone: '0241234567', neighborhood: 'Tamale Central',
  address: 'Near the market', payMethod: 'cash', location: { lat: 9.4, lng: -0.85 },
});

setTimeout(async () => {
  console.log('\n=== A. A cash order deducts stock atomically, before confirming ===');
  shelf = { 1: 5, 2: 5 }; created = [];
  const r1 = await post('/api/orders', order([{ id: 1, qty: 2 }]));
  check('order accepted', r1.status, 201);
  check('shelf reduced 5 -> 3', shelf[1], 3);

  console.log('\n=== B. An order for more than exists is REFUSED, not confirmed ===');
  const before = shelf[1];
  const r2 = await post('/api/orders', order([{ id: 1, qty: 99 }]));
  check('refused', r2.status >= 400, true);
  check('customer told which item', /Rice 5kg|no longer available/i.test(r2.body.error || ''), true);
  check('shelf untouched by the refusal', shelf[1], before);
  check('no order row created', created.length, 1);

  console.log('\n=== C. Stock held by ANOTHER checkout is not sellable ===');
  shelf = { 1: 5 }; holds = [{ product_id: 1, qty: 4, hold_key: 'someone-else', expires_at: Date.now() + 900000 }];
  const r3 = await post('/api/orders', order([{ id: 1, qty: 3 }]));
  check('refused, only 1 free', r3.status >= 400, true);
  check('shelf untouched', shelf[1], 5);
  holds = [];

  console.log('\n=== D. With own-stock mode OFF, stock is ignored entirely ===');
  CONFIG.deduct_stock = false;
  shelf = { 1: 0 };
  const r4 = await post('/api/orders', order([{ id: 1, qty: 3 }]));
  check('sold from zero stock (supplier model)', r4.status, 201);
  check('shelf not touched', shelf[1], 0);
  CONFIG.deduct_stock = true;

  console.log('\n=== E. The toggle refuses to turn on without the migration ===');
  CONFIG.deduct_stock = false;
  migrationPresent = false;
  const r5 = await post('/api/admin/settings', { deductStock: true });
  check('refused', r5.status, 409);
  check('says which migration', /stock-holds/.test(r5.body.error || ''), true);
  check('toggle still off', !!CONFIG.deduct_stock, false);

  migrationPresent = true;
  const r6 = await post('/api/admin/settings', { deductStock: true });
  check('accepted once the migration is present', r6.status, 200);
  check('toggle now on', !!CONFIG.deduct_stock, true);

  console.log('\n=== F. An ALREADY-PAID order still completes while ordering is off (G-03) ===');
  // The kill switch must stop NEW orders without stranding money already taken.
  // The guard is `!extra.paid && !switchOn('ordering_enabled')`, and only the
  // Paystack verify/webhook paths set paid — so this cannot be reached from
  // /api/orders, and needs the webhook. Signed the way Paystack signs it.
  CONFIG.deduct_stock = false;
  CONFIG.ordering_enabled = false;
  created = [];

  const unpaid = await post('/api/orders', order([{ id: 1, qty: 1 }]));
  check('an ordinary order is refused while ordering is off', unpaid.status, 503);
  check('and nothing was written', created.length, 0);

  const crypto = require('crypto');
  const ref = 'SDG_orderflow_' + Date.now();
  PENDING[ref] = {
    reference: ref, userId: null,
    draft: { items: [{ id: 1, qty: 1 }], customer: 'Ama', phone: '0241234567',
      neighborhood: 'Tamale Central', address: 'Near the market',
      location: { lat: 9.4, lng: -0.85 } },
  };
  const payload = JSON.stringify({ event: 'charge.success', data: { reference: ref, amount: 3000 } });
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(payload).digest('hex');
  const hookRes = await fetch(BASE + '/api/paystack/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
    body: payload,
  });
  check('the webhook ACKs so Paystack stops retrying', hookRes.status, 200);
  check('the paid order IS created even though ordering is off', created.length, 1);
  check('and it is recorded as paid', !!(created[0] && created[0].paid), true);
  check('the draft is cleared once the order exists', PENDING[ref], undefined);

  CONFIG.ordering_enabled = true;

  console.log('\n=== G. A charge that does not match its order raises the alarm (C-07) ===');
  // "Zero PAYMENT MISMATCH rows in production" only means something if the
  // detector actually fires. This proves both directions. The webhook path is
  // used because it is the one that had NO amount check at all until this
  // session -- an order created there was never reconciled against what
  // Paystack actually took.
  CONFIG.ordering_enabled = true;
  CONFIG.deduct_stock = false;

  const crypto2 = require('crypto');
  const hook = async (ref, pesewas, draftItems) => {
    PENDING[ref] = {
      reference: ref, userId: null,
      draft: { items: draftItems, customer: 'Ama', phone: '0241234567',
        neighborhood: 'Tamale Central', address: 'Near the market',
        location: { lat: 9.4, lng: -0.85 } },
    };
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: ref, amount: pesewas } });
    const sig = crypto2.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(payload).digest('hex');
    const r = await fetch(BASE + '/api/paystack/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body: payload,
    });
    return r.status;
  };

  // Item 1 costs 20, delivery 10 -> the order totals 30, i.e. 3000 pesewas.
  created = []; LOGGED.length = 0;
  const okStatus = await hook('SDG_match_' + Date.now(), 3000, [{ id: 1, qty: 1 }]);
  const mismatchesAfterMatch = LOGGED.filter((l) => /PAYMENT MISMATCH/.test(l.message || ''));
  check('a webhook whose amount MATCHES is accepted', okStatus, 200);
  check('the order was created', created.length, 1);
  check('and NO mismatch alarm was raised', mismatchesAfterMatch.length, 0);

  // Same basket, but Paystack says it took 5000 pesewas (GHS 50) not 3000.
  created = []; LOGGED.length = 0;
  const badStatus = await hook('SDG_mismatch_' + Date.now(), 5000, [{ id: 1, qty: 1 }]);
  const raised = LOGGED.filter((l) => /PAYMENT MISMATCH/.test(l.message || ''));
  check('a webhook whose amount DIFFERS still ACKs, so Paystack stops retrying', badStatus, 200);
  check('the order is still created rather than the money being stranded', created.length, 1);
  check('the mismatch alarm IS raised', raised.length, 1);
  check('the alarm names both figures',
    /charged GHS 50\.00.*totals GHS 30\.00/.test((raised[0] || {}).message || ''), true);
  check('it is attributed to the webhook path, not verify',
    (raised[0] || {}).path, '/api/paystack/webhook');

  console.log('');
  // Shut the listener down rather than exiting under it.
  if (httpServer) {
    try { httpServer.closeAllConnections && httpServer.closeAllConnections(); } catch (_) {}
    await new Promise((r) => httpServer.close(r));
  }
}, 2500);
