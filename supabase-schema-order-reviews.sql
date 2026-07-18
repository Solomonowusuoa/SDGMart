-- Reviews are now per-ORDER (one "how did we do?" per delivered order)
-- instead of per-product. product_id becomes nullable; an order-level review
-- is a row with product_id NULL. Old per-product rows remain valid history.
-- Run in Supabase → SQL Editor. Safe to re-run.
alter table reviews alter column product_id drop not null;
create unique index if not exists reviews_one_per_order
  on reviews(user_id, order_id) where product_id is null;
