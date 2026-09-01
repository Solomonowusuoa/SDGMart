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
  'supabase-schema-constraints-2.sql',
  'supabase-schema-updated-at.sql',
  'supabase-schema-aggregates.sql',
  'supabase-schema-consent.sql',
  'supabase-schema-stock-holds.sql',
  'supabase-schema-lifetime-spend.sql',
];

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── Rollback (audit finding G-06) ─────────────────────────────────────────
// Render can roll back to the previous commit, but the SQL files were
// apply-only. Reverting code that shipped with a migration left the schema
// ahead of the application with no documented way back — the same coupling
// that caused the HANDOFF §10 outage, pointing the other way.
//
// A migration may end with a rollback section:
//
//   -- ══ DOWN ══
//   drop index if exists whatever_idx;
//
// Everything above the marker is the migration; everything below undoes it.
// `up` never runs the DOWN half. A file with no DOWN section is not
// reversible by this tool — say so plainly rather than improvising under
// pressure. The base schema files are deliberately in that category: undoing
// them means dropping tables, which is a restore-from-backup decision.
const DOWN_MARKER = /^--\s*(?:═+\s*)?DOWN(?:\s*═+)?\s*$/m;
function splitMigration(sql) {
  const m = sql.match(DOWN_MARKER);
  if (!m) return { up: sql, down: null };
  let down = sql.slice(m.index + m[0].length);
  // The rollback is wrapped in a block comment so that pasting the whole file
  // into the Supabase SQL editor cannot undo the migration it just applied —
  // the editor does not know the marker means "stop". Unwrap it here.
  const open = down.indexOf('/*');
  const close = down.lastIndexOf('*/');
  if (open !== -1 && close > open) down = down.slice(open + 2, close);
  return { up: sql.slice(0, m.index), down };
}

// The invariant that matters is that the SQL which was APPLIED has not
// changed. A DOWN section is added after the fact by design — rollback for a
// migration you already ran is exactly when you need it — so appending one
// must not read as tampering. Checksums therefore cover the UP half only.
//
// Records written before this change hashed the whole file, which for a file
// with no DOWN section is the same bytes. Accept any of the historical forms
// so adding rollback to an applied migration does not light up as CHANGED.
function checksumForms(f) {
  const raw = read(f);
  const up = splitMigration(raw).up;
  const trimmed = up.trimEnd();
  const NL = String.fromCharCode(10);
  const lf = (t) => t.split(String.fromCharCode(13) + NL).join(NL);
  // The trailing-newline variants matter: a DOWN section is appended after a
  // blank line, so `up` carries whitespace the original file did not.
  return new Set([
    sha(raw), sha(up), sha(trimmed), sha(trimmed + NL),
    sha(lf(raw)), sha(lf(up)), sha(lf(trimmed)), sha(lf(trimmed) + NL),
  ]);
}
function checksumOk(rec, f) {
  if (!rec || !rec.checksum) return true;
  return checksumForms(f).has(rec.checksum);
}

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
    else if (rec) mark = checksumOk(rec, f) ? '  applied ' : '  CHANGED ';
    console.log(mark + f + (rec ? '   ' + String(rec.applied_at).slice(0, 19) : ''));
  }
  const pending = ORDER.filter((f) => !done.has(f) && fs.existsSync(path.join(ROOT, f)));
  console.log('\n' + pending.length + ' pending' + (pending.length ? ': ' + pending.join(', ') : '') + '\n');
  // CHANGED means a file was edited after being applied. Migrations are meant to
  // be immutable once run — edit forward in a new file instead.
  const changed = ORDER.filter((f) => done.get(f) && fs.existsSync(path.join(ROOT, f)) && !checksumOk(done.get(f), f));
  if (changed.length) console.log('WARNING: edited after being applied: ' + changed.join(', ') + '\n');
}

async function up() {
  const done = await applied();
  const pending = ORDER.filter((f) => !done.has(f) && fs.existsSync(path.join(ROOT, f)));
  if (!pending.length) return console.log('Nothing pending.');
  for (const f of pending) {
    const sql = read(f);
    process.stdout.write('applying ' + f + ' ... ');
    const { error } = await sb.rpc('exec_sql', { sql: splitMigration(sql).up });
    if (error) {
      console.log('FAILED');
      console.error('  ' + error.message);
      console.error('\nStopped. Nothing after this file was applied.');
      process.exit(1);
    }
    await sb.from('schema_migrations').insert({ filename: f, checksum: sha(splitMigration(sql).up.trimEnd()) });
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
  await sb.from('schema_migrations').upsert({ filename: f, checksum: sha(splitMigration(read(f)).up.trimEnd()) });
  console.log('Marked as applied (not executed): ' + f);
}

async function down(f) {
  if (!f || !ORDER.includes(f)) {
    console.error('Usage: node scripts/migrate.js down <filename>');
    console.error('Known files:');
    for (const k of ORDER) console.error('  ' + k);
    process.exit(1);
  }
  const done = await applied();
  if (!done.has(f)) {
    console.error(f + ' is not recorded as applied — nothing to roll back.');
    process.exit(1);
  }
  const { down: sql } = splitMigration(read(f));
  if (!sql || !sql.trim()) {
    console.error(f + ' has no DOWN section, so this tool cannot reverse it.');
    console.error('That is deliberate for the base schema files: undoing them drops');
    console.error('tables and loses data. Roll back by restoring a backup instead.');
    process.exit(1);
  }
  // Only ever the one file named — rolling back a whole chain unattended is
  // how a bad afternoon becomes a lost database.
  process.stdout.write('rolling back ' + f + ' ... ');
  const { error } = await sb.rpc('exec_sql', { sql });
  if (error) {
    console.log('FAILED');
    console.error('  ' + error.message);
    console.error('');
    console.error('The migration is still recorded as applied.');
    process.exit(1);
  }
  await sb.from('schema_migrations').delete().eq('filename', f);
  console.log('ok');
  console.log('');
  console.log(f + ' rolled back and un-recorded. `up` will re-apply it.');
}

const [cmd, arg] = process.argv.slice(2);
({ status, up, mark, down }[cmd] || (() => {
  console.log('Usage: node scripts/migrate.js status | up | mark <filename> | down <filename>');
  process.exit(1);
}))(arg).catch((e) => { console.error(e.message); process.exit(1); });
