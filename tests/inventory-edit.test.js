// Admin inventory edit (Save on a product row).
//
// Boots the real server.js with a stubbed database that behaves like Postgres
// for the products table: best_before is a `date` column, so the empty string
// is a hard error, not a null. That is what turned "Save" on a product with no
// Best Before date into a 404 {error: "..."} — and AdminPage.saveEdit dropped
// that error object into the row, which is why the row went blank, the price
// read "GHS NaN" and the low-stock banner announced one product at zero.
//
//     node tests/inventory-edit.test.js

const Module = require('module');
const origLoad = Module._load;
const path = require('path');
const ROOT = path.join(__dirname, '..');

// The shelf, as Postgres holds it: best_before is a date or null, never ''.
let ROWS = [
  { id: 1, name: 'Rice 5kg', category: 'Rice & Grains', price: 20, unit: '5kg',
    bestBefore: null, stock: 12, description: 'Long grain', bestseller: false, lowStockThreshold: 3, img: null },
  { id: 2, name: 'Cooking Oil 1L', category: 'Cooking Oil', price: 10, unit: '1L',
    bestBefore: '2026-12-31', stock: 8, description: 'Frytol', bestseller: false, lowStockThreshold: 5, img: null },
];

const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => Promise.resolve(null) });
const stubDb = {
  ADMIN_EMAIL: 'a@b.c',
  rateCheck: () => ({ allowed: true }), rateClear: () => {},
  bootstrap: async () => {}, checkSchema: async () => ({ ok: true, missing: [] }),
  makeEmailToken: async () => 'tok', consumeEmailToken: async () => null,
  createRider: async () => ({}), cancelOrder: async () => ({ ok: true }),
  uploadProductPhoto: async () => '', sniffImageType: () => null,
  verifyPassword: async () => false, hashPassword: async () => 'x:y',
  validatePasswordStrength: () => null, burnPasswordTiming: async () => {},
  getVapidKeys: async () => null,
  businessDate: () => new Date().toISOString().slice(0, 10),
  businessHour: () => 9,
  businessDatePlus: (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10),
  rowOut: (r) => r, rowsOut: (r) => r,
  appConfig: { get: async () => null, set: async () => {}, claim: async () => false },
  products: {
    list: async () => ROWS.map(r => ({ ...r })),
    listForCatalog: async () => ROWS.map(r => ({ ...r })),
    listByIds: async (ids) => ROWS.filter(p => ids.map(Number).includes(p.id)),
    get: async (id) => ROWS.find(p => p.id == id) || null,
    // Postgres semantics: a date column takes 'YYYY-MM-DD' or null. Anything
    // else — '' included — is an error, exactly as PostgREST reports it.
    update: async (id, patch) => {
      const row = ROWS.find(p => p.id == id);
      if (!row) throw new Error('no row found');
      if ('bestBefore' in patch) {
        const v = patch.bestBefore;
        if (v !== null && v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
          throw new Error('invalid input syntax for type date: "' + v + '"');
        }
      }
      Object.assign(row, patch);
      return { ...row };
    },
    create: async (p) => {
      if (p.bestBefore !== null && p.bestBefore !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.bestBefore))) {
        throw new Error('invalid input syntax for type date: "' + p.bestBefore + '"');
      }
      const row = { id: ROWS.length + 1, ...p };
      ROWS.push(row);
      return { ...row };
    },
  },
  promotions: { listActive: async () => [], activeMap: async () => ({}) },
  orders: { create: async () => ({}), findByPaystackRef: async () => null, list: async () => [], get: async () => null },
  sessions: { get: async () => ({ userId: 1, userType: 'user' }), create: async () => 'tok', destroy: async () => {} },
  users: { get: async () => ({ id: 1, role: 'admin', mustChangePassword: false, name: 'A', email: 'a@b.c' }) },
  errorLog: { record: async () => {} },
  stock: { ready: async () => false, lines: () => [], available: async () => ({}), consume: async () => ({ ok: true }), restock: async () => ({ ok: true }), hold: async () => ({ ok: true }), release: async () => 0, commitHold: async () => ({ ok: true }), expireHolds: async () => 0 },
  squads: noop, addresses: noop, carts: noop, stats: noop, searchLog: noop, pushSubs: noop,
  dataRequests: noop, issueReports: noop, productRequests: noop, recurring: noop, metrics: noop,
  leaderboard: noop, reviews: noop, riders: noop, retention: { sweep: async () => ({}) },
  pendingPayments: Object.assign(Object.create(noop), { get: async () => null, delete: async () => {}, listStaleForUser: async () => [] }),
  sb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
};

let httpServer = null;
Module._load = function (req) {
  if (req === '@supabase/supabase-js') return { createClient: () => ({ from: () => ({}), storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }) }) };
  const mod = origLoad.apply(this, arguments);
  if (req === 'http' && mod && mod.createServer && !mod.__patched) {
    const real = mod.createServer;
    mod.createServer = function (...a) { httpServer = real.apply(this, a); return httpServer; };
    mod.__patched = true;
  }
  return mod;
};

const dbPath = require.resolve(path.join(ROOT, 'database.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stubDb };
process.env.PORT = process.env.PORT || '4013';
require(path.join(ROOT, 'server.js'));

const BASE = 'http://localhost:' + process.env.PORT;
const put = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : '   got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
  if (!ok) process.exitCode = 1;
};

// What AdminPage sends when the admin presses Save on a row whose Best Before
// input is empty — which is every product that never had one.
const editOf = (p, over) => Object.assign({
  name: p.name, category: p.category, price: p.price, unit: p.unit,
  bestBefore: '', stock: p.stock, description: p.description,
  bestseller: !!p.bestseller, lowStockThreshold: p.lowStockThreshold,
}, over || {});

setTimeout(async () => {
  console.log('\n=== A. Saving a product with no Best Before date ===');
  const r1 = await put('/api/products/1', editOf(ROWS[0], { price: 22 }));
  check('accepted, not rejected as a bad date', r1.status, 200);
  check('a real product row comes back, with an id', r1.body.id, 1);
  check('the edit landed', r1.body.price, 22);
  check('stock is a number, not missing', typeof r1.body.stock, 'number');
  check('empty date stored as null, not ""', ROWS[0].bestBefore, null);

  console.log('\n=== B. Clearing a date that was set ===');
  const r2 = await put('/api/products/2', editOf(ROWS[1], { bestBefore: '' }));
  check('accepted', r2.status, 200);
  check('date cleared to null', ROWS[1].bestBefore, null);

  console.log('\n=== C. A real date still saves ===');
  const r3 = await put('/api/products/2', editOf(ROWS[1], { bestBefore: '2027-03-01' }));
  check('accepted', r3.status, 200);
  check('date stored', ROWS[1].bestBefore, '2027-03-01');

  console.log('\n=== D. A malformed date is refused with a reason, not a 404 ===');
  const before = { ...ROWS[1] };
  const r4 = await put('/api/products/2', editOf(ROWS[1], { bestBefore: '01/03/2027' }));
  check('refused as bad input', r4.status, 400);
  check('says what is wrong', /date/i.test(r4.body.error || ''), true);
  check('row untouched', ROWS[1].bestBefore, before.bestBefore);

  console.log('\n=== E. Creating a product with no Best Before date ===');
  const r5 = await post('/api/products', { name: 'Gari 2kg', category: 'Rice & Grains', price: 15, unit: '2kg', bestBefore: '', stock: 4, description: '' });
  check('created', r5.status, 201);
  check('empty date stored as null', r5.body.bestBefore, null);

  console.log('');
  if (httpServer) httpServer.close();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}, 700);
