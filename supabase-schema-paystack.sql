-- SDGMart: Paystack online payments
-- Run in Supabase SQL Editor. Safe to re-run.

-- Mark whether an order has been paid online + the Paystack reference
alter table orders add column if not exists paid boolean not null default false;
alter table orders add column if not exists paystack_ref text;
create index if not exists orders_paystack_ref_idx on orders(paystack_ref);

-- Pending payments: the order draft is stashed here when a Paystack
-- transaction is initialized, so the order can be created after payment is
-- confirmed even if the customer's tab closed or the server restarted.
create table if not exists pending_payments (
  reference   text primary key,
  user_id     bigint,
  draft       jsonb not null,
  amount      numeric,
  created_at  timestamptz not null default now()
);
create index if not exists pending_payments_created_at_idx on pending_payments(created_at);

alter table pending_payments enable row level security;
