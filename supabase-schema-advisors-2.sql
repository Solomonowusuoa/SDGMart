-- SDGMart — drop three redundant indexes created by supabase-schema-advisors.sql
--
-- A forward fix, not an edit to that file. Migrations are immutable once run:
-- editing one after the fact makes `migrate.js status` report CHANGED, which is
-- a warning that should mean "someone tampered with applied history", not
-- "someone tidied up".
--
-- What went wrong. supabase-schema-advisors.sql added an index for every
-- foreign key column on the tables Supabase had flagged. That was too blunt.
-- Supabase flags a TABLE, not a column, so a table flagged for one unindexed FK
-- got indexes for all of its FKs — including columns already served by an
-- existing index. A btree on (a, b) already answers lookups on `a`, so a
-- separate index on `a` is dead weight: it is maintained on every insert,
-- update and delete, and never chosen.
--
-- Ten of the thirteen were genuinely missing and stay. These three were not:
--
--   referrals_referrer_id_idx    an EXACT duplicate of referrals_referrer_idx,
--                                which already existed, and also covered by
--                                referrals_pair_uniq (referrer_id, referee_id)
--   reviews_user_id_idx          covered by reviews_one_per_product_per_order
--                                (user_id, product_id, order_id)
--   stock_holds_product_id_idx   covered by stock_holds_product_active_idx
--                                (product_id, expires_at)
--
-- Each covering index was checked to be NON-PARTIAL. That matters: a partial
-- index (one with a WHERE clause) cannot stand in for a full one, so
-- addresses_user_id_idx and orders_paystack_ref_idx look redundant by column
-- list but are not, and are deliberately left alone.

drop index if exists referrals_referrer_id_idx;
drop index if exists reviews_user_id_idx;
drop index if exists stock_holds_product_id_idx;


-- ══ VERIFY ════════════════════════════════════════════════════════════════
-- No two indexes on the same table should share a column list:
--
--   select a.tbl, a.name, b.name, a.cols from (
--     select ci.relname name, ct.relname tbl,
--            array_to_string(array(select pg_get_indexdef(x.indexrelid,k+1,true)
--                                  from generate_series(0,x.indnatts-1) k), ', ') cols
--       from pg_index x join pg_class ci on ci.oid=x.indexrelid
--       join pg_class ct on ct.oid=x.indrelid
--       join pg_namespace n on n.oid=ct.relnamespace where n.nspname='public') a
--   join (... same ...) b on a.tbl=b.tbl and a.cols=b.cols and a.name < b.name;
--   -- expect 0 rows


-- ══ DOWN ══════════════════════════════════════════════════════════════════
-- Recreates them. Only useful if the coverage analysis above turns out to be
-- wrong — none of these three should be needed.
/*
create index if not exists referrals_referrer_id_idx  on referrals(referrer_id);
create index if not exists reviews_user_id_idx        on reviews(user_id);
create index if not exists stock_holds_product_id_idx on stock_holds(product_id);
*/
