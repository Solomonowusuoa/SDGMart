-- SDGMart: constraints for the medium-severity batch (audit B-10, B-13)
--
-- Run on STAGING first. Adding a constraint to a table that already violates it
-- FAILS — that is the point. Each section has an INSPECT query above it; run
-- that first, clean anything it returns, then apply the section.
--
-- Companion to supabase-schema-constraints.sql, which already covers the
-- product price/stock floors (B-14) and the one-default-address index (B-13's
-- first half). This adds only what that file did not.
--
-- Indexes here are plain CREATE INDEX, not CONCURRENTLY: the Supabase SQL
-- editor wraps every submission in a transaction and CONCURRENTLY cannot run
-- inside one.
--
-- Each section is independent, so if one fails you can run the rest.


-- ══ 1. ONE ORDER-LEVEL REVIEW PER ORDER (B-13) ════════════════════════════
-- reviews_one_per_product_per_order is on (user_id, product_id, order_id) and
-- looks like it covers this. It does not: order-level reviews store
-- product_id NULL, and Postgres treats NULLs as distinct in a unique index, so
-- the same customer could rate one order unlimited times. A partial index over
-- just the NULL-product rows is what actually constrains it.
--
-- INSPECT — rows that would block the index (duplicates already stored):
--   select user_id, order_id, count(*)
--     from reviews where product_id is null
--    group by user_id, order_id having count(*) > 1;
--
-- If that returns rows, keep the earliest of each and delete the rest:
--   delete from reviews r using reviews keep
--    where r.product_id is null and keep.product_id is null
--      and r.user_id = keep.user_id and r.order_id = keep.order_id
--      and r.id > keep.id;

create unique index if not exists reviews_one_per_order
  on reviews(user_id, order_id)
  where product_id is null;


-- ══ 2. RECURRING ORDERS CANNOT BE WEAPONISED (B-10) ═══════════════════════
-- next_run_at went in unvalidated, so a past date made a row due on the very
-- next sweep; with no cap per user, a few hundred back-dated rows became a few
-- hundred real cash orders in one runDailyJobs pass. The route now bounds all
-- of this; these make it true of the table regardless of which code path writes.
--
-- INSPECT:
--   select count(*) from recurring_orders where cadence_days < 1 or cadence_days > 90;
--   select user_id, count(*) from recurring_orders where active
--    group by user_id having count(*) > 10;

alter table recurring_orders drop constraint if exists recurring_cadence_sane;
alter table recurring_orders add  constraint recurring_cadence_sane
  check (cadence_days >= 1 and cadence_days <= 90);

-- A schedule may not be created in the past. Existing rows are left alone —
-- this only binds new writes, because back-dating an existing row is exactly
-- the abuse being closed and there is no legitimate reason to do it.
alter table recurring_orders drop constraint if exists recurring_next_run_sane;
alter table recurring_orders add  constraint recurring_next_run_sane
  check (next_run_at >= date '2020-01-01');


-- ══ 3. VERIFY ═════════════════════════════════════════════════════════════
-- Expect one row for the index and two for the constraints.
--
--   select indexname from pg_indexes
--    where tablename = 'reviews' and indexname = 'reviews_one_per_order';
--
--   select conname from pg_constraint
--    where conrelid = 'recurring_orders'::regclass
--      and conname in ('recurring_cadence_sane', 'recurring_next_run_sane');


-- ══ DOWN ══
drop index if exists reviews_one_per_order;
alter table recurring_orders drop constraint if exists recurring_cadence_sane;
alter table recurring_orders drop constraint if exists recurring_next_run_sane;
