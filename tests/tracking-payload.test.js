// What the customer's tracking page is allowed to know about the rider.
//
// `GET /api/orders/:id/tracking` is reachable with NO sign-in — a signed ?t=
// token, printed on receipts and pasted into shared links, is enough. It used
// to answer with `riders.get()` straight off the wire, and that is `select('*')`
// on a table whose columns include `password_hash`. So a tracking link handed to
// a friend also handed over the rider's bcrypt hash, their email and their phone
// number. `users` already had this right (`const { passwordHash, ...safeUser }`
// before export); tracking never got the same treatment.
//
// These checks pin the projection down, because the leak came back the moment
// anyone wrote `rider = await riders.get(...)` again.
//
//     node tests/tracking-payload.test.js

const assert = require('assert');
const Module = require('module');

// database.js builds its Supabase client at require time and captures it in a
// closure, so it cannot be swapped afterwards. Replace the driver instead, and
// the real getWithTracking then runs against this fake.
let RIDER = null, ORDER = null, AHEAD = 0;
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === '@supabase/supabase-js') {
    return {
      createClient: () => ({
        from(table) {
          const q = {
            select(_cols, opts) {
              // The queue count is a head/count query, so it resolves as a
              // thenable rather than through .maybeSingle().
              if (opts && opts.count) { q._count = true; }
              return q;
            },
            eq: () => q, in: () => q, lt: () => q, order: () => q,
            maybeSingle: async () => ({
              data: table === 'orders' ? ORDER : table === 'riders' ? RIDER : null,
              error: null,
            }),
            then: (res) => res({ count: AHEAD, error: null }),
          };
          return q;
        },
      }),
    };
  }
  return origLoad.apply(this, arguments);
};

process.env.SUPABASE_URL = 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = 'stub-key';
const db = require('../database.js');
Module._load = origLoad;

// A rider row exactly as Postgres hands it back — hash and all.
const riderRow = () => ({
  id: 7, name: 'Yakubu', email: 'yakubu@sdgmart.com', phone: '+233241234567',
  password_hash: '$2b$12$SOMEREALBCRYPTHASHVALUEHERE0123456789abcdefghij',
  online: true, lat: 9.4075, lng: -0.8533,
  last_location_at: '2026-09-05T11:30:00.000Z', created_at: '2026-01-01T00:00:00.000Z',
});
const orderRow = (status, over = {}) => ({
  id: 115, user_id: 42, rider_id: 7, status,
  location: { lat: 9.4008, lng: -0.8393, address: 'Vittin' },
  total: 135, created_at: '2026-09-05T10:00:00.000Z', ...over,
});

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};

(async () => {
  console.log('\nTracking payload — rider projection\n');

  // ── The leak itself ────────────────────────────────────────────────────
  RIDER = riderRow(); ORDER = orderRow('in_transit'); AHEAD = 0;
  let t = await db.orders.getWithTracking(115);

  check('no password hash, under any key spelling', () => {
    const json = JSON.stringify(t);
    assert.ok(!/password/i.test(json), 'payload mentions a password field');
    assert.ok(!json.includes('$2b$'), 'payload carries a bcrypt hash');
  });
  check('no rider email', () => {
    assert.ok(!JSON.stringify(t).includes('yakubu@sdgmart.com'), 'rider email present');
  });
  check('only the four expected rider keys', () => {
    assert.deepStrictEqual(
      Object.keys(t.rider).sort(),
      ['lastLocationAt', 'lat', 'lng', 'name', 'phone'].sort()
    );
  });

  // ── What the page still needs ──────────────────────────────────────────
  check('in_transit → name, coords, phone and fix age all present', () => {
    assert.strictEqual(t.rider.name, 'Yakubu');
    assert.strictEqual(t.rider.lat, 9.4075);
    assert.strictEqual(t.rider.lng, -0.8533);
    assert.strictEqual(t.rider.phone, '+233241234567');
    assert.strictEqual(t.rider.lastLocationAt, '2026-09-05T11:30:00.000Z');
  });

  // ── queueAhead: the field the page has always read ─────────────────────
  RIDER = riderRow(); ORDER = orderRow('assigned'); AHEAD = 0;
  t = await db.orders.getWithTracking(115);
  check('assigned and next → queueAhead 0, position 1, coords live', () => {
    assert.strictEqual(t.queueAhead, 0, 'queueAhead must be a number, not undefined');
    assert.strictEqual(t.queuePosition, 1);
    assert.strictEqual(t.rider.lat, 9.4075);
  });

  RIDER = riderRow(); ORDER = orderRow('assigned'); AHEAD = 2;
  t = await db.orders.getWithTracking(115);
  check('two ahead → queueAhead 2, position 3', () => {
    assert.strictEqual(t.queueAhead, 2);
    assert.strictEqual(t.queuePosition, 3);
  });
  check('two ahead → coords and phone withheld, name kept', () => {
    assert.strictEqual(t.rider.lat, null, 'rider position leaks to the whole queue');
    assert.strictEqual(t.rider.lng, null);
    assert.strictEqual(t.rider.phone, null, 'rider phone leaks to the whole queue');
    assert.strictEqual(t.rider.name, 'Yakubu', 'name is still needed for the queue message');
  });

  // ── After delivery, when the shared link still works for 7 days ─────────
  RIDER = riderRow(); ORDER = orderRow('delivered'); AHEAD = 0;
  t = await db.orders.getWithTracking(115);
  check('delivered → position, phone and fix age all withheld', () => {
    assert.strictEqual(t.rider.lat, null);
    assert.strictEqual(t.rider.phone, null);
    assert.strictEqual(t.rider.lastLocationAt, null);
    assert.strictEqual(t.queueAhead, null, 'no queue once delivered');
  });

  // ── Degenerate cases ───────────────────────────────────────────────────
  RIDER = null; ORDER = orderRow('queued', { rider_id: null }); AHEAD = 0;
  t = await db.orders.getWithTracking(115);
  check('no rider assigned → rider null, queueAhead null, no crash', () => {
    assert.strictEqual(t.rider, null);
    assert.strictEqual(t.queueAhead, null);
    assert.strictEqual(t.order.status, 'queued');
  });

  ORDER = null;
  t = await db.orders.getWithTracking(999);
  check('unknown order → null', () => assert.strictEqual(t, null));

  console.log(failures ? `\n${failures} FAILED\n` : '\nAll tracking-payload checks passed.\n');
  process.exit(failures ? 1 : 0);
})();
