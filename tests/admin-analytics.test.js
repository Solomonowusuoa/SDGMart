const assert = require('node:assert/strict');
const { buildMetrics, summarizeCustomerOrders } = require('../admin-analytics');
const now = new Date('2026-10-08T12:00:00Z');
const dayKey = d => d.toISOString().slice(0, 10);
const customers = [
  { id: 1, createdAt: '2026-09-01T00:00:00Z' },
  { id: 2, createdAt: '2026-10-02T00:00:00Z' },
  { id: 3, createdAt: '2026-10-08T01:00:00Z' },
  { id: 4, createdAt: '2026-10-07T01:00:00Z' },
];
const order = (id, userId, createdAt, status, total) => ({ id, userId, createdAt, status, total });
const orders = [
  order(1, 1, '2026-09-30T08:00:00Z', 'delivered', 80),
  order(2, 1, '2026-10-02T00:00:00Z', 'delivered', 100), // first instant in window
  order(3, 2, '2026-10-03T10:00:00Z', 'delivered', 50),
  order(4, 2, '2026-10-08T10:00:00Z', 'delivered', 25), // repeat in same period stays first-time
  order(5, 3, '2026-10-08T11:00:00Z', 'cancelled', 999),
  order(6, 4, '2026-10-07T10:00:00Z', 'queued', 999),
  order(7, null, '2026-10-06T10:00:00Z', 'delivered', 20), // deleted/guest revenue still exists
  order(8, 99, '2026-10-06T10:00:00Z', 'delivered', 30), // non-customer not an active buyer
  order(9, 3, '2026-10-08T13:00:00Z', 'delivered', 999), // after snapshot
];
const metrics = buildMetrics({ customers, orders, productOrders: orders.map(o => ({ ...o, items: [{ name: 'Rice', category: 'Grains', qty: 2 }] })), activeRecurring: 2, days: 7, now, dayKey, timezone: 'Africa/Accra' });
assert.deepEqual(metrics.period, { start: '2026-10-02', end: '2026-10-08', previousStart: '2026-09-25', previousEnd: '2026-10-01' });
assert.equal(metrics.totals.revenue, 225);
assert.equal(metrics.totals.aov, 45);
assert.equal(metrics.totals.orders, 6);
assert.equal(metrics.totals.placedOrders, 7);
assert.equal(metrics.totals.cancellationRate, 14.3);
assert.equal(metrics.totals.newCustomers, 3);
assert.equal(metrics.totals.activationRate, 50);
assert.equal(metrics.totals.neverPurchased, 2);
assert.equal(metrics.totals.activeBuyers, 2);
assert.equal(metrics.totals.firstTimeBuyers, 1);
assert.equal(metrics.totals.returningBuyers, 1);
assert.equal(metrics.totals.returningBuyerRate, 50);
assert.equal(metrics.previous.revenue, 80);
assert.equal(metrics.series.length, 7);
assert.equal(metrics.series.reduce((sum, day) => sum + day.revenue, 0), metrics.totals.revenue);
assert.equal(metrics.series.reduce((sum, day) => sum + day.registrations, 0), metrics.totals.newCustomers);
assert.deepEqual(metrics.topProducts, [{ name: 'Rice', qty: 10 }]);
assert.deepEqual(summarizeCustomerOrders(orders.slice(0, 8)).get('2'), { orders: 2, deliveredOrders: 2, totalSpent: 75, lastOrderAt: '2026-10-08T10:00:00Z' });
assert.deepEqual(summarizeCustomerOrders(orders.slice(0, 8)).get('3'), { orders: 0, deliveredOrders: 0, totalSpent: 0, lastOrderAt: null });
const empty = buildMetrics({ customers: [], orders: [], productOrders: [], activeRecurring: 0, days: 90, now, dayKey, timezone: 'Africa/Accra' });
assert.equal(empty.series.length, 90);
assert.equal(empty.totals.activationRate, null);
assert.equal(empty.totals.returningBuyerRate, null);
assert.equal(empty.totals.cancellationRate, null);
assert.equal(empty.totals.aov, 0);
// Day grouping must follow the supplied business timezone, not UTC/server TZ.
const laDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const la = buildMetrics({ customers: [], orders: [order(10, null, '2026-10-02T02:00:00Z', 'delivered', 100)], productOrders: [], activeRecurring: 0, days: 7, now, dayKey: laDate, timezone: 'America/Los_Angeles' });
assert.equal(la.totals.revenue, 0);
assert.equal(la.previous.revenue, 100);
console.log('PASS: customer activation, period boundaries, prior purchases, cancellations, empty denominators and revenue reconciliation');

