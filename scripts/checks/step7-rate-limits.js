/* SDGMart — STEP 6 rate limiting: A-13, A-14, A-15.
 *
 * ⚠️ THIS DELIBERATELY GETS THIS MACHINE'S IP BLOCKED. A-13 sprays sign-ins
 * until the per-IP limiter fires, which then refuses sign-ins from this address
 * for 15 minutes. Run it when nobody needs to use the shop from this
 * connection. Customers on other addresses are unaffected — the buckets are
 * per-IP and the limiter is per-process, in memory.
 *
 * ORDER MATTERS, and it is why the sections are arranged this way:
 *   A-15 (orders)  runs first  — cheapest, and needs a working sign-in
 *   A-14 (load)    runs second — spends the signup allowance (20/hour)
 *   A-13 (spraying) runs LAST  — blocks sign-in from this IP for 15 minutes
 *
 * Accounts are seeded straight into the database rather than through
 * /api/auth/signup, so the signup allowance is reserved for the ONE section
 * that is actually testing it.
 *
 * Run: node scripts/checks/step7-rate-limits.js  [--cleanup]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const MARK = 'STEP7 RATE LIMIT';
const PW = 'Str0ng!Passw0rd42';
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : pass === null ? 'SKIP' : 'INFO') +
    '  [' + id + '] ' + name + (detail ? '\n            ' + detail : ''));
}
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let t = ''; try { t = await r.text(); } catch (_) {}
  let j = null; try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, text: t, json: j, retryAfter: r.headers.get('retry-after') };
}
const delivery = (over = {}) => ({
  customer: MARK, phone: '0200000000', neighborhood: 'Tamale Central',
  address: 'RATE LIMIT TEST — not a real delivery',
  location: { lat: 9.4034, lng: -0.8424, accuracy: 12, source: 'test' },
  ...over,
});
async function cleanup(verbose = true) {
  const o = await sb.from('orders').select('id').eq('customer_name', MARK);
  if (o.data && o.data.length) {
    await sb.from('orders').delete().in('id', o.data.map((r) => r.id));
    if (verbose) console.log('  deleted ' + o.data.length + ' order(s)');
  } else if (verbose) console.log('  no test orders');
  const u = await sb.from('users').select('id').ilike('email', 'sdgtest-rl-%');
  for (const x of (u.data || [])) {
    for (const t of ['reviews', 'addresses', 'recurring_orders', 'carts']) {
      await sb.from(t).delete().eq('user_id', x.id).then(() => {}, () => {});
    }
    await sb.from('sessions').delete().eq('user_id', x.id).eq('user_type', 'user');
    await sb.from('email_tokens').delete().eq('user_id', x.id).then(() => {}, () => {});
    await sb.from('users').delete().eq('id', x.id);
  }
  if (verbose) console.log('  deleted ' + ((u.data || []).length) + ' test account(s)');
}

if (process.argv.includes('--cleanup')) {
  (async () => { console.log('Cleanup only:'); await cleanup(); })();
} else

(async () => {
  const stamp = Date.now();
  // Seeded directly, NOT via /api/auth/signup — the signup allowance is only 20
  // an hour and section A-14 is the one that should spend it.
  const seed = async (tag) => {
    const email = `sdgtest-rl-${tag}-${stamp}@example.com`;
    const r = await sb.from('users').insert({
      name: MARK, email, password_hash: await db.hashPassword(PW),
      role: 'customer', email_verified: true, first_order_done: true,
    }).select().single();
    if (r.error) throw new Error('seed ' + tag + ': ' + r.error.message);
    return { id: r.data.id, email };
  };

  try {
    const alice = await seed('alice');
    const bob = await seed('bob');
    console.log('seeded two accounts on one connection: ' + alice.id + ' and ' + bob.id + '\n');

    // ── A-15 · anonymous write limits must not bite real customers ────────
    console.log('A-15  The order limit does not bite normal use');
    const prod = await sb.from('products').select('id, price').gt('price', 1).order('id').limit(1).single();
    const aTok = (await call('POST', '/api/auth/login', { email: alice.email, password: PW })).json.token;
    const bTok = (await call('POST', '/api/auth/login', { email: bob.email, password: PW })).json.token;

    const aOrder = await call('POST', '/api/orders', {
      items: [{ id: prod.data.id, qty: 1 }], ...delivery(), payMethod: 'cash', clientRequestId: 'rl-a-' + stamp,
    }, aTok);
    rec('A-15', 'a real order is not rate-limited', aOrder.status === 201,
      'status ' + aOrder.status + ' · order ' + (aOrder.json && aOrder.json.id));

    // Two people in one household share a NAT address; both must get through.
    const bOrder = await call('POST', '/api/orders', {
      items: [{ id: prod.data.id, qty: 2 }], ...delivery(), payMethod: 'cash', clientRequestId: 'rl-b-' + stamp,
    }, bTok);
    rec('A-15', 'a second household member on the SAME connection also succeeds', bOrder.status === 201,
      'status ' + bOrder.status + ' · order ' + (bOrder.json && bOrder.json.id) + ' — same IP, minutes apart');

    // A realistic burst: a few orders back to back, well under the 30/10min cap.
    const burst = [];
    for (let i = 0; i < 5; i++) {
      burst.push(await call('POST', '/api/orders', {
        items: [{ id: prod.data.id, qty: 1 }], ...delivery(), payMethod: 'cash', clientRequestId: 'rl-burst-' + i + '-' + stamp,
      }, aTok));
    }
    rec('A-15', 'five more orders in a row stay under the cap', burst.every((r) => r.status === 201),
      'statuses ' + burst.map((r) => r.status).join(',') + ' · the cap is 30 per 10 minutes per IP');

    // ── A-14 · signups under load must not stall the shop ─────────────────
    // scrypt used to run on the event loop, so hashing several passwords at
    // once froze every other request. Fire signups concurrently and watch what
    // the catalogue does WHILE they are in flight.
    console.log('\nA-14  Concurrent signups must not stall browsing');
    const baseline = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await call('GET', '/api/catalog?ts=' + Date.now());
      baseline.push(Date.now() - t0);
    }
    const baseMs = Math.round(baseline.reduce((a, b) => a + b, 0) / baseline.length);

    const N = 6;
    const during = [];
    const signups = Array.from({ length: N }, (_, i) => call('POST', '/api/auth/signup', {
      name: MARK, email: `sdgtest-rl-load${i}-${stamp}@example.com`,
      phone: '0200000000', password: PW, acceptedTerms: true,
    }));
    const poller = (async () => {
      for (let i = 0; i < 6; i++) {
        const t0 = Date.now();
        await call('GET', '/api/catalog?ts=' + Date.now());
        during.push(Date.now() - t0);
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    const signupRes = await Promise.all(signups);
    await poller;
    const worst = Math.max(...during);
    const ok = signupRes.filter((r) => r.status === 201).length;
    const limited = signupRes.filter((r) => r.status === 429).length;
    rec('A-14', N + ' concurrent signups all succeed', ok === N,
      ok + ' created, ' + limited + ' rate-limited, statuses ' + signupRes.map((r) => r.status).join(',') +
      (limited ? '  (the signup cap is 20/hour — earlier tests today spent some of it)' : ''));
    rec('A-14', 'the catalogue stays responsive WHILE passwords are being hashed',
      worst < baseMs * 4 + 1500,
      'idle ' + baseMs + 'ms · during signups ' + during.join('/') + 'ms (worst ' + worst +
      'ms) — scrypt is on the threadpool, so the event loop keeps serving');
    const stillIn = await call('POST', '/api/auth/login', { email: alice.email, password: PW });
    rec('A-14', 'an existing account can still sign in afterwards', stillIn.status === 200,
      'status ' + stillIn.status + ' — password hashes are unchanged in format');

    // ── A-13 · password spraying — RUN LAST, blocks this IP ───────────────
    console.log('\nA-13  Password spraying   ⚠️ this blocks sign-in from this IP for 15 minutes');
    // First, the thing that must NOT trip: one customer fumbling their own
    // password a few times. The per-account bucket allows 5 in 5 minutes.
    const fumbles = [];
    for (let i = 0; i < 3; i++) {
      fumbles.push((await call('POST', '/api/auth/login', { email: bob.email, password: 'wrong' + i })).status);
    }
    const recovered = await call('POST', '/api/auth/login', { email: bob.email, password: PW });
    rec('A-13', 'three wrong passwords do NOT lock a customer out', recovered.status === 200,
      'wrong attempts → ' + fumbles.join(',') + ' then the correct password → ' + recovered.status);

    // Now the attack: one common password against many different addresses.
    // The per-ACCOUNT bucket never fires here (every address is fresh), which
    // is exactly why the per-IP bucket exists.
    let firstBlockAt = null;
    const statuses = [];
    for (let i = 0; i < 60; i++) {
      const r = await call('POST', '/api/auth/login', {
        email: `spray-${i}-${stamp}@example.com`, password: 'CommonPassword1',
      });
      statuses.push(r.status);
      if (r.status === 429 && firstBlockAt === null) { firstBlockAt = i + 1; }
      if (firstBlockAt !== null && i > firstBlockAt + 2) break;
    }
    const blocked = statuses.filter((s) => s === 429).length;
    rec('A-13', 'spraying many different addresses is throttled', firstBlockAt !== null,
      firstBlockAt !== null
        ? 'first 429 after ' + firstBlockAt + ' attempts (cap is 50 per 15 min per IP) · ' + blocked + ' blocked'
        : 'NO 429 in 60 attempts — spraying is NOT throttled');
    const last = await call('POST', '/api/auth/login', { email: alice.email, password: PW });
    rec('A-13', 'once blocked, the message says how long to wait', last.status === 429 && /minute/i.test(String(last.json && last.json.error)),
      'status ' + last.status + ' · ' + String(last.json && last.json.error).slice(0, 70) +
      ' · Retry-After: ' + last.retryAfter + 's');
    rec('A-13', 'the block is scoped to sign-in, not the whole shop',
      (await call('GET', '/api/catalog?ts=' + Date.now())).status === 200,
      'browsing still works while sign-in is blocked — a sprayer cannot take the shop down');
  } finally {
    console.log('\nCleanup');
    await cleanup();
    const o = await sb.from('orders').select('id', { count: 'exact', head: true });
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const open = await sb.from('orders').select('id, status').in('status', ['queued', 'assigned', 'in_transit']);
    console.log('  orders ' + o.count + ' · users ' + u.count);
    console.log('  open orders: ' + JSON.stringify((open.data || []).map((r) => r.id + ':' + r.status)));
    console.log('\n  ⚠️ Sign-in from this IP is blocked for ~15 minutes. Browsing is unaffected.');

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length);
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
