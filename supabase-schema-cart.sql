-- SDGMart: server-persisted cart so a signed-in customer's cart follows them
-- across devices. Run in the Supabase SQL Editor. Safe to re-run.
create table if not exists carts (
  user_id    bigint primary key,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table carts enable row level security;
-- Access is server-only (the service_role key bypasses RLS); no public policies.
