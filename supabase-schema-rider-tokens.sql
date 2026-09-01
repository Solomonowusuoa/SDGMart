-- SDGMart: let email_tokens belong to a RIDER as well as a customer.
--
-- Riders had no password recovery at all: forgot-password only looked in
-- `users`, so their request silently matched nothing. Fixing the lookup was not
-- enough, because the table itself refused rider tokens two ways over:
--
--   1. `purpose` carries a CHECK limited to ('verify','reset'). The rider
--      family needs its own purpose, because riders and customers SHARE an id
--      space (audit A-01) and a bare user_id cannot say which table it means.
--      A token minted for rider #N under the plain 'reset' purpose would reset
--      CUSTOMER #N's password.
--   2. `user_id` is `references users(id)`, so a rider id fails the foreign
--      key outright.
--
-- Both failures were INVISIBLE, because makeEmailToken never checked the insert
-- error — the customer got "check your email" and no token existed. That is
-- fixed in database.js alongside this.
--
-- Rather than dropping the foreign key (which would lose the cascade that
-- cleans tokens up when an account is deleted), rider tokens get their own
-- column with its own cascade. Exactly one owner column is set, enforced.
--
-- Run on STAGING first. Additive and re-runnable.


-- ══ 1. A rider may own a token ════════════════════════════════════════════
alter table email_tokens alter column user_id drop not null;
alter table email_tokens add column if not exists rider_id bigint
  references riders(id) on delete cascade;


-- ══ 2. Allow the rider purpose ════════════════════════════════════════════
alter table email_tokens drop constraint if exists email_tokens_purpose_check;
alter table email_tokens add constraint email_tokens_purpose_check
  check (purpose in ('verify', 'reset', 'reset-rider'));


-- ══ 3. Exactly one owner, never both and never neither ════════════════════
-- Without this a token could be written with no owner at all, or with a user_id
-- AND a rider_id, and consuming it would have to guess. Existing rows all carry
-- a user_id and a null rider_id, so they satisfy this as they stand.
alter table email_tokens drop constraint if exists email_tokens_one_owner;
alter table email_tokens add constraint email_tokens_one_owner
  check ((user_id is not null) <> (rider_id is not null));

create index if not exists email_tokens_rider_id_idx on email_tokens (rider_id)
  where rider_id is not null;


-- ══ 4. VERIFY ═════════════════════════════════════════════════════════════
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'email_tokens' and column_name in ('user_id','rider_id');
--   -- expect user_id YES, rider_id YES
--
--   select conname from pg_constraint where conrelid = 'email_tokens'::regclass;
--   -- expect email_tokens_purpose_check and email_tokens_one_owner
--
-- A rider token should now insert, and a two-owner row should still be refused:
--   insert into email_tokens (token, rider_id, purpose, expires_at)
--   values ('probe', (select id from riders limit 1), 'reset-rider', now() + interval '1 hour');
--   delete from email_tokens where token = 'probe';


-- ══ DOWN ══
-- COMMENTED OUT DELIBERATELY. These files get pasted into the Supabase SQL
-- editor whole, and the editor has no idea this marker means "stop". An
-- executable rollback here would create everything above and then drop it
-- again, reporting success both times — which is exactly what happened once.
-- `node scripts/migrate.js down <file>` strips these comment markers and runs
-- what is inside. To roll back by hand, copy the statements out.
/*
delete from email_tokens where rider_id is not null;
drop index if exists email_tokens_rider_id_idx;
alter table email_tokens drop constraint if exists email_tokens_one_owner;
alter table email_tokens drop constraint if exists email_tokens_purpose_check;
alter table email_tokens add constraint email_tokens_purpose_check
  check (purpose in ('verify', 'reset'));
alter table email_tokens drop column if exists rider_id;
alter table email_tokens alter column user_id set not null;
*/
