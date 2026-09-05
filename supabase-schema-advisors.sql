-- SDGMart — Supabase advisor fixes (2026-09-05)
--
-- Paste into Supabase → SQL Editor → Run, or apply with
--   node scripts/migrate.js up
--
-- Safe to re-run. Nothing here changes what the app can do: the server talks to
-- Postgres with the service_role key, which BYPASSES row-level security
-- entirely. RLS is what stops the public anon key reading tables directly over
-- PostgREST — a door the app itself never uses.
--
-- Deliberately NOT here:
--   * policies for the ~20 "RLS Enabled No Policy" tables. RLS on with no
--     policy means anon and authenticated get nothing, which is exactly right
--     for a service-key architecture. Those advisories are informational.
--   * dropping "unused" indexes. On 133 products and 26 orders the planner
--     prefers sequential scans, so an index legitimately reads as unused.
--     Revisit once there is real traffic, not before.


-- ══ 1. RLS ON THE THREE TABLES THAT NEVER GOT IT ══════════════════════════
-- supabase-rls-fix.sql covered the tables that existed when it was written.
-- These three arrived in later migrations and were missed, so they are the
-- only tables in the database readable and WRITABLE with the public anon key.
--
--   schema_migrations — someone could mark a migration applied that never ran,
--                       and migrate.js would then skip it forever
--   stock_holds       — someone could hold every unit of every product and
--                       make the shop unable to sell (once own-stock mode is on)
--   order_events      — the append-only audit log; an audit trail anyone can
--                       write to is not an audit trail
--
-- No policies, matching every other table: the service key bypasses RLS, and
-- nothing else should be reading these at all.

alter table schema_migrations enable row level security;
alter table stock_holds       enable row level security;
alter table order_events      enable row level security;


-- ══ 2. PIN search_path ON EVERY FUNCTION ══════════════════════════════════
-- A function without a fixed search_path resolves unqualified names against
-- whatever the caller's search_path happens to be. Someone able to create an
-- object in an earlier schema can shadow a real table or function and have
-- their version run instead.
--
-- exec_sql is the one that genuinely matters: it is SECURITY DEFINER and
-- executes arbitrary SQL, so it runs as its owner. The rest are SECURITY
-- INVOKER and lower risk, but pinning them is free.
--
-- pg_temp is listed LAST on purpose. If it were first, a temporary table could
-- shadow a real one for the duration of a session.

-- Done as a loop over pg_proc rather than a hand-written list. Writing the
-- signatures out by hand means getting every argument type and DEFAULT exactly
-- right — I had search_top_queries(int) when it is actually (int, int) — and a
-- wrong signature is not an error, it is a function silently left unpinned.
-- The loop also covers any function added later without this file needing an
-- edit. It skips anything already pinned, so it is safe to re-run.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and (p.proconfig is null or not exists (
             select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    raise notice 'pinned search_path on %', r.sig;
  end loop;
end $$;


-- ══ 3. INDEX THE FOREIGN KEYS THAT LACK ONE ═══════════════════════════════
-- An unindexed foreign key costs twice. Looking a child up by its parent is a
-- sequential scan, and — the part that bites later — deleting a parent row
-- forces Postgres to scan the whole child table to enforce the constraint.
-- On today's data (26 orders, 9 users) neither is measurable. On a year of
-- orders, deleting a user would scan every one of them.

create index if not exists email_tokens_user_id_idx        on email_tokens(user_id);
create index if not exists email_tokens_rider_id_idx       on email_tokens(rider_id);
create index if not exists issue_reports_user_id_idx       on issue_reports(user_id);
create index if not exists issue_reports_order_id_idx      on issue_reports(order_id);
create index if not exists product_requests_user_id_idx    on product_requests(user_id);
create index if not exists recurring_orders_user_id_idx    on recurring_orders(user_id);
create index if not exists referrals_referrer_id_idx       on referrals(referrer_id);
create index if not exists referrals_referee_id_idx        on referrals(referee_id);
create index if not exists reviews_user_id_idx             on reviews(user_id);
create index if not exists reviews_order_id_idx            on reviews(order_id);
create index if not exists search_queries_user_id_idx      on search_queries(user_id);
create index if not exists stock_holds_product_id_idx      on stock_holds(product_id);
create index if not exists users_referred_by_idx           on users(referred_by);


-- ══ 4. VERIFY ═════════════════════════════════════════════════════════════
--   select relname, relrowsecurity from pg_class
--    where relname in ('schema_migrations','stock_holds','order_events');
--   -- expect relrowsecurity = true for all three
--
--   select p.proname, p.proconfig from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proconfig is null;
--   -- expect 0 rows: every function now pins its search_path
--
-- Then re-run Database → Advisors. The three CRITICAL rows and the
-- "Function Search Path Mutable" rows should be gone. "RLS Enabled No Policy"
-- will remain, and should — see the note at the top.


-- ══ DOWN ══════════════════════════════════════════════════════════════════
-- Wrapped in a block comment on purpose: pasting this whole file into the
-- Supabase SQL editor must not undo the migration it just applied. The editor
-- does not know the marker means "stop". scripts/migrate.js unwraps it.
/*
alter table schema_migrations disable row level security;
alter table stock_holds       disable row level security;
alter table order_events      disable row level security;

do $undo$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is not null
  loop execute format('alter function %s reset search_path', r.sig); end loop;
end $undo$;

drop index if exists email_tokens_user_id_idx;
drop index if exists email_tokens_rider_id_idx;
drop index if exists issue_reports_user_id_idx;
drop index if exists issue_reports_order_id_idx;
drop index if exists product_requests_user_id_idx;
drop index if exists recurring_orders_user_id_idx;
drop index if exists referrals_referrer_id_idx;
drop index if exists referrals_referee_id_idx;
drop index if exists reviews_user_id_idx;
drop index if exists reviews_order_id_idx;
drop index if exists search_queries_user_id_idx;
drop index if exists stock_holds_product_id_idx;
drop index if exists users_referred_by_idx;
*/
