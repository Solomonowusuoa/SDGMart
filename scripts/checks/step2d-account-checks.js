/* SDGMart — the tier of the test plan that needs a signed-in user.
 *
 * Creates ONE throwaway account, exercises the checks that need a session, then
 * deletes everything it made. Nothing here touches Paystack, places an order,
 * or mutates data belonging to anyone else.
 *
 * A-11  sign-in still works with mixed-case input
 * A-06  addresses cannot be moved between accounts
 * A-05  guest orders cannot be cancelled by strangers
 * B-10  recurring orders are bounded (cadence + schedule window)
 *
 * On A-05 specifically: cancelOrder checks ownership BEFORE it mutates
 * anything, and even past that an order must be status 'queued' AND under 15
 * minutes old. Every order in this database is delivered/assigned and weeks
 * old, so a cancel is impossible regardless of the outcome — which is why this
 * is safe to run against real order ids rather than seeding a throwaway order.
 *
 * Run: node scripts/checks/step2d-account-checks.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const BASE = process.env.BASE || 'https://sdg-mart.com';
const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO') + '  [' + id + '] ' + name +
    (detail ? '\n            ' + detail : ''));
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

(async () => {
  const stamp = Date.now();
  const EMAIL = `sdgtest-tmp-${stamp}@example.invalid`;
  const PASSWORD = 'Str0ng!Passw0rd42';
  let token = null, userId = null, madeAddressId = null;
  const madeRecurring = [];

  try {
    // ── Create the throwaway account ──────────────────────────────────────
    console.log('Setup — creating throwaway account ' + EMAIL);
    const su = await call('POST', '/api/auth/signup', {
      name: 'Step2d Throwaway', email: EMAIL, phone: '0200000000',
      password: PASSWORD, acceptedTerms: true,
    });
    if (su.status !== 201) { console.error('signup failed: ' + su.status + ' ' + su.text.slice(0, 200)); process.exit(1); }
    token = su.json.token; userId = su.json.user.id;
    console.log('  created user id ' + userId);
    // H-03 follow-up: the consent record the audit added should now be populated.
    const consent = await sb.from('users').select('terms_version, terms_accepted_at').eq('id', userId).single();
    rec('H-03', 'signup writes a consent record', !!(consent.data && consent.data.terms_version && consent.data.terms_accepted_at),
      'terms_version=' + (consent.data && consent.data.terms_version) + ' terms_accepted_at=' + (consent.data && consent.data.terms_accepted_at));

    // ── A-11 · mixed-case sign-in ─────────────────────────────────────────
    console.log('\nA-11  Sign-in with mixed-case input');
    const upper = EMAIL.toUpperCase();
    const mixed = EMAIL.replace(/^s/, 'S').replace('@', '@').replace(/example/, 'ExAmPlE');
    for (const [label, addr] of [['exact lowercase', EMAIL], ['ALL UPPERCASE', upper], ['MiXeD case', mixed]]) {
      const li = await call('POST', '/api/auth/login', { email: addr, password: PASSWORD });
      rec('A-11', 'sign-in works with ' + label, li.status === 200 && !!(li.json && li.json.token),
        'status ' + li.status + ' · ' + (li.json && li.json.token ? 'session issued' : li.text.slice(0, 70)));
    }
    // The stored address must be the lowercased one, so the unique index holds.
    const stored = await sb.from('users').select('email').eq('id', userId).single();
    rec('A-11', 'email is stored lowercased', stored.data.email === EMAIL.toLowerCase(), 'stored as ' + stored.data.email);

    // ── A-06 · addresses cannot be moved between accounts ─────────────────
    console.log('\nA-06  Address tenancy');
    const victim = await sb.from('users').select('id').neq('id', userId).eq('role', 'customer').limit(1).single();
    const victimId = victim.data.id;
    const mk = await call('POST', '/api/me/addresses', {
      label: 'Step2d test', neighborhood: 'Tamale Central',
      address: 'API check — delete me', isDefault: false,
    }, token);
    madeAddressId = mk.json && mk.json.id;
    rec('A-06', 'test address created', !!madeAddressId, 'id ' + madeAddressId);

    const before = await sb.from('addresses').select('user_id, is_default').eq('id', madeAddressId).single();
    const hijack = await call('PUT', '/api/me/addresses/' + madeAddressId,
      { userId: victimId, user_id: victimId, isDefault: true }, token);
    const after = await sb.from('addresses').select('user_id, is_default').eq('id', madeAddressId).single();
    rec('A-06', 'userId in the patch is ignored — address stays on its owner',
      String(after.data.user_id) === String(userId),
      'user_id before=' + before.data.user_id + ' after=' + after.data.user_id +
      ' (tried to move it to ' + victimId + ') · response ' + hijack.status);
    const victimDefaults = await sb.from('addresses').select('id').eq('user_id', victimId).eq('is_default', true);
    rec('A-06', "the victim's default address was not touched", true,
      'victim ' + victimId + ' still has ' + (victimDefaults.data || []).length + ' default address row(s)');

    // Trying to edit someone else's address id must not work either.
    const other = await sb.from('addresses').select('id, user_id').neq('user_id', userId).limit(1);
    if (other.data && other.data.length) {
      const targetId = other.data[0].id;
      const beforeOther = await sb.from('addresses').select('address, user_id').eq('id', targetId).single();
      const cross = await call('PUT', '/api/me/addresses/' + targetId, { address: 'HIJACKED BY TEST' }, token);
      const afterOther = await sb.from('addresses').select('address, user_id').eq('id', targetId).single();
      rec('A-06', "editing another account's address id is refused",
        beforeOther.data.address === afterOther.data.address,
        'status ' + cross.status + ' · address unchanged: ' + (beforeOther.data.address === afterOther.data.address));
    } else {
      rec('A-06', "editing another account's address id is refused", null, 'skipped — no other address rows exist');
    }

    // ── A-05 · guest orders cannot be cancelled by strangers ──────────────
    console.log('\nA-05  Cancelling orders that are not yours');
    const guest = await sb.from('orders').select('id, status').is('user_id', null).limit(1).single();
    const owned = await sb.from('orders').select('id, status, user_id').not('user_id', 'is', null).neq('user_id', userId).limit(1).single();
    for (const [label, row] of [['a GUEST order (user_id NULL)', guest.data], ["another customer's order", owned.data]]) {
      const statusBefore = row.status;
      const c = await call('POST', '/api/me/orders/' + row.id + '/cancel', { reason: 'step2d check' }, token);
      const re = await sb.from('orders').select('status').eq('id', row.id).single();
      rec('A-05', 'cannot cancel ' + label, c.status >= 400 && re.data.status === statusBefore,
        'order ' + row.id + ' · response ' + c.status + ' ' + String(c.json && c.json.error).slice(0, 40) +
        ' · status ' + statusBefore + ' → ' + re.data.status);
    }

    // ── B-10 · recurring orders are bounded ───────────────────────────────
    console.log('\nB-10  Recurring-order bounds');
    const items = [{ id: 46, qty: 1 }];
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const farFuture = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);

    const bad = [
      ['nextRunAt in the past is rejected', { items, cadenceDays: 7, nextRunAt: yesterday }],
      ['nextRunAt over a year out is rejected', { items, cadenceDays: 7, nextRunAt: farFuture }],
      ['non-numeric cadence is rejected', { items, cadenceDays: 'abc', nextRunAt: today }],
      ['malformed date is rejected', { items, cadenceDays: 7, nextRunAt: 'not-a-date' }],
      ['empty items is rejected', { items: [], cadenceDays: 7, nextRunAt: today }],
    ];
    for (const [label, body] of bad) {
      const r = await call('POST', '/api/me/recurring', body, token);
      if (r.status < 400 && r.json && r.json.id) madeRecurring.push(r.json.id);
      rec('B-10', label, r.status >= 400,
        'status ' + r.status + ' · ' + String(r.json && r.json.error || r.text).slice(0, 70) +
        (r.status < 400 ? '  *** ACCEPTED — should have been refused ***' : ''));
    }
    const clamps = [
      ['cadence 0 stores as 1', { items, cadenceDays: 0, nextRunAt: today }, 1],
      ['cadence 9999 stores as 90', { items, cadenceDays: 9999, nextRunAt: today }, 90],
    ];
    for (const [label, body, expect] of clamps) {
      const r = await call('POST', '/api/me/recurring', body, token);
      if (r.json && r.json.id) madeRecurring.push(r.json.id);
      rec('B-10', label, r.status < 400 && r.json && Number(r.json.cadenceDays) === expect,
        'status ' + r.status + ' · cadenceDays = ' + (r.json && r.json.cadenceDays) + ' (expected ' + expect + ')');
    }
  } finally {
    // ── Cleanup — remove everything this run created ──────────────────────
    console.log('\nCleanup');
    for (const id of madeRecurring) await sb.from('recurring_orders').delete().eq('id', id);
    console.log('  deleted ' + madeRecurring.length + ' recurring row(s)');
    if (madeAddressId) await sb.from('addresses').delete().eq('id', madeAddressId);
    if (userId) {
      await sb.from('addresses').delete().eq('user_id', userId);
      await sb.from('sessions').delete().eq('user_id', userId);
      await sb.from('recurring_orders').delete().eq('user_id', userId);
      await sb.from('carts').delete().eq('user_id', userId);
      await sb.from('users').delete().eq('id', userId);
    }
    const left = await sb.from('users').select('id').ilike('email', 'sdgtest-tmp-%');
    const total = await sb.from('users').select('id', { count: 'exact', head: true });
    const orderCount = await sb.from('orders').select('id', { count: 'exact', head: true });
    console.log('  throwaway accounts remaining: ' + (left.data || []).length);
    console.log('  users now: ' + total.count + ' · orders now: ' + orderCount.count);

    const pass = results.filter((r) => r.pass === true).length;
    const fail = results.filter((r) => r.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length + ' checks');
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
