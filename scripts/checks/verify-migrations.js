/* Read-only verification that each migration's objects actually exist.
   Columns/tables are probed over PostgREST. Indexes, functions, RLS flags and
   constraints are not reachable that way, so they are probed with a DO block
   that only ever RAISES its answer back through exec_sql — nothing is written. */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// table/column existence
async function col(table, column) {
  const { error } = await sb.from(table).select(column).limit(1);
  return { ok: !error, detail: error ? error.message.slice(0, 60) : '' };
}
// anything else: ask Postgres a yes/no question, get it back as an exception
async function ask(expr) {
  const sql = "do $$ begin if (" + expr + ") then raise exception 'PROBE_YES'; else raise exception 'PROBE_NO'; end if; end $$";
  const { error } = await sb.rpc('exec_sql', { sql });
  const m = error ? (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '') : '';
  if (m.includes('PROBE_YES')) return { ok: true, detail: '' };
  if (m.includes('PROBE_NO')) return { ok: false, detail: 'not present' };
  return { ok: false, detail: 'probe failed: ' + m.slice(0, 70) };
}
const idx = (n) => ask("exists(select 1 from pg_indexes where indexname='" + n + "')");
const fn = (n) => ask("exists(select 1 from pg_proc where proname='" + n + "')");
const con = (n) => ask("exists(select 1 from pg_constraint where conname='" + n + "')");
const rls = (t) => ask("exists(select 1 from pg_class where relname='" + t + "' and relrowsecurity)");
const nullable = (t, c) => ask("exists(select 1 from information_schema.columns where table_name='" + t + "' and column_name='" + c + "' and is_nullable='YES')");

