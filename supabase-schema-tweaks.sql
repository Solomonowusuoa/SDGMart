-- SDGMart schema tweaks — profile birthday, birthday gifts, scheduled delivery
-- Paste this whole file into Supabase → SQL Editor → New Query → Run.
-- Safe to re-run: every change is idempotent.

-- ── Users: birthday (captured once) + gift / notification guards ──────────
alter table users  add column if not exists birth_day                  smallint;  -- 1..31
alter table users  add column if not exists birth_month                smallint;  -- 1..12
alter table users  add column if not exists birthday_gift_claimed_year smallint;  -- last calendar year a birthday gift was claimed
alter table users  add column if not exists birthday_notified_year     smallint;  -- last calendar year the birthday push was sent

-- Fast lookup for the daily "whose birthday is today" sweep
create index if not exists users_birthday_idx on users(birth_month, birth_day)
  where birth_month is not null;

-- ── Orders: scheduled-delivery time slot (delivery_date already exists) ────
alter table orders add column if not exists delivery_slot text;  -- e.g. "14:00-16:00"; null = ASAP

-- ── Admin-config defaults (inserted only if missing) ──────────────────────
insert into app_config (key, value) values
  ('birthday_gifts', '{"enabled":false,"productIds":[]}'::jsonb),
  ('delivery_slots', '["12:00-14:00","14:00-16:00","16:00-18:00"]'::jsonb)
  on conflict (key) do nothing;