// Exercise the real database adapter with a response cap below its page size.
const Module = require('module');
const originalLoad = Module._load;
const rows = {
  users: Array.from({ length: 1005 }, (_, i) => ({ id: i + 1, name: 'Customer ' + (i + 1), email: `c${i + 1}@example.test`, phone: null, role: 'customer', created_at: '2020-01-01T00:00:00Z', password_hash: 'NEVER EXPOSE', google_id: 'PRIVATE' })),
  orders: Array.from({ length: 1005 }, (_, i) => ({ id: i + 1, user_id: 1, status: 'delivered', total: 0.1, created_at: '2020-01-01T00:00:00Z', items: [] })),
  recurring_orders: [],
};
rows.users.push({ id: 9000, role: 'admin', name: 'Staff', created_at: '2026-10-08T00:00:00Z' });
let failTable = null;
const reads = [];
Module._load = function(name) {
  if (name !== '@supabase/supabase-js') return originalLoad.apply(this, arguments);
  return { createClient: () => ({ from(table) {
    let columns = '*', head = false, offset = 0, limit = 500;
    const filters = [], sorts = [];
    const query = {
      select(value, options = {}) { columns = value; head = options.head; return query; },
      eq(k, v) { filters.push(row => row[k] === v); return query; },
      gt(k, v) { filters.push(row => row[k] > v); return query; },
      gte(k, v) { filters.push(row => row[k] >= v); return query; },
      lte(k, v) { filters.push(row => row[k] <= v); return query; },
      in(k, values) { filters.push(row => values.includes(row[k])); return query; },
      or(expression) {
        // Parse only quoted imatch terms; reject any unescaped filter syntax.
        const terms = [...expression.matchAll(/(name|email|phone)\.imatch\.("(?:[^"\\]|\\.)*")/g)];
        assert.equal(terms.map(term => term[0]).join(','), expression);
        const patterns = terms.map(term => [term[1], new RegExp(JSON.parse(term[2]), 'i')]);
        filters.push(row => patterns.some(([key, regex]) => regex.test(row[key] || '')));
        return query;
      },
      order(k, options) { sorts.push([k, options.ascending]); return query; },
      limit(n) { limit = n; return query; },
      range(from, to) { offset = from; limit = to - from + 1; return query; },
      then(resolve, reject) {
        reads.push({ table, columns });
        if (failTable === table) return Promise.resolve({ error: new Error('Database unavailable') }).then(resolve, reject);
        const filtered = rows[table].filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const [k, asc] of sorts) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1); }
          return 0;
        });
        const data = head ? null : filtered.slice(offset, offset + Math.min(137, limit)).map(row => Object.fromEntries(columns.split(',').map(k => [k.trim(), row[k.trim()]])));
        return Promise.resolve({ data, count: filtered.length, error: null }).then(resolve, reject);
      },
    };
    return query;
  } }) };
};
process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = 'stub-key';
const db = require('../database');
Module._load = originalLoad;
(async () => {
  const result = await db.users.listCustomers({ page: 1, pageSize: 25 });
  assert.equal(result.total, 1005);
  assert.equal(result.customers.length, 25);
  assert.equal(result.customers[0].deliveredOrders, 1005);
  assert.equal(result.customers[0].totalSpent, 100.5);
  assert.equal(result.customers[1].orders, 0);
  assert.deepEqual(Object.keys(result.customers[0]).sort(), ['id', 'name', 'email', 'phone', 'createdAt', 'orders', 'deliveredOrders', 'totalSpent', 'lastOrderAt'].sort());
  const last = await db.users.listCustomers({ page: 41, pageSize: 25 });
  assert.equal(last.customers.length, 5);
  assert.equal((await db.users.listCustomers({ search: 'C1005@EXAMPLE.TEST' })).customers[0].id, 1005);
  assert.equal((await db.users.listCustomers({ search: 'Staff' })).total, 0);
  rows.users[1].phone = '+233(20),555';
  assert.equal((await db.users.listCustomers({ search: '+233(20),555' })).customers[0].id, 2);
  for (const literal of ['*', '%', '_', '.*', '"', '\\', '),role.eq.admin', '[A-Z]', 'name|email']) {
    rows.users[2].name = 'Contains ' + literal + ' here';
    const found = await db.users.listCustomers({ search: literal });
    assert.equal(found.total, 1, 'literal search: ' + literal);
    assert.equal(found.customers[0].id, 3);
  }
  const all = await db.metrics.overview({ days: 90 });
  assert.equal(all.totals.customers, 1005);
  assert.equal(all.totals.convertedCustomers, 1);
  assert.ok(reads.filter(r => r.table === 'users').every(r => !/\*|password|google/.test(r.columns)));
  for (const table of ['users', 'orders', 'recurring_orders']) {
    failTable = table;
    await assert.rejects(db.metrics.overview(), /Database unavailable/);
  }
  failTable = 'orders';
  await assert.rejects(db.users.listCustomers(), /Database unavailable/);
  console.log('PASS: directory pagination, safe projections, >1,000 rows across capped pages and query failures');
})().catch(e => { console.error(e); process.exitCode = 1; });
