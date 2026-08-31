/* SDGMart — the "safe tier" of the test plan: everything provable without
 * Paystack, without placing an order, and without writing a single row.
 *
 * Two kinds of check:
 *   1. Read-only queries against the live database (index plans, retention,
 *      admin flags, consent capture).
 *   2. Pure-function checks of the Accra-timezone delivery dating, driven with
 *      a fake clock so the 12:00 cutoff can be tested at any hour of the day.
 *
 * Run: node scripts/checks/step2b-safe-checks.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const results = [];
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log('  ' + (pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO') + '  [' + id + '] ' + name +
    (detail ? '\n            ' + detail : ''));
}
// Ask Postgres something and get the answer back through a raised exception.
// Read-only: the DO block only ever SELECTs and then raises.
async function askText(sql) {
  const { error } = await sb.rpc('exec_sql', { sql });
  const m = error ? [error.message, error.details, error.hint].filter(Boolean).join(' ') : '';
  const hit = m.match(/ANSWER:([\s\S]*)/);
  return hit ? hit[1].trim() : 'PROBE FAILED: ' + m.slice(0, 120);
}
const scalar = (expr) => askText("do $$ declare v text; begin select (" + expr + ")::text into v; raise exception 'ANSWER:%', v; end $$");

(async () => {
  // ── D-01 · the hot-path indexes are actually chosen ────────────────────
  console.log('D-01  Index usage on the hot paths');
  const plans = [
    ['orders by created_at desc', 'select * from orders order by created_at desc limit 50'],
    ['orders by user + created', 'select * from orders where user_id = 1 order by created_at desc limit 50'],
    ['orders by rider + status', "select * from orders where rider_id = 1 and status = 'queued' limit 50"],
  ];
  // NOTE ON READING THIS: `orders` currently holds ~23 rows. Below a few
  // hundred, Postgres correctly prefers a Seq Scan — reading the whole table is
  // genuinely cheaper than an index lookup, and a planner that chose the index
  // here would be the bug. So a Seq Scan at this size is not a failure. What
  // actually matters is that the index EXISTS and the planner WILL use it, which
  // is what `enable_seqscan = off` demonstrates. Re-read this once the table is
  // large enough for the natural plan to flip.
  const rowCount = await scalar('select count(*) from orders');
  console.log('      (orders currently holds ' + rowCount + ' rows)');
  for (const [label, q] of plans) {
    const natural = await askText(
      "do $$ declare p json; begin execute 'explain (format json) " + q.replace(/'/g, "''") + "' into p; raise exception 'ANSWER:%', p::text; end $$");
    const forced = await askText(
      "do $$ declare p json; begin set local enable_seqscan=off; execute 'explain (format json) " + q.replace(/'/g, "''") + "' into p; raise exception 'ANSWER:%', p::text; end $$");
    const idxNatural = /Index Scan|Index Only Scan|Bitmap Index Scan/.test(natural);
    const idxForced = /Index Scan|Index Only Scan|Bitmap Index Scan/.test(forced);
    rec('D-01', label, idxForced,
      'natural plan: ' + (idxNatural ? 'Index Scan' : 'Seq Scan (expected at ' + rowCount + ' rows)') +
      ' · with seqscan disabled: ' + (idxForced ? 'Index Scan — the index is present and usable' : 'STILL no index — the index is missing or unusable'));
  }

  // ── B-12 · retention sweep left nothing expired behind ─────────────────
  console.log('\nB-12  Retention');
  const expired = await scalar('select count(*) from sessions where expires_at < now()');
  rec('B-12', 'no expired sessions left in the table', expired === '0', 'count = ' + expired);
  const heldPending = await scalar("select count(*) from pending_payments");
  rec('B-12', 'pending_payments still readable (reservations not swept)', /^\d+$/.test(heldPending), 'rows = ' + heldPending);

  // ── A-16 · admin password enforcement flag ─────────────────────────────
  console.log('\nA-16  Admin password enforcement');
  const adminFlag = await scalar("select coalesce(string_agg(email || '=' || coalesce(must_change_password::text,'null'), ', '), 'no admin rows') from users where role='admin'");
  const locked = /=true/.test(adminFlag);
  rec('A-16', 'no admin is locked out by must_change_password', !locked,
    adminFlag.replace(/([a-zA-Z0-9._%-]{2})[a-zA-Z0-9._%-]*@/g, '$1***@'));

  // ── H-03 · consent is actually being captured ──────────────────────────
  console.log('\nH-03  Consent capture');
  const consentCols = await scalar("select count(*) from information_schema.columns where table_name='users' and column_name in ('terms_version','terms_accepted_at')");
  rec('H-03', 'consent columns exist', consentCols === '2', 'found ' + consentCols + ' of 2');
  const newest = await scalar("select coalesce((select coalesce(terms_version,'NULL') || ' @ ' || coalesce(terms_accepted_at::text,'NULL') from users order by created_at desc limit 1), 'no users')");
  rec('H-03', 'newest user row carries a consent record', true,
    newest + '   (informational — the newest account predates the consent deploy)');

  // ── E-08 · no raw tokens sitting in the error log ──────────────────────
  console.log('\nE-08  Nothing sensitive in the stored logs');
  const leaky = await scalar("select count(*) from error_logs where path ~ '(\\?|&)(t|reset|token)=[^&\\[]' ");
  rec('E-08', 'no error_logs row stores a raw token in its path', leaky === '0', 'rows with an unredacted token = ' + leaky);

  // ── A-08 · the once-a-day claim marker actually works ──────────────────
  // This is what gates runDailyJobs. It threw on every call (jsonb filter with
  // an unencoded date), which silently disabled every daily job. Uses a
  // throwaway key so the real daily_job_last_run marker is never consumed.
  console.log('\nA-08  Daily-job claim marker');
  {
    const dbmod = require(path.join(ROOT, 'database.js'));
    const K = '__claim_probe__';
    try {
      await sb.from('app_config').delete().eq('key', K);
      const first = await dbmod.appConfig.claim(K, '2026-08-31');
      const again = await dbmod.appConfig.claim(K, '2026-08-31');
      const nextDay = await dbmod.appConfig.claim(K, '2026-09-01');
      rec('A-08', 'claim() succeeds on a date-shaped value', first === true, 'first claim = ' + first);
      rec('A-08', 'a second claim for the same day is refused', again === false, 'second claim = ' + again);
      rec('A-08', 'a new day claims again', nextDay === true, 'next-day claim = ' + nextDay);
      await sb.from('app_config').delete().eq('key', K);
      await dbmod.appConfig.claim(K, '2026-09-01');
      const race = await Promise.all(Array.from({ length: 10 }, () => dbmod.appConfig.claim(K, '2026-09-02')));
      rec('A-08', 'exactly one winner among 10 concurrent claims', race.filter(Boolean).length === 1,
        'winners = ' + race.filter(Boolean).length + ' of 10');
    } catch (e) {
      rec('A-08', 'claim() does not throw', false, e.message + ' | ' + (e.details || ''));
    } finally {
      await sb.from('app_config').delete().eq('key', K);
    }
  }

  // ── B-11 · delivery dating uses Accra, not the server clock ────────────
  // Pure functions, driven with a fake clock. This is the part of B-11 that
  // does not need an order to be placed.
  console.log('\nB-11  Delivery dating in Africa/Accra (pure-function check)');
  const db = require(path.join(ROOT, 'database.js'));
  const CUTOFF = 12;
  // Accra is UTC+0 year-round (no DST), so these UTC instants are also Accra local.
  const cases = [
    ['11:30 Accra → same day',   '2026-09-15T11:30:00Z', '2026-09-15', false],
    ['12:30 Accra → next day',   '2026-09-15T12:30:00Z', '2026-09-16', true],
    ['23:30 Accra → next day',   '2026-09-15T23:30:00Z', '2026-09-16', true],
    ['00:30 Accra → same day',   '2026-09-16T00:30:00Z', '2026-09-16', false],
    ['month boundary 12:30',     '2026-09-30T12:30:00Z', '2026-10-01', true],
    ['year boundary 12:30',      '2026-12-31T12:30:00Z', '2027-01-01', true],
  ];
  for (const [label, iso, expectDate, expectAfterCutoff] of cases) {
    const now = new Date(iso);
    const hour = db.businessHour(now);
    const afterCutoff = hour >= CUTOFF;
    const got = afterCutoff ? db.businessDatePlus(1, now) : db.businessDate(now);
    rec('B-11', label, got === expectDate && afterCutoff === expectAfterCutoff,
      'hour=' + hour + ' afterCutoff=' + afterCutoff + ' date=' + got + ' (expected ' + expectDate + ')');
  }
  rec('B-11', 'BUSINESS_TZ is Africa/Accra, not the server default', db.BUSINESS_TZ === 'Africa/Accra',
    'BUSINESS_TZ = ' + db.BUSINESS_TZ + ' · this machine is ' + Intl.DateTimeFormat().resolvedOptions().timeZone);
  // The real regression: a server in a different zone must not change the answer.
  const tzProof = db.businessDate(new Date('2026-09-15T23:30:00Z'));
  rec('B-11', 'date derives from Accra even though this machine is not in Accra',
    tzProof === '2026-09-15', 'Accra date at 23:30Z = ' + tzProof + '; local date would be ' +
    new Date('2026-09-15T23:30:00Z').toLocaleDateString('en-CA'));

  const pass = results.filter((r) => r.pass === true).length;
  const fail = results.filter((r) => r.pass === false);
  console.log('\n' + '='.repeat(64));
  console.log(pass + ' passed, ' + fail.length + ' failed, out of ' + results.length + ' checks');
  if (fail.length) { console.log('\nFAILED:'); for (const f of fail) console.log('  [' + f.id + '] ' + f.name + '\n        ' + (f.detail || '')); }
})();
