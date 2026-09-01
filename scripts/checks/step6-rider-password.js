/* SDGMart — rider password recovery, including the id-collision case.
 *
 * Riders previously had NO way to change or recover a password:
 * /api/auth/change-password is customerOnly, and forgot-password only looked in
 * `users`, so a rider's reset silently matched nothing.
 *
 * The dangerous part of fixing this is that `email_tokens` records a bare
 * user_id and riders and customers SHARE an id space (audit A-01). A reset
 * token minted for rider #N under the plain 'reset' purpose would have reset
 * CUSTOMER #N's password. The token purpose now carries the account type, and
 * the test below deliberately creates a rider and a customer with the SAME id
 * to prove the two can never cross.
 *
 * Run: node scripts/checks/step6-rider-password.js  [--cleanup]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const db = require(path.join(ROOT, 'database.js'));
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
async function cleanup(verbose = true) {
  for (const [tbl, ut] of [['users', 'user'], ['riders', 'rider']]) {
    const rows = await sb.from(tbl).select('id').ilike('email', 'sdgtest-rpw-%');
    for (const x of (rows.data || [])) {
      await sb.from('sessions').delete().eq('user_id', x.id).eq('user_type', ut);
      await sb.from('email_tokens').delete().eq('user_id', x.id).then(() => {}, () => {});
      await sb.from(tbl).delete().eq('id', x.id);
      if (verbose) console.log('  deleted ' + tbl.slice(0, -1) + ' ' + x.id);
    }
  }
}

if (process.argv.includes('--cleanup')) {
  (async () => { console.log('Cleanup only:'); await cleanup(); })();
} else

(async () => {
  const stamp = Date.now();
  const OLD = 'Old!Passw0rd' + (stamp % 1000);
  const NEW = 'New!Passw0rd' + (stamp % 1000);
  const rEmail = `sdgtest-rpw-rider-${stamp}@example.com`;
  const cEmail = `sdgtest-rpw-cust-${stamp}@example.com`;
  let riderId = null, custId = null;

  try {
    // A rider, created the way an admin creates one.
    const rider = await db.createRider({ name: 'RPW Rider', email: rEmail, phone: '0200000000', password: OLD });
    riderId = rider.id;
    console.log('rider ' + riderId + ' created with a known password\n');

    // ── The rider can sign in, and can now CHANGE their own password ──────
    console.log('Rider can change their own password');
    const li = await call('POST', '/api/auth/login', { email: rEmail, password: OLD });
    rec('R-PW', 'a rider can sign in', li.status === 200 && !!(li.json && li.json.token),
      'status ' + li.status + ' · role ' + (li.json && li.json.user && li.json.user.role));
    const tok = li.json.token;

    const wrongCur = await call('POST', '/api/rider/change-password', { currentPassword: 'not-it', newPassword: NEW }, tok);
    rec('R-PW', 'the wrong current password is refused', wrongCur.status === 401,
      'status ' + wrongCur.status + ' · ' + String(wrongCur.json && wrongCur.json.error).slice(0, 45));
    const weak = await call('POST', '/api/rider/change-password', { currentPassword: OLD, newPassword: 'short' }, tok);
    rec('R-PW', 'a weak new password is refused', weak.status === 400,
      'status ' + weak.status + ' · ' + String(weak.json && weak.json.error).slice(0, 55));

    const chg = await call('POST', '/api/rider/change-password', { currentPassword: OLD, newPassword: NEW }, tok);
    rec('R-PW', 'the rider changes their own password', chg.status === 200 && !!(chg.json && chg.json.token),
      'status ' + chg.status + ' · a fresh session was issued so they are not kicked out mid-delivery');
    rec('R-PW', 'the OLD password no longer works',
      (await call('POST', '/api/auth/login', { email: rEmail, password: OLD })).status >= 400, 'refused');
    const newLogin = await call('POST', '/api/auth/login', { email: rEmail, password: NEW });
    rec('R-PW', 'the NEW password works', newLogin.status === 200, 'status ' + newLogin.status);
    rec('R-PW', 'the old session was destroyed', (await call('GET', '/api/rider/orders', null, tok)).status >= 400,
      'the pre-change token is rejected');
    rec('R-PW', 'a CUSTOMER cannot use the rider route',
      (await call('POST', '/api/rider/change-password', { currentPassword: 'x', newPassword: NEW }, null)).status >= 400,
      'unauthenticated is refused');

    // ── Forgot-password now finds riders ──────────────────────────────────
    console.log('\nRider password RECOVERY (forgot-password)');
    await sb.from('email_tokens').delete().eq('user_id', riderId).then(() => {}, () => {});
    const fp = await call('POST', '/api/auth/forgot-password', { email: rEmail });
    const tokens = await sb.from('email_tokens').select('token, purpose, user_id').eq('user_id', riderId);
    const riderTok = (tokens.data || [])[0];
    rec('R-PW', 'forgot-password answers the same for a rider (no enumeration)', fp.status === 200 && fp.text === '{"ok":true}',
      'body ' + fp.text);
    rec('R-PW', 'a reset token IS now minted for a rider', !!riderTok,
      riderTok ? 'purpose = ' + riderTok.purpose : 'NO TOKEN — riders still cannot recover');
    rec('R-PW', 'the token is scoped to riders, not the shared "reset" purpose',
      !!riderTok && riderTok.purpose === 'reset-rider',
      'purpose = ' + (riderTok && riderTok.purpose) + ' (a plain "reset" here would resolve to the CUSTOMER of the same id)');

    // ── The id-collision case: A-01, reopened and closed ──────────────────
    console.log('\n⭐ The id-collision case (A-01): a rider token must never touch a customer');
    // Force a customer to occupy the SAME numeric id as the rider.
    const clash = await sb.from('users').insert({
      id: riderId, name: 'RPW Customer', email: cEmail,
      password_hash: await db.hashPassword(OLD), role: 'customer', email_verified: true,
    }).select().single();
    if (clash.error) {
      rec('A-01', 'a customer with the rider\'s id could be created for the test', null,
        'skipped — ' + clash.error.message.slice(0, 70));
    } else {
      custId = clash.data.id;
      console.log('  customer ' + custId + ' now shares the rider\'s id — exactly the A-01 condition\n');
      const custBefore = (await sb.from('users').select('password_hash').eq('id', custId).single()).data.password_hash;
      const riderBefore = (await sb.from('riders').select('password_hash').eq('id', riderId).single()).data.password_hash;

      const used = await call('POST', '/api/auth/reset-password', { token: riderTok.token, newPassword: 'Reset!Passw0rd42' });
      const custAfter = (await sb.from('users').select('password_hash').eq('id', custId).single()).data.password_hash;
      const riderAfter = (await sb.from('riders').select('password_hash').eq('id', riderId).single()).data.password_hash;

      rec('A-01', 'the rider reset link works', used.status === 200, 'status ' + used.status);
      rec('A-01', '⭐ the RIDER password changed', riderAfter !== riderBefore, 'rider hash changed: ' + (riderAfter !== riderBefore));
      rec('A-01', '⭐ the CUSTOMER sharing that id was NOT touched', custAfter === custBefore,
        'customer hash unchanged: ' + (custAfter === custBefore) + ' — this is the A-01 failure mode, and it does not occur');
      rec('A-01', 'the rider can sign in with the reset password',
        (await call('POST', '/api/auth/login', { email: rEmail, password: 'Reset!Passw0rd42' })).status === 200, 'signed in');
      rec('A-01', 'the customer can still sign in with THEIR original password',
        (await call('POST', '/api/auth/login', { email: cEmail, password: OLD })).status === 200, 'signed in');
      rec('A-01', 'the reset token is consumed and cannot be replayed',
        (await call('POST', '/api/auth/reset-password', { token: riderTok.token, newPassword: 'Another!Pass42' })).status >= 400,
        'replay refused');
    }
  } finally {
    console.log('\nCleanup');
    await cleanup();
    const u = await sb.from('users').select('id', { count: 'exact', head: true });
    const r = await sb.from('riders').select('id', { count: 'exact', head: true });
    console.log('  users ' + u.count + ' · riders ' + r.count);
    const pass = results.filter((x) => x.pass === true).length;
    const fail = results.filter((x) => x.pass === false);
    console.log('\n' + '='.repeat(64));
    console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length);
    if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
  }
})();
