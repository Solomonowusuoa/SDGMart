// Admin-editable categories.
//
// Categories moved out of a hardcoded array into app_config. A product stores
// its category as PLAIN TEXT, so the danger is not the list — it is the
// products left holding a name the list no longer has. They vanish from the nav
// and every category page while still being in the shop, reachable only by
// search. Geisha Black Soap sat under "Rice & Grains" for weeks exactly like
// that, so these checks are about orphaning, not about editing.
//
//     node tests/categories.test.js

const Module = require('module');
const origLoad = Module._load;
const path = require('path');
const ROOT = path.join(__dirname, '..');

const DEFAULTS = ['Rice & Grains', 'Cooking Oil', 'Drinks', 'Toiletries & Personal Care'];
let PRODUCTS = [
  { id: 1, name: 'Rice 5kg', category: 'Rice & Grains', price: 20, stock: 10 },
  { id: 2, name: 'Frytol 1L', category: 'Cooking Oil', price: 30, stock: 10 },
  { id: 3, name: 'Coke 1L', category: 'Drinks', price: 10, stock: 10 },
  { id: 4, name: 'Fanta 1L', category: 'Drinks', price: 10, stock: 10 },
  { id: 5, name: 'Soap', category: 'Nowhere At All', price: 13, stock: 10 },   // already orphaned
];
const CONFIG = {};

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
  appConfig: {
    get: async (k) => (k in CONFIG ? CONFIG[k] : null),
    set: async (k, v) => { CONFIG[k] = v; },
    claim: async () => false,
  },
  products: {
    list: async () => PRODUCTS.map(p => ({ ...p })),
    listForCatalog: async () => PRODUCTS.map(p => ({ ...p })),
    listByIds: async (ids) => PRODUCTS.filter(p => ids.map(Number).includes(p.id)),
    get: async (id) => PRODUCTS.find(p => p.id == id) || null,
    countByCategory: async () => {
      const out = {};
      for (const p of PRODUCTS) out[p.category] = (out[p.category] || 0) + 1;
      return out;
    },
    moveCategory: async (from, to) => {
      let n = 0;
      for (const p of PRODUCTS) if (p.category === from) { p.category = to; n++; }
      return n;
    },
  },
  promotions: { listActive: async () => [], activeMap: async () => ({}) },
  orders: { create: async () => ({}), findByPaystackRef: async () => null, list: async () => [], get: async () => null, recentItemsForCounts: async () => [] },
  sessions: { get: async () => ({ userId: 1, userType: 'user' }), create: async () => 'tok', destroy: async () => {} },
  users: { get: async () => ({ id: 1, role: 'admin', mustChangePassword: false, name: 'A', email: 'a@b.c' }) },
  errorLog: { record: async () => {}, list: async () => [] },
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
process.env.PORT = process.env.PORT || '4014';
require(path.join(ROOT, 'server.js'));

const BASE = 'http://localhost:' + process.env.PORT;
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let t = ''; try { t = await r.text(); } catch (_) {}
  let j = null; try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, body: j, text: t };
};
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : '   got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
  if (!ok) process.exitCode = 1;
};
const catNames = async () => (await call('GET', '/api/admin/categories')).body.categories.map(c => c.name);

setTimeout(async () => {
  console.log('\n=== A. Before anything is saved, the built-in list is served ===');
  const a = await call('GET', '/api/admin/categories');
  check('200', a.status, 200);
  check('says it is on the defaults', a.body.usingDefaults, true);
  check('counts come from real products', a.body.categories.find(c => c.name === 'Drinks').count, 2);
  check('an already-orphaned category is surfaced', a.body.orphans, [{ name: 'Nowhere At All', count: 1 }]);

  console.log('\n=== B. Adding and reordering ===');
  const b = await call('POST', '/api/admin/categories', {
    categories: ['Drinks', 'Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care', 'Household & Cleaning'],
  });
  check('accepted', b.status, 200);
  check('order is kept as sent', await catNames(),
    ['Drinks', 'Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care', 'Household & Cleaning']);
  const cat = await call('GET', '/api/catalog');
  check('the shopper catalogue serves the saved list', cat.body.categories[0], 'Drinks');

  console.log('\n=== C. Removing a category that still holds products is REFUSED ===');
  const c = await call('POST', '/api/admin/categories', {
    categories: ['Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care', 'Household & Cleaning'],
  });
  check('409, not a silent orphaning', c.status, 409);
  check('names the category and the count', /Drinks.*2 products/.test(c.body.error || ''), true);
  check('the products were not touched', PRODUCTS.filter(p => p.category === 'Drinks').length, 2);
  check('the saved list is unchanged', (await catNames()).includes('Drinks'), true);

  console.log('\n=== D. Removing an EMPTY category is allowed ===');
  const d = await call('POST', '/api/admin/categories', {
    categories: ['Drinks', 'Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care'],
  });
  check('accepted', d.status, 200);
  check('gone from the list', (await catNames()).includes('Household & Cleaning'), false);

  console.log('\n=== E. A rename moves the products with it ===');
  const e = await call('POST', '/api/admin/categories', {
    categories: ['Beverages', 'Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care'],
    renames: [{ from: 'Drinks', to: 'Beverages' }],
  });
  check('accepted', e.status, 200);
  check('both products moved', e.body.productsMoved, 2);
  check('none left on the old name', PRODUCTS.filter(p => p.category === 'Drinks').length, 0);
  check('they are on the new one', PRODUCTS.filter(p => p.category === 'Beverages').length, 2);
  check('nothing is orphaned by the rename',
    (await call('GET', '/api/admin/categories')).body.orphans, [{ name: 'Nowhere At All', count: 1 }]);

  console.log('\n=== F. A rename to a name that was not saved is refused ===');
  const f = await call('POST', '/api/admin/categories', {
    categories: ['Beverages', 'Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care'],
    renames: [{ from: 'Rice & Grains', to: 'Grains' }],   // "Grains" is not in the list
  });
  check('400', f.status, 400);
  check('products untouched', PRODUCTS.filter(p => p.category === 'Rice & Grains').length, 1);

  console.log('\n=== G. Rubbish lists are refused ===');
  check('empty list', (await call('POST', '/api/admin/categories', { categories: [] })).status, 400);
  check('not a list', (await call('POST', '/api/admin/categories', { categories: 'Drinks' })).status, 400);
  check('a blank name', (await call('POST', '/api/admin/categories', { categories: ['Drinks', '  '] })).status, 400);
  check('a duplicate', (await call('POST', '/api/admin/categories', { categories: ['Drinks', 'drinks'] })).status, 400);
  check('a non-string', (await call('POST', '/api/admin/categories', { categories: ['Drinks', 7] })).status, 400);
  check('over the length cap', (await call('POST', '/api/admin/categories', { categories: ['x'.repeat(41)] })).status, 400);
  check('the saved list survived every one of those', await catNames(),
    ['Beverages', 'Rice & Grains', 'Cooking Oil', 'Toiletries & Personal Care']);

  console.log('\n=== H. A junk value in app_config does not take the shop down ===');
  CONFIG.categories = 'not a list at all';
  const h = await call('GET', '/api/catalog');
  check('catalogue still serves', h.status, 200);
  check('falls back to a usable list rather than nothing', h.body.categories.length > 0, true);

  console.log('\n=== I. Only an admin may read or write the list ===');
  const anon = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return r.status;
  };
  check('GET without a token', await anon('GET', '/api/admin/categories'), 401);
  check('POST without a token', await anon('POST', '/api/admin/categories', { categories: ['Anything'] }), 401);

  console.log('');
  if (httpServer) httpServer.close();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}, 700);
