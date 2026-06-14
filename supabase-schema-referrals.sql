-- SDGMart: referral-on-first-purchase + monthly leaderboard
-- Run in Supabase SQL Editor. Safe to re-run.

-- Who referred this user (set at signup; credited only after their first order)
alter table users add column if not exists referred_by bigint;
-- Has the referrer already been credited for this user's first purchase?
alter table users add column if not exists referral_credited boolean not null default false;

-- Referral log — one row per credited referral, tagged with the month so the
-- leaderboard naturally resets each month.
create table if not exists referrals (
  id          bigserial primary key,
  referrer_id bigint not null,
  referee_id  bigint not null,
  month       text not null,            -- 'YYYY-MM'
  created_at  timestamptz not null default now()
);
create index if not exists referrals_month_idx on referrals(month);
create index if not exists referrals_referrer_idx on referrals(referrer_id);

alter table referrals enable row level security;
