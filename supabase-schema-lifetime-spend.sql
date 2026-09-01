-- SDGMart: separate lifetime spend from squad-round progress.
--
-- `users.total_spent` was doing two incompatible jobs at once:
--
--   1. LIFETIME SPEND, which drives the tier reward — GHS 50 for every GHS
--      1,000 a customer has ever spent. This must only ever grow.
--   2. PROGRESS IN THE CURRENT SQUAD ROUND, which drives the GHS 25 squad
--      bonus. This is RESET to the rollover every time a squad hits its goal.
--
-- Job 2 destroys job 1. Once a customer starts triggering squad payouts, their
-- total_spent is knocked back below 500 each round and can never climb to
-- 1,000 — so the tier reward silently stops firing for them, forever.
--
-- Measured on the live logic before this change: two customers spending an
-- identical GHS 1,210 received DIFFERENT credit — GHS 100 for one big order,
-- GHS 50 for the same money in twelve normal baskets. The tier reward had
-- become a lottery decided by how a customer split their shopping.
--
-- This column is the lifetime counter. It NEVER resets. The squad round keeps
-- using total_spent and keeps resetting it, which is correct for that job.
--
-- Run on STAGING first. Additive and re-runnable.


-- ══ 1. COLUMN ═════════════════════════════════════════════════════════════
alter table users add column if not exists lifetime_spent numeric not null default 0;


-- ══ 2. BACKFILL ═══════════════════════════════════════════════════════════
-- From real order history, not from total_spent: total_spent has already been
-- reset by past squad rollovers on some accounts, so it understates what those
-- customers actually spent. Delivered orders only — rewards accrue on delivery
-- (audit C-01), so an order that never arrived was never earned.
--
-- `subtotal`, not `total`: recordSpend is called with order.subtotal, so the
-- backfill has to use the same basis or existing customers get credit for
-- delivery fees they never earned it on.
--
-- Guarded on lifetime_spent = 0 so re-running cannot claw back spend that has
-- accrued normally since the first run.
update users u
   set lifetime_spent = coalesce((
         select sum(o.subtotal)
           from orders o
          where o.user_id = u.id
            and o.status = 'delivered'
       ), 0)
 where u.lifetime_spent = 0;


-- ══ 3. VERIFY ═════════════════════════════════════════════════════════════
--   select column_name from information_schema.columns
--    where table_name = 'users' and column_name = 'lifetime_spent';   -- expect 1 row
--
-- Compare the backfill against order history — every row should read 0:
--   select u.id, u.lifetime_spent,
--          coalesce((select sum(o.subtotal) from orders o
--                     where o.user_id = u.id and o.status = 'delivered'), 0) as from_orders,
--          u.lifetime_spent - coalesce((select sum(o.subtotal) from orders o
--                     where o.user_id = u.id and o.status = 'delivered'), 0) as drift
--     from users u where u.role = 'customer' order by u.id;
--
-- Nobody should be worse off than their old counter where that counter was
-- never reset:
--   select id, total_spent, lifetime_spent from users
--    where role = 'customer' and lifetime_spent < total_spent;


-- ══ DOWN ══
-- COMMENTED OUT DELIBERATELY. These files get pasted into the Supabase SQL
-- editor whole, and the editor has no idea this marker means "stop". An
-- executable rollback here would create everything above and then drop it
-- again, reporting success both times — which is exactly what happened once.
-- `node scripts/migrate.js down <file>` strips these comment markers and runs
-- what is inside. To roll back by hand, copy the statements out.
/*
alter table users drop column if exists lifetime_spent;
*/
