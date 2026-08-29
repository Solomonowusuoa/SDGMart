#!/usr/bin/env node
/**
 * SDGMart migration runner (audit finding B-07).
 *
 * Migrations were sixteen loose .sql files pasted into the Supabase SQL editor
 * by hand, with no version table, no enforced ordering and no record of what had
 * been applied — tracked as prose with tick marks in HANDOFF §4. That has already
 * cost a production day: code shipped ahead of its migration and every order
 * insert failed silently (HANDOFF §10).
 *
 * This records what has run, in a table, and refuses to run anything twice.
 *
 *   node scripts/migrate.js status     what has run, what is pending
 *   node scripts/migrate.js up         apply everything pending, in order
 *   node scripts/migrate.js mark <f>   record a file as applied WITHOUT running
 *                                      it — for the files you have already run
 *                                      by hand (see FIRST RUN below)
 *
 * ── FIRST RUN, on a database that predates this runner ────────────────────
 * Everything through supabase-schema-tweaks.sql has already been applied by
 * hand. Tell the runner that, so it does not try again:
 *
 *   node scripts/migrate.js status
 *   node scripts/migrate.js mark <each file you have already run>
 *   node scripts/migrate.js up          # applies only what is genuinely new
 *
 * On a FRESH staging database, skip the marking and just run `up`.
 *
 * ── Requires ──────────────────────────────────────────────────────────────
 * A one-time helper in the database so this can execute SQL at all. Paste this
 * into the Supabase SQL editor once, per project:
 *
 *   create table if not exists schema_migrations (
 *     filename    text primary key,
 *     applied_at  timestamptz not null default now(),
 *     checksum    text
 *   );
 *
 *   create or replace function exec_sql(sql text) returns void
 *   language plpgsql security definer as $$ begin execute sql; end $$;
 *
 *   revoke all on function exec_sql(text) from public, anon, authenticated;
 *
 * exec_sql is callable only with the service_role key, which never reaches the
 * browser. If you would rather not have it at all, use `status` to see what is
 * pending and paste those files by hand — you still get the record.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required (put them in .env).');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Order matters: later files add columns to tables the earlier ones create.
// Keep this list in sync when adding a migration — it is the source of truth.
const ORDER = [
  'supabase-schema.sql',
  'supabase-schema-additions.sql',
  'supabase-schema-requests.sql',
  'supabase-schema-ops.sql',
  'supabase-rls-fix.sql',
  'supabase-schema-paystack.sql',
  'supabase-schema-referrals.sql',
  'supabase-schema-feedback.sql',
  'supabase-schema-delivered-at.sql',
  'supabase-schema-order-reviews.sql',
  'supabase-schema-cart.sql',
  'supabase-schema-tweaks.sql',
  'supabase-schema-order-idempotency.sql',
  'supabase-schema-indexes-and-email.sql',
  'supabase-schema-constraints.sql',
];

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function applied() {
  const { data, error } = await sb.from('schema_migrations').select('filename, applied_at, checksum');
  if (error) {
    console.error('Could not read schema_migrations. Have you created it? See the header of this file.');
    console.error('  ' + error.message);
    process.exit(1);
  }
  return new Map((data || []).map((r) => [r.filename, r]));
}

async function status() {
  const done = await applied();
  console.log('');
  for (const f of ORDER) {
    const exists = fs.existsSync(path.join(ROOT, f));
    const rec = done.get(f);
    let mark = '  PENDING ';
    if (!exists) mark = '  MISSING ';
    else if (rec) mark = rec.checksum && rec.checksum !== sha(read(f)) ? '  CHANGED ' : '  applied ';
    console.log(mark + f + (rec ? '   ' + String(rec.applied_at).slice(0, 19) : ''));
  }
  const pending = ORDER.filter((f) => !done.has(f) && fs.existsSync(path.join(ROOT, f)));
  console.log('\n' + pending.length + ' pending' + (pending.length ? ': ' + pending.join(', ') : '') + '\n');
  // CHANGED means a file was edited after being applied. Migrations are meant to
  // be immutable once run — edit forward in a new file instead.
  const changed = ORDER.filter((f) => done.get(f) && done.get(f).checksum && fs.existsSync(path.join(ROOT, f)) && done.get(f).checksum !== sha(read(f)));
  if (changed.length) console.log('WARNING: edited after being applied: ' + changed.join(', ') + '\n');
}

async function up() {
  const done = await applied();
  const pending = ORDER.filter((f) => !done.has(f) && fs.existsSync(path.join(ROOT, f)));
  if (!pending.length) return console.log('Nothing pending.');
  for (const f of pending) {
    const sql = read(f);
    process.stdout.write('applying ' + f + ' ... ');
    const { error } = await sb.rpc('exec_sql', { sql });
    if (error) {
      console.log('FAILED');
      console.error('  ' + error.message);
      console.error('\nStopped. Nothing after this file was applied.');
      process.exit(1);
    }
    await sb.from('schema_migrations').insert({ filename: f, checksum: sha(sql) });
    console.log('ok');
  }
  console.log('\nDone. ' + pending.length + ' migration(s) applied.');
}

async function mark(f) {
  if (!f || !ORDER.includes(f)) {
    console.error('Usage: node scripts/migrate.js mark <filename>');
    console.error('Known files:\n  ' + ORDER.join('\n  '));
    process.exit(1);
  }
  await sb.from('schema_migrations').upsert({ filename: f, checksum: sha(read(f)) });
  console.log('Marked as applied (not executed): ' + f);
}

const [cmd, arg] = process.argv.slice(2);
({ status, up, mark }[cmd] || (() => {
  console.log('Usage: node scripts/migrate.js status | up | mark <filename>');
  process.exit(1);
}))(arg).catch((e) => { console.error(e.message); process.exit(1); });
