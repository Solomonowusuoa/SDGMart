-- SDGMart: updated_at on the business tables (audit finding B-08)
--
-- Orders move through five statuses, get reassigned, cancelled and edited, and
-- none of it stamped a modification time — only delivered_at and cancelled_at
-- existed. When a customer disputes a delivery or a rider disputes an
-- assignment, there was no record of when anything changed or in what order.
--
-- Run on STAGING first. This is additive and safe to re-run: every statement is
-- `if not exists` or `create or replace`.
--
-- Backfill note: existing rows get updated_at = created_at, which is honest —
-- it says "not modified since creation as far as we know", rather than
-- pretending every historical row was touched at migration time.


-- ══ 1. THE TRIGGER FUNCTION ═══════════════════════════════════════════════
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- ══ 2. COLUMNS, BACKFILL AND TRIGGERS ═════════════════════════════════════
-- orders is the one that matters for disputes; the rest are here so the rule
-- is uniform and a future table does not have to rediscover it.

alter table orders    add column if not exists updated_at timestamptz;
alter table users     add column if not exists updated_at timestamptz;
alter table riders    add column if not exists updated_at timestamptz;
alter table products  add column if not exists updated_at timestamptz;
alter table addresses add column if not exists updated_at timestamptz;

update orders    set updated_at = created_at where updated_at is null;
update users     set updated_at = created_at where updated_at is null;
update riders    set updated_at = created_at where updated_at is null;
update products  set updated_at = created_at where updated_at is null;
update addresses set updated_at = created_at where updated_at is null;

alter table orders    alter column updated_at set default now();
alter table users     alter column updated_at set default now();
alter table riders    alter column updated_at set default now();
alter table products  alter column updated_at set default now();
alter table addresses alter column updated_at set default now();

alter table orders    alter column updated_at set not null;
alter table users     alter column updated_at set not null;
alter table riders    alter column updated_at set not null;
alter table products  alter column updated_at set not null;
alter table addresses alter column updated_at set not null;

drop trigger if exists orders_set_updated_at    on orders;
drop trigger if exists users_set_updated_at     on users;
drop trigger if exists riders_set_updated_at    on riders;
drop trigger if exists products_set_updated_at  on products;
drop trigger if exists addresses_set_updated_at on addresses;

create trigger orders_set_updated_at    before update on orders    for each row execute function set_updated_at();
create trigger users_set_updated_at     before update on users     for each row execute function set_updated_at();
create trigger riders_set_updated_at    before update on riders    for each row execute function set_updated_at();
create trigger products_set_updated_at  before update on products  for each row execute function set_updated_at();
create trigger addresses_set_updated_at before update on addresses for each row execute function set_updated_at();


-- ══ 3. THE ORDER EVENT LOG ════════════════════════════════════════════════
-- updated_at answers "when did this last change". It does not answer "what
-- changed, in what order, and who did it" — which is the actual question in a
-- dispute. This is the append-only log the audit asked for. Nothing writes to
-- it yet beyond status changes; it is deliberately generic so it can absorb
-- reassignment and edit events later without another migration.

create table if not exists order_events (
  id          bigserial primary key,
  order_id    bigint not null references orders(id) on delete cascade,
  event       text   not null,              -- 'status', 'assigned', 'cancelled', ...
  from_value  text,
  to_value    text,
  actor_type  text,                         -- 'customer' | 'admin' | 'rider' | 'system'
  actor_id    bigint,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists order_events_order_id_idx on order_events(order_id, created_at);


-- ══ 4. VERIFY ═════════════════════════════════════════════════════════════
--   select table_name from information_schema.columns
--    where column_name = 'updated_at'
--      and table_name in ('orders','users','riders','products','addresses');   -- expect 5
--
--   select tgname from pg_trigger where tgname like '%_set_updated_at';        -- expect 5
--
--   select count(*) from order_events;                                          -- expect 0 on a fresh run


-- ══ DOWN ══
-- COMMENTED OUT DELIBERATELY. These files get pasted into the Supabase SQL
-- editor whole, and the editor has no idea this marker means "stop". An
-- executable rollback here would create everything above and then drop it
-- again, reporting success both times — which is exactly what happened once.
-- `node scripts/migrate.js down <file>` strips these comment markers and runs
-- what is inside. To roll back by hand, copy the statements out.
/*
drop trigger if exists orders_set_updated_at    on orders;
drop trigger if exists users_set_updated_at     on users;
drop trigger if exists riders_set_updated_at    on riders;
drop trigger if exists products_set_updated_at  on products;
drop trigger if exists addresses_set_updated_at on addresses;
drop function if exists set_updated_at();
drop table if exists order_events;
alter table orders    drop column if exists updated_at;
alter table users     drop column if exists updated_at;
alter table riders    drop column if exists updated_at;
alter table products  drop column if exists updated_at;
alter table addresses drop column if exists updated_at;
*/
