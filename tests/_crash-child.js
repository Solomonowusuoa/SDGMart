// Child process for tests/crash.test.js — see that file for the reasoning.
//
// Boots the REAL server.js against a stubbed database, then throws from a timer
// callback. A throw there is genuinely uncaught: it is not inside a route (which
// Express would route to the error handler), and not inside a promise (which
// would surface as unhandledRejection instead). That is the same shape a real
// bug takes, and it is what should stop the process.
//
// The parent reads this child's exit code and output. Nothing here touches the
// live shop.
const Module = require('module');
const origLoad = Module._load;
const path = require('path');
const ROOT = path.join(__dirname, '..');

const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => Promise.resolve(null) });
const stubDb = {
  ADMIN_EMAIL: 'a@b.c',
  rateCheck: () => ({ allowed: true }),
  rateClear: () => {},
  bootstrap: async () => {},
  checkSchema: async () => ({ ok: true, missing: [] }),
  getVapidKeys: async () => null,
  businessDate: () => new Date().toISOString().slice(0, 10),
  businessHour: () => 9,
  businessDatePlus: (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10),
  rowOut: (r) => r, rowsOut: (r) => r,
  validatePasswordStrength: () => null,
  hashPassword: async () => 'x:y',
  verifyPassword: async () => false,
  sniffImageType: () => null,
  appConfig: { get: async () => null, set: async () => {}, claim: async () => false },
  products: { list: async () => [], listForCatalog: async () => [], listByIds: async () => [], get: async () => null },
  promotions: { listActive: async () => [], activeMap: async () => ({}) },
  orders: { create: async () => ({ id: 1 }), findByPaystackRef: async () => null, list: async () => [], get: async () => null },
  sessions: { get: async () => null, create: async () => 'tok', destroy: async () => {} },
  users: { get: async () => null },
  // The whole point: prove the crash is RECORDED before the process dies.
  // Printed rather than stored, so the parent can see it in the child's output.
  errorLog: { record: async (r) => { console.log('ERRORLOG ' + JSON.stringify({ message: r.message, status: r.status, path: r.path, method: r.method })); } },
  squads: noop, addresses: noop, carts: noop, stats: noop, searchLog: noop, pushSubs: noop,
  dataRequests: noop, issueReports: noop, productRequests: noop, recurring: noop, metrics: noop,
  leaderboard: noop, reviews: noop, riders: noop, pendingPayments: noop, stock: noop,
  retention: { sweep: async () => ({}) },
  sb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
};

Module._load = function (req) {
  if (req === '@supabase/supabase-js') {
    return { createClient: () => ({ from: () => ({}), storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }) }) };
  }
  return origLoad.apply(this, arguments);
};

const dbPath = require.resolve(path.join(ROOT, 'database.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stubDb };
process.env.PORT = process.env.CRASH_PORT || '4021';
require(path.join(ROOT, 'server.js'));

// Let the server finish booting and install its handlers, then throw the way a
// real bug would. If uncaughtException were not handled, Node's own default
// would also exit — so the parent additionally checks that OUR handler ran, by
// looking for the recorded crash in the output.
setTimeout(() => {
  throw new Error('E-06 deliberate crash: simulated unhandled fault');
}, 1200);
