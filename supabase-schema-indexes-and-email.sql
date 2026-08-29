-- SDGMart: hot-path indexes + email normalisation
-- Audit findings D-01 and A-11. Run in Supabase → SQL Editor. Safe to re-run.
--
-- Run this on STAGING first, confirm the app still works, then on production.


-- ── D-01: orders has no index on created_at, yet it is the sort or filter key
--         for nearly every read path. Each of those forces a sequential scan
--         plus an in-memory sort of the whole table — invisible at pilot size,
--         degrading continuously as orders accumulate.
--
--         Plain CREATE INDEX, not CONCURRENTLY. The Supabase SQL editor wraps
--         every submission in a transaction, and CONCURRENTLY cannot run inside
--         one — it fails with "25001: CREATE INDEX CONCURRENTLY cannot run
--         inside a transaction block". A plain index takes a brief write lock,
--         which costs nothing on a table nobody is writing to yet.
--
--         AFTER LAUNCH, when a lock would block real orders, add new indexes
--         with CONCURRENTLY over a direct psql connection instead of the editor:
--           psql "$DATABASE_URL" -c "create index concurrently ..." 

create index if not exists orders_created_at_idx
  on orders (created_at desc);

-- The two hot filtered sorts: a customer's own order history, and a rider's
-- active queue.
create index if not exists orders_user_created_idx
  on orders (user_id, created_at desc);

create index if not exists orders_rider_status_idx
  on orders (rider_id, status);

-- issue_reports.listAll() sorts by created_at with no index either.
create index if not exists issue_reports_created_at_idx
  on issue_reports (created_at desc);


-- ── A-11: email lookups moved from ilike to an exact match, because ilike
--         turned caller-supplied % and _ into SQL wildcards and let the whole
--         user table be enumerated prefix by prefix.
--
--         Every insert already lowercases, so this should affect 0 rows — it
--         exists so any legacy mixed-case address cannot become unreachable.
--         Check first, then apply.

-- Dry run — how many rows would change?
--   select count(*) from users  where email <> lower(trim(email));
--   select count(*) from riders where email <> lower(trim(email));

update users  set email = lower(trim(email)) where email <> lower(trim(email));
update riders set email = lower(trim(email)) where email <> lower(trim(email));

-- Stop the problem recurring at the database level.
create unique index if not exists users_email_lower_uniq  on users  (lower(email));
create unique index if not exists riders_email_lower_uniq on riders (lower(email));


-- ── Verify ───────────────────────────────────────────────────────────────
-- Indexes present:
--   select indexname from pg_indexes
--   where tablename in ('orders','issue_reports','users','riders')
--   order by tablename, indexname;
--
-- No mixed-case addresses left (both should return 0):
--   select count(*) from users  where email <> lower(trim(email));
--   select count(*) from riders where email <> lower(trim(email));
