-- SDGMart Supabase schema
-- Paste this whole file into Supabase → SQL Editor → New Query → Run
-- Safe to re-run: every CREATE uses IF NOT EXISTS.

-- ── Products ──────────────────────────────────────────────────────────────
create table if not exists products (
  id           bigserial primary key,
  name         text not null,
  category     text not null,
  price        numeric(10,2) not null,
  unit         text,
  best_before  date,
  stock        integer not null default 0,
  description  text,
  bestseller   boolean not null default false,
  low_stock_threshold integer default 5,
  created_at   timestamptz not null default now()
);
create index if not exists products_category_idx on products(category);
create index if not exists products_bestseller_idx on products(bestseller) where bestseller = true;

-- ── Users (customers + admin; riders are separate) ───────────────────────
create table if not exists users (
  id                bigserial primary key,
  name              text not null,
  email             text not null unique,
  phone             text,
  password_hash     text,
  role              text not null default 'customer' check (role in ('customer','admin')),
  email_verified    boolean not null default false,
  total_spent       numeric(12,2) not null default 0,
  squad_code        text,
  owns_squad        boolean not null default false,
  discount_pending  boolean not null default false,
  must_change_password boolean not null default false,
  google_id         text unique,
  picture           text,
  ref_code          text unique,
  loyalty_balance   numeric(10,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists users_squad_code_idx on users(squad_code) where squad_code is not null;

-- ── Riders ────────────────────────────────────────────────────────────────
create table if not exists riders (
  id            bigserial primary key,
  name          text not null,
  email         text not null unique,
  phone         text,
  password_hash text not null,
  online        boolean not null default false,
  lat           double precision,
  lng           double precision,
  last_location_at timestamptz,
  created_at    timestamptz not null default now()
);

-- ── Orders ────────────────────────────────────────────────────────────────
create table if not exists orders (
  id              bigserial primary key,
  user_id         bigint references users(id) on delete set null,
  customer_name   text,
  customer_phone  text,
  recipient_name  text,
  recipient_phone text,
  address         text,
  neighborhood    text,
  items           jsonb not null default '[]'::jsonb,
  subtotal        numeric(12,2) not null default 0,
  delivery_fee    numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  loyalty_used    numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  payment_method  text,
  momo_number     text,
  status          text not null default 'queued' check (status in ('queued','assigned','in_transit','delivered','cancelled')),
  location        jsonb,
  rider_id        bigint references riders(id) on delete set null,
  delivery_date   date,
  priority        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists orders_user_id_idx on orders(user_id);
create index if not exists orders_rider_id_idx on orders(rider_id);
create index if not exists orders_status_idx on orders(status);
create index if not exists orders_delivery_date_idx on orders(delivery_date);

-- ── Sessions (auth tokens) ────────────────────────────────────────────────
create table if not exists sessions (
  token       text primary key,
  user_id     bigint not null,
  user_type   text not null default 'user' check (user_type in ('user','rider')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_expires_at_idx on sessions(expires_at);

-- ── Email-verification & password-reset tokens ───────────────────────────
create table if not exists email_tokens (
  token       text primary key,
  user_id     bigint not null references users(id) on delete cascade,
  purpose     text not null default 'verify' check (purpose in ('verify','reset')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ── Web Push subscriptions ────────────────────────────────────────────────
create table if not exists push_subscriptions (
  id         bigserial primary key,
  user_id    bigint not null references users(id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);

-- ── Search analytics ──────────────────────────────────────────────────────
create table if not exists search_queries (
  id         bigserial primary key,
  query      text not null,
  user_id    bigint references users(id) on delete set null,
  result_count integer,
  created_at timestamptz not null default now()
);
create index if not exists search_queries_query_idx on search_queries(lower(query));
create index if not exists search_queries_created_at_idx on search_queries(created_at desc);

-- ── Recurring orders ──────────────────────────────────────────────────────
create table if not exists recurring_orders (
  id            bigserial primary key,
  user_id       bigint not null references users(id) on delete cascade,
  items         jsonb not null,
  cadence_days  integer not null check (cadence_days > 0),
  next_run_at   date not null,
  delivery_info jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists recurring_orders_next_run_idx on recurring_orders(next_run_at) where active = true;

-- ── Singleton: VAPID keys, app settings ──────────────────────────────────
create table if not exists app_config (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
-- Default settings (only inserted if missing)
insert into app_config (key, value)
  values ('inventory_threshold_default', '5'::jsonb)
  on conflict (key) do nothing;

-- ── Row-Level Security ────────────────────────────────────────────────────
-- RLS is ENABLED on every table for defence-in-depth. Our server uses the
-- service_role key, which bypasses RLS entirely, so the app works exactly
-- the same. The anon/authenticated keys (never used in this codebase) get
-- no access by default — a leaked anon key cannot read or write anything.
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
