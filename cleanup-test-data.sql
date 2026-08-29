-- SDGMart: remove pilot test data from production (audit finding G-02)
--
-- ⚠️  THIS DELETES PRODUCTION ROWS. Read it through, run the INSPECT section
--     first, and only run the DELETE section once the numbers look right.
--     Nothing here runs itself — every statement is deliberate.
--
-- Why it matters beyond tidiness: this data is indistinguishable from real data
-- to every aggregate you have. It inflates the homepage delivered-count ticker,
-- skews retention cohorts and AOV on the dashboard, feeds the top-sellers scan
-- behind the "Popular right now" rail every visitor sees, and counts toward your
-- customer total. Launch decisions would be made against numbers that include
-- your own testing.
--
-- Targets, from HANDOFF "Still pending at launch" item 5:
--   users  sdgtest-…@example.com  (ids 6 and 9, plus their addresses/reviews)
--   orders roughly ids 20–23
--
-- Take a backup first: Supabase → Database → Backups. On the free plan that is
-- the daily snapshot; confirm today's exists before you delete anything.


-- ══ SECTION 1 — INSPECT (safe, read-only). Run this first. ════════════════

-- 1a. Which accounts match the test pattern?
select id, name, email, created_at, total_spent, loyalty_balance
from users
where email ilike 'sdgtest%' or email ilike '%@example.com'
order by id;

-- 1b. What orders belong to them, and what else is in the id range?
select o.id, o.user_id, u.email, o.customer_name, o.status, o.total, o.created_at
from orders o left join users u on u.id = o.user_id
where u.email ilike 'sdgtest%'
   or u.email ilike '%@example.com'
   or o.id between 20 and 23
order by o.id;

-- 1c. ⚠️ Anything in 1b whose email is NULL or does not look like a test account
--     is a REAL order that happens to fall in the id range. Note those ids and
--     exclude them below — do not delete a real customer's order.

-- 1d. What else is attached to those users?
select 'addresses' as t, count(*) from addresses  where user_id in (select id from users where email ilike 'sdgtest%' or email ilike '%@example.com')
union all select 'reviews',        count(*) from reviews          where user_id in (select id from users where email ilike 'sdgtest%' or email ilike '%@example.com')
union all select 'recurring',      count(*) from recurring_orders where user_id in (select id from users where email ilike 'sdgtest%' or email ilike '%@example.com')
union all select 'push_subs',      count(*) from push_subscriptions where user_id in (select id from users where email ilike 'sdgtest%' or email ilike '%@example.com')
union all select 'carts',          count(*) from carts            where user_id in (select id from users where email ilike 'sdgtest%' or email ilike '%@example.com');


-- ══ SECTION 2 — DELETE. Only after Section 1 looks right. ═════════════════
-- Edit the id list on the next line to match what you actually confirmed.

begin;

create temp table _test_users as
select id from users
where email ilike 'sdgtest%' or email ilike '%@example.com';

-- Orders first. Adjust the explicit id list to the ones you verified in 1c —
-- remove any that turned out to be real.
delete from issue_reports where order_id in (
  select id from orders where user_id in (select id from _test_users) or id in (20,21,22,23)
);
delete from reviews where order_id in (
  select id from orders where user_id in (select id from _test_users) or id in (20,21,22,23)
);
delete from orders
where user_id in (select id from _test_users) or id in (20,21,22,23);

-- Then the accounts. addresses, reviews, recurring_orders and push_subscriptions
-- are ON DELETE CASCADE, so they go automatically. carts has no foreign key, so
-- it is cleared explicitly.
delete from carts     where user_id in (select id from _test_users);
delete from referrals where referrer_id in (select id from _test_users)
                          or referee_id in (select id from _test_users);
update users set referred_by = null
  where referred_by in (select id from _test_users);
delete from users where id in (select id from _test_users);

-- Check the counts printed by this before committing.
select 'users left matching test pattern' as check, count(*) from users
where email ilike 'sdgtest%' or email ilike '%@example.com';

-- If it all looks right:
commit;
-- If anything looks wrong:
-- rollback;


-- ══ SECTION 3 — AFTER ═════════════════════════════════════════════════════
-- The server caches the bestseller scan for 5 minutes and the catalogue for 60
-- seconds, so the homepage figures settle on their own. To see it immediately,
-- redeploy on Render.
--
-- Then confirm the dashboard numbers moved:
--   select count(*) as orders, sum(total) as revenue from orders where status <> 'cancelled';
