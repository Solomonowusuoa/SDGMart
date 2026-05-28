-- SDGMart: enable Row-Level Security on every table.
-- Paste in Supabase → SQL Editor → New Query → Run.
-- Safe to re-run.
--
-- Why this is safe for our app: every database call comes from our Node
-- server using the SERVICE_ROLE key, which bypasses RLS by design.
-- After this script runs:
--   - The service_role key (server-only)     → full access (unchanged)
--   - The anon (public) key                  → no access at all (locked down)
--   - The authenticated key                  → no access at all
-- We never use anon/authenticated keys, so nothing in the app breaks.

alter table products            enable row level security;
alter table users               enable row level security;
alter table riders              enable row level security;
alter table orders              enable row level security;
alter table sessions            enable row level security;
alter table email_tokens        enable row level security;
alter table push_subscriptions  enable row level security;
alter table search_queries      enable row level security;
alter table recurring_orders    enable row level security;
alter table app_config          enable row level security;
alter table addresses           enable row level security;
alter table reviews             enable row level security;
alter table issue_reports       enable row level security;
alter table promotions          enable row level security;

-- Verify: every table should now report rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
