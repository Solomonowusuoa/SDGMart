-- SDGMart: the constraints that make bad data impossible (audit finding B-06)
--
-- Run on STAGING first. Adding a constraint to a table that already violates it
-- FAILS — that is the point. Each section has a check query above it; run those
-- first, clean anything they return, then apply.
--
-- Every fix in this session enforces these rules in JavaScript. These make the
-- database enforce them too, so a future code path cannot quietly reintroduce
-- the problem.
--
-- ⚠️  RUN supabase-schema-cart.sql FIRST. Section 5 adds a foreign key to
--     `carts`, and that table does not exist yet — HANDOFF records its migration
--     as applied, but the startup schema check proved otherwise (which is why
--     the persistent cross-device cart has never worked). Without it, section 5
--     fails on the carts statement.
--
-- Indexes here are plain CREATE INDEX, not CONCURRENTLY: the Supabase SQL editor
-- wraps every submission in a transaction, and CONCURRENTLY cannot run inside
-- one. A brief write lock is free on a table with no traffic. After launch, add
-- indexes with CONCURRENTLY over a direct psql connection rather than the editor.
--
-- Each section is independent, so if one fails you can run the rest.


-- ══ 1. MONEY CANNOT GO NEGATIVE ═══════════════════════════════════════════
-- The loyalty double-spend (A-02) could drive a balance below zero. The CAS fix
-- prevents it; this makes it structurally impossible.
--
--   select count(*) from users where loyalty_balance < 0 or total_spent < 0;
--   select count(*) from products where price < 0 or stock < 0;

alter table users  drop constraint if exists users_loyalty_balance_non_negative;
alter table users  add  constraint users_loyalty_balance_non_negative check (loyalty_balance >= 0);

alter table users  drop constraint if exists users_total_spent_non_negative;
alter table users  add  constraint users_total_spent_non_negative check (total_spent >= 0);

-- A negative price would let one line offset another and drag a cart total down.
alter table products drop constraint if exists products_price_non_negative;
alter table products add  constraint products_price_non_negative check (price >= 0);

alter table products drop constraint if exists products_stock_non_negative;
alter table products add  constraint products_stock_non_negative check (stock >= 0);

-- Order money is never negative either.
alter table orders drop constraint if exists orders_amounts_non_negative;
alter table orders add  constraint orders_amounts_non_negative
  check (subtotal >= 0 and delivery_fee >= 0 and discount >= 0 and loyalty_used >= 0 and total >= 0);


-- ══ 2. ONE ORDER PER PAYMENT ══════════════════════════════════════════════
-- orders.paystack_ref was indexed but NOT unique, which is what allowed verify
-- and the webhook to both create an order for a single payment (A-09).
--
--   select paystack_ref, count(*) from orders
--   where paystack_ref is not null group by paystack_ref having count(*) > 1;
--
-- If that returns rows, resolve the duplicates BEFORE running this.

create unique index if not exists orders_paystack_ref_uniq
  on orders (paystack_ref) where paystack_ref is not null;


-- ══ 3. ONE REFERRAL CREDIT PER PAIR ═══════════════════════════════════════
-- No unique constraint meant the concurrency race could write duplicate rows and
-- inflate the monthly leaderboard.
--
--   select referrer_id, referee_id, count(*) from referrals
--   group by referrer_id, referee_id having count(*) > 1;

create unique index if not exists referrals_pair_uniq
  on referrals (referrer_id, referee_id);


-- ══ 4. ONE DEFAULT ADDRESS PER CUSTOMER ═══════════════════════════════════
-- "Only one default" was clear-all-then-set across two statements with nothing
-- behind it, so concurrent saves left two defaults and checkout auto-filled
-- whichever sorted first (B-13).
--
--   select user_id, count(*) from addresses where is_default
--   group by user_id having count(*) > 1;

create unique index if not exists addresses_one_default_per_user
  on addresses (user_id) where is_default;


-- ══ 5. REFERENTIAL INTEGRITY ══════════════════════════════════════════════
-- These columns held user ids with no foreign key, so a deleted account left
-- rows pointing at nothing.
--
--   select count(*) from users u where u.referred_by is not null
--     and not exists (select 1 from users r where r.id = u.referred_by);
--   select count(*) from carts c
--     where not exists (select 1 from users u where u.id = c.user_id);

alter table users drop constraint if exists users_referred_by_fkey;
alter table users add  constraint users_referred_by_fkey
  foreign key (referred_by) references users(id) on delete set null;

alter table carts drop constraint if exists carts_user_id_fkey;
alter table carts add  constraint carts_user_id_fkey
  foreign key (user_id) references users(id) on delete cascade;

alter table referrals drop constraint if exists referrals_referrer_fkey;
alter table referrals add  constraint referrals_referrer_fkey
  foreign key (referrer_id) references users(id) on delete cascade;

alter table referrals drop constraint if exists referrals_referee_fkey;
alter table referrals add  constraint referrals_referee_fkey
  foreign key (referee_id) references users(id) on delete cascade;

-- NOTE: sessions.user_id deliberately has NO foreign key. It points at either
-- users or riders depending on user_type, which is the schema-level root of the
-- A-01 / A-04 id collisions. Fixing that properly means a shared identity table
-- and is a migration in its own right, not a constraint.


-- ══ 6. ENUMERATED VALUES ══════════════════════════════════════════════════
-- payment_method was free text written straight from the client, so it rendered
-- as arbitrary text beside the PAID badge in the admin list.
--
--   select distinct payment_method from orders;
--
-- Add any legitimate value this returns to the list before applying.

alter table orders drop constraint if exists orders_payment_method_known;
alter table orders add  constraint orders_payment_method_known
  check (payment_method is null or payment_method in ('cash', 'paystack', 'momo', 'card'));


-- ══ 7. VERIFY ═════════════════════════════════════════════════════════════
-- select conname, conrelid::regclass as table_name
-- from pg_constraint
-- where conname like '%non_negative%' or conname like '%_fkey' or conname like '%_known'
-- order by table_name, conname;
