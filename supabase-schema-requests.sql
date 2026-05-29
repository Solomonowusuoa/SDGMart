-- SDGMart: product_requests table
-- Run after the previous schema files. Safe to re-run.

create table if not exists product_requests (
  id            bigserial primary key,
  user_id       bigint references users(id) on delete set null,  -- null for guests
  name          text not null,
  phone         text not null,                                    -- WhatsApp-ready number
  product_name  text not null,                                    -- what they're looking for
  notes         text,                                             -- brand, quantity, special needs
  status        text not null default 'new' check (status in ('new','contacted','found','dismissed')),
  contacted_at  timestamptz,
  admin_note    text,
  created_at    timestamptz not null default now()
);
create index if not exists product_requests_status_idx on product_requests(status);
create index if not exists product_requests_created_at_idx on product_requests(created_at desc);

alter table product_requests enable row level security;
