-- SDGMart: operational dashboard + leaderboard + error monitoring
-- Run in Supabase SQL Editor. Safe to re-run.

-- Referral leaderboard: count successful referrals per user
alter table users add column if not exists referral_count integer not null default 0;

-- Error logs (in-house monitoring)
create table if not exists error_logs (
  id          bigserial primary key,
  message     text not null,
  stack       text,
  path        text,
  method      text,
  status      integer,
  user_id     bigint,
  created_at  timestamptz not null default now()
);
create index if not exists error_logs_created_at_idx on error_logs(created_at desc);

alter table error_logs enable row level security;
