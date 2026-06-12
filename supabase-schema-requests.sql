-- SDGMart: product_requests table (customers ask for items we don't stock)
-- Run in Supabase SQL Editor. Safe to re-run.

create table if not exists product_requests (
  id              bigserial primary key,
  user_id         bigint references users(id) on delete set null,  -- null for guests
  name            text not null default '',
  whatsapp_number text,                  -- optional
  call_number     text,                  -- optional
  contact_whatsapp boolean not null default true,
  contact_call    boolean not null default false,
  product_name    text not null,         -- what they're looking for
  notes           text,                  -- brand, quantity, special needs
  status          text not null default 'new' check (status in ('new','contacted','found','dismissed')),
  contacted_at    timestamptz,
  admin_note      text,
  created_at      timestamptz not null default now()
);

-- If an older version of the table already exists, add the new columns.
alter table product_requests add column if not exists whatsapp_number text;
alter table product_requests add column if not exists call_number text;
alter table product_requests add column if not exists contact_whatsapp boolean not null default true;
alter table product_requests add column if not exists contact_call boolean not null default false;
-- Old schema had a NOT NULL 'phone' column — relax it so inserts don't fail.
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='product_requests' and column_name='phone') then
    alter table product_requests alter column phone drop not null;
  end if;
end $$;

create index if not exists product_requests_status_idx on product_requests(status);
create index if not exists product_requests_created_at_idx on product_requests(created_at desc);

alter table product_requests enable row level security;
