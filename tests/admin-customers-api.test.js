// Admin customer directory authorization and request validation. Uses an isolated database stub.
const Module = require('module');
const origLoad = Module._load;
const path = require('path');
const ROOT = path.join(__dirname, '..');

let account = { id: 1, role: 'admin', mustChangePassword: false };
let readFailure = false;
const customerQueries = [];
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
  products: { list: async () => [], listForCatalog: async () => [] },
  promotions: { listActive: async () => [], activeMap: async () => ({}) },
  orders: { create: async () => ({}), findByPaystackRef: async () => null, list: async () => [], get: async () => null, recentItemsForCounts: async () => [] },
  sessions: { get: async () => ({ userId: 1, userType: 'user' }), create: async () => 'tok', destroy: async () => {} },
  users: {
    get: async () => account,
    listCustomers: async (query) => { customerQueries.push(query); if (readFailure) throw new Error('Customer read failed'); return { customers: [{ id: 2, name: 'Demo customer' }], total: 1, ...query }; },
  },
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
process.env.PORT = process.env.PORT || '4016';
require(path.join(ROOT, 'server.js'));

stubDb.metrics = { overview: async ({ days }) => { if (readFailure) throw new Error('Metrics read failed'); return { days }; } };
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

setTimeout(async () => {
  try {
    const ok = await call('GET', '/api/admin/customers?search=Alice%20%2B233&sort=name&page=2&pageSize=10');
    check('admin can read customer directory', ok.status, 200);
    check('validated query reaches adapter', customerQueries[0], { page: 2, pageSize: 10, search: 'Alice +233', sort: 'name' });
    const response = await fetch(BASE + '/api/admin/customers', { headers: { Authorization: 'Bearer tok' } });
    check('customer responses cannot be cached', response.headers.get('cache-control'), 'no-store');
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=NaN', 'page=1000001', 'pageSize=101', 'pageSize=0', 'sort=password', 'search[x]=bad', 'search=' + 'a'.repeat(101)]) {
      check('invalid query rejected: ' + query.slice(0, 30), (await call('GET', '/api/admin/customers?' + query)).status, 400);
    }
    for (const endpoint of ['/api/admin/customers', '/api/admin/metrics']) {
      check('anonymous blocked: ' + endpoint, (await fetch(BASE + endpoint)).status, 401);
      account.role = 'customer';
      check('customer blocked: ' + endpoint, (await call('GET', endpoint)).status, 403);
      account.role = 'rider';
      check('rider blocked: ' + endpoint, (await call('GET', endpoint)).status, 403);
      account.role = 'admin'; account.mustChangePassword = true;
      check('bootstrap admin blocked: ' + endpoint, (await call('GET', endpoint)).status, 403);
      account.mustChangePassword = false;
      readFailure = true;
      check('query failure is not a fake empty result: ' + endpoint, (await call('GET', endpoint)).status, 500);
      readFailure = false;
    }
    check('90 day metrics supported', (await call('GET', '/api/admin/metrics?days=90')).body.days, 90);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { if (httpServer) httpServer.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
}, 700);
