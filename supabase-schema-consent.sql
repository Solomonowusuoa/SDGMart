-- SDGMart: record what each customer agreed to, and when (audit finding H-03)
--
-- The signup form made no reference to the privacy notice or terms — no
-- checkbox, no link, no wording — so there was no record that any customer had
-- been shown, let alone agreed to, the policy the site publishes. Act 843 is
-- built around consent and prior notice for personal-data collection.
--
-- Existing accounts are left NULL rather than back-dated to a version they were
-- never shown. A null here is the honest answer: we do not know, because we
-- did not ask. It is not the same as a recorded refusal.
--
-- Run on STAGING first. Additive and re-runnable.


-- ══ 1. COLUMNS ════════════════════════════════════════════════════════════
alter table users add column if not exists terms_version     text;
alter table users add column if not exists terms_accepted_at timestamptz;

-- Finding which customers predate consent capture, e.g. to ask them once:
--   select count(*) from users where role = 'customer' and terms_accepted_at is null;
create index if not exists users_terms_accepted_at_idx
  on users (terms_accepted_at) where terms_accepted_at is null;


-- ══ 2. VERIFY ═════════════════════════════════════════════════════════════
--   select column_name from information_schema.columns
--    where table_name = 'users' and column_name in ('terms_version','terms_accepted_at');
--   -- expect 2 rows
--
-- After a new signup:
--   select email, terms_version, terms_accepted_at from users
--    order by created_at desc limit 1;


-- ══ DOWN ══
-- COMMENTED OUT DELIBERATELY. These files get pasted into the Supabase SQL
-- editor whole, and the editor has no idea this marker means "stop". An
-- executable rollback here would create everything above and then drop it
-- again, reporting success both times — which is exactly what happened once.
-- `node scripts/migrate.js down <file>` strips these comment markers and runs
-- what is inside. To roll back by hand, copy the statements out.
/*
drop index if exists users_terms_accepted_at_idx;
alter table users drop column if exists terms_version;
alter table users drop column if exists terms_accepted_at;
*/
