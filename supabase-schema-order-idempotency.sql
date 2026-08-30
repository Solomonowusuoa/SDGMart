-- SDGMart: duplicate-order protection (audit finding B-02)
-- Run in Supabase → SQL Editor. Safe to re-run.
--
-- Each checkout attempt sends a client-generated key. The server stores it on
-- the order, so a retry after a dropped response returns the ORIGINAL order
-- instead of creating a second one — the common case on an intermittent mobile
-- connection, where the order was saved but the reply never arrived.
--
-- The server detects whether this column exists and disables the protection
-- (with a startup warning) if it does not, so deploying the code before running
-- this file degrades safely rather than failing every insert.

alter table orders add column if not exists client_request_id text;

-- Partial + unique: NULLs are unconstrained (older orders, server-side creations
-- such as recurring orders), but any two orders sharing a key are rejected.
create unique index if not exists orders_client_request_id_uniq
  on orders(client_request_id) where client_request_id is not null;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'orders' and column_name = 'client_request_id';


-- ══ DOWN ══
-- Reverses this migration. Duplicate-order protection goes OFF; the server
-- warns at startup and keeps running. The column is dropped, so any recorded
-- request ids are lost — that is fine, they are only meaningful for the few
-- minutes a retry window is open.
drop index if exists orders_client_request_id_uniq;
alter table orders drop column if exists client_request_id;
