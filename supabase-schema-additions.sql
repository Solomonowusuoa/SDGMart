-- SDGMart schema additions (run AFTER supabase-schema.sql, in Supabase SQL Editor)
-- Safe to re-run: all use IF NOT EXISTS or guarded checks.

-- ── Products: photo URL + surprise extra ─────────────────────────────────
alter table products add column if not exists img text;

-- ── Users: profile + first-order tracking ────────────────────────────────
alter table users add column if not exists first_order_done boolean not null default false;
alter table users add column if not exists notify_subscribed boolean not null default false;

-- ── Saved addresses (per user) ───────────────────────────────────────────
create table if not exists addresses (
  id           bigserial primary key,
  user_id      bigint not null references users(id) on delete cascade,
  label        text not null,                    -- e.g. 'Home', 'Work', 'Mom's place'
  neighborhood text,
  address      text,
  location     jsonb,                            -- { lat, lng, address }
  is_default   boolean not null default false,
  is_last_used boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists addresses_user_id_idx on addresses(user_id);

-- ── Reviews ──────────────────────────────────────────────────────────────
create table if not exists reviews (
  id          bigserial primary key,
  product_id  bigint not null references products(id) on delete cascade,
  user_id     bigint not null references users(id) on delete cascade,
  order_id    bigint references orders(id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  message     text,
  approved    boolean not null default true,    -- admin can hide if abusive
  created_at  timestamptz not null default now()
);
create index if not exists reviews_product_id_idx on reviews(product_id);
create index if not exists reviews_user_id_idx on reviews(user_id);
create unique index if not exists reviews_one_per_product_per_order
  on reviews(user_id, product_id, order_id);  -- one review per product per order

-- ── Issue reports (delivered-order complaints) ───────────────────────────
create table if not exists issue_reports (
  id          bigserial primary key,
  order_id    bigint not null references orders(id) on delete cascade,
  user_id     bigint references users(id) on delete set null,
  issue_type  text not null,                    -- 'missing','damaged','wrong','other'
  description text not null,
  resolved    boolean not null default false,
  resolved_at timestamptz,
  resolved_note text,
  created_at  timestamptz not null default now()
);
create index if not exists issue_reports_order_id_idx on issue_reports(order_id);
create index if not exists issue_reports_resolved_idx on issue_reports(resolved);

-- ── Orders: cancellation reason + surprise extra ─────────────────────────
alter table orders add column if not exists cancel_reason text;
alter table orders add column if not exists cancelled_at timestamptz;
alter table orders add column if not exists surprise_extra text;   -- admin-set free gift note

-- ── Promotions (flash sales / weekly drops) ──────────────────────────────
create table if not exists promotions (
  id              bigserial primary key,
  title           text not null,                -- 'Friday Drop'
  description     text,
  product_ids     jsonb not null default '[]',  -- array of integer product IDs included
  discount_percent integer not null check (discount_percent between 1 and 90),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  published       boolean not null default false,
  published_at    timestamptz,
  push_sent       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists promotions_published_idx on promotions(published, ends_at);

-- ── Disable RLS on the new tables (service_role bypasses anyway) ─────────
alter table addresses     disable row level security;
alter table reviews       disable row level security;
alter table issue_reports disable row level security;
alter table promotions    disable row level security;
