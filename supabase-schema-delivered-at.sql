-- Records WHEN an order was delivered. Used by:
--   - the tracking page's "Completed at <time>" line (never worked before —
--     the column didn't exist)
--   - guest tracking-code expiry (codes stop working 7 days after delivery)
-- Run in Supabase → SQL Editor. Safe to re-run.
alter table orders add column if not exists delivered_at timestamptz;
