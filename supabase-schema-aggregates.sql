-- SDGMart: push aggregation into Postgres (audit finding D-08)
--
-- topQueries and unmatchedQueries selected every search row in a 30-day window
-- and built the frequency map in Node. Search logging is unauthenticated, so
-- search_queries is the table most likely to reach millions of rows first —
-- and its aggregate was computed by downloading it.
--
-- These return a handful of rows instead of the whole window. The application
-- falls back to the old in-Node path if these functions are absent, so it is
-- safe to deploy the code before running this.
--
-- Run on STAGING first. Additive and re-runnable.


-- ══ 1. INDEX THE WINDOW ═══════════════════════════════════════════════════
-- Both functions filter on created_at and one also on result_count.
create index if not exists search_queries_created_at_idx
  on search_queries (created_at desc);
create index if not exists search_queries_unmatched_idx
  on search_queries (created_at desc) where result_count = 0;


-- ══ 2. THE AGGREGATES ═════════════════════════════════════════════════════
-- lower(query) matches what the Node version did, so results are unchanged.

create or replace function search_top_queries(days int default 30, lim int default 20)
returns table (query text, count bigint)
language sql stable as $$
  select lower(s.query) as query, count(*) as count
    from search_queries s
   where s.created_at >= now() - (days || ' days')::interval
     and s.query is not null
     and btrim(s.query) <> ''
   group by lower(s.query)
   order by count desc, query asc
   limit lim;
$$;

create or replace function search_unmatched_queries(days int default 30, lim int default 20)
returns table (query text, count bigint)
language sql stable as $$
  select lower(s.query) as query, count(*) as count
    from search_queries s
   where s.created_at >= now() - (days || ' days')::interval
     and s.result_count = 0
     and s.query is not null
     and btrim(s.query) <> ''
   group by lower(s.query)
   order by count desc, query asc
   limit lim;
$$;


-- ══ 3. VERIFY ═════════════════════════════════════════════════════════════
--   select * from search_top_queries(30, 5);
--   select * from search_unmatched_queries(30, 5);
--
-- And confirm the index is used rather than a sequential scan:
--   explain analyze select * from search_top_queries(30, 20);


-- ══ DOWN ══
drop function if exists search_top_queries(int, int);
drop function if exists search_unmatched_queries(int, int);
drop index if exists search_queries_created_at_idx;
drop index if exists search_queries_unmatched_idx;