const CHECKS = {
  'supabase-schema.sql': [['table products', () => col('products', 'id')], ['table users', () => col('users', 'id')], ['table orders', () => col('orders', 'id')], ['table riders', () => col('riders', 'id')]],
  'supabase-schema-additions.sql': [['table addresses', () => col('addresses', 'id')], ['table reviews', () => col('reviews', 'id')], ['table issue_reports', () => col('issue_reports', 'id')]],
  'supabase-schema-requests.sql': [['table product_requests', () => col('product_requests', 'id')]],
  'supabase-schema-ops.sql': [['table error_logs', () => col('error_logs', 'id')]],
  'supabase-rls-fix.sql': [['rls on products', () => rls('products')], ['rls on users', () => rls('users')], ['rls on orders', () => rls('orders')]],
  'supabase-schema-paystack.sql': [['orders.paystack_ref', () => col('orders', 'paystack_ref')], ['table pending_payments', () => col('pending_payments', 'draft')]],
  'supabase-schema-referrals.sql': [['table referrals', () => col('referrals', 'month')], ['users.referred_by', () => col('users', 'referred_by')], ['users.referral_credited', () => col('users', 'referral_credited')]],
  'supabase-schema-feedback.sql': [['issue_reports.order_id nullable', () => nullable('issue_reports', 'order_id')]],
  'supabase-schema-delivered-at.sql': [['orders.delivered_at', () => col('orders', 'delivered_at')]],
  'supabase-schema-order-reviews.sql': [['idx reviews_one_per_order', () => idx('reviews_one_per_order')], ['reviews.product_id nullable', () => nullable('reviews', 'product_id')]],
  'supabase-schema-cart.sql': [['table carts', () => col('carts', 'items')]],
  'supabase-schema-tweaks.sql': [['orders.delivery_slot', () => col('orders', 'delivery_slot')], ['users.birthday_gift_claimed_year', () => col('users', 'birthday_gift_claimed_year')], ['idx users_birthday_idx', () => idx('users_birthday_idx')]],
  'supabase-schema-order-idempotency.sql': [['orders.client_request_id', () => col('orders', 'client_request_id')], ['idx orders_client_request_id_uniq', () => idx('orders_client_request_id_uniq')]],
  'supabase-schema-indexes-and-email.sql': [['idx orders_created_at_idx', () => idx('orders_created_at_idx')], ['idx orders_user_created_idx', () => idx('orders_user_created_idx')], ['idx orders_rider_status_idx', () => idx('orders_rider_status_idx')], ['idx users_email_lower_uniq', () => idx('users_email_lower_uniq')], ['idx riders_email_lower_uniq', () => idx('riders_email_lower_uniq')], ['all emails lowercased', () => ask('(select count(*) from users where email <> lower(trim(email)))=0')]],
  'supabase-schema-constraints.sql': [['idx orders_paystack_ref_uniq', () => idx('orders_paystack_ref_uniq')], ['idx referrals_pair_uniq', () => idx('referrals_pair_uniq')], ['idx addresses_one_default_per_user', () => idx('addresses_one_default_per_user')]],
  'supabase-schema-constraints-2.sql': [['idx reviews_one_per_order', () => idx('reviews_one_per_order')]],
  'supabase-schema-updated-at.sql': [['fn set_updated_at', () => fn('set_updated_at')], ['addresses.updated_at', () => col('addresses', 'updated_at')], ['table order_events', () => col('order_events', 'id')]],
  'supabase-schema-aggregates.sql': [['fn search_top_queries', () => fn('search_top_queries')], ['fn search_unmatched_queries', () => fn('search_unmatched_queries')], ['idx search_queries_created_at_idx', () => idx('search_queries_created_at_idx')]],
  'supabase-schema-consent.sql': [['users.terms_version', () => col('users', 'terms_version')], ['users.terms_accepted_at', () => col('users', 'terms_accepted_at')]],
  'supabase-schema-lifetime-spend.sql': [['users.lifetime_spent', () => col('users', 'lifetime_spent')], ['no customer has a negative lifetime', () => ask("(select count(*) from users where lifetime_spent < 0)=0")]],
  'supabase-schema-rider-tokens.sql': [['email_tokens.rider_id', () => col('email_tokens', 'rider_id')], ['user_id is now nullable', () => nullable('email_tokens', 'user_id')], ['purpose CHECK allows reset-rider', () => ask("exists(select 1 from pg_constraint where conname='email_tokens_purpose_check' and pg_get_constraintdef(oid) like '%reset-rider%')")], ['exactly-one-owner CHECK exists', () => con('email_tokens_one_owner')]],
  'supabase-schema-stock-holds.sql': [['table stock_holds', () => col('stock_holds', 'id')], ['fn stock_available', () => fn('stock_available')], ['fn hold_stock', () => fn('hold_stock')], ['fn release_stock_hold', () => fn('release_stock_hold')], ['fn commit_stock_hold', () => fn('commit_stock_hold')], ['fn consume_stock', () => fn('consume_stock')], ['fn restock_items', () => fn('restock_items')], ['fn expire_stock_holds', () => fn('expire_stock_holds')]],
};

(async () => {
  const verified = [], incomplete = [];
  for (const [file, checks] of Object.entries(CHECKS)) {
    const results = [];
    for (const [label, run] of checks) results.push([label, await run()]);
    const bad = results.filter(([, r]) => !r.ok);
    console.log((bad.length ? 'INCOMPLETE ' : 'VERIFIED   ') + file);
    for (const [label, r] of results) console.log('      ' + (r.ok ? 'ok  ' : 'MISS') + '  ' + label + (r.detail ? '   (' + r.detail + ')' : ''));
    (bad.length ? incomplete : verified).push(file);
  }
  console.log('\n=== ' + verified.length + ' fully verified, ' + incomplete.length + ' incomplete ===');
  if (incomplete.length) console.log('Do NOT mark: ' + incomplete.join(', '));
  require('fs').writeFileSync(path.join(__dirname, 'verified.json'), JSON.stringify({ verified, incomplete }, null, 2));
})();
