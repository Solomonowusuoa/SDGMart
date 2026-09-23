-- Optional product preferences and delivery instructions captured at checkout.
-- Apply before deploying the application that writes order_notes.
alter table public.orders add column if not exists order_notes text;

-- DOWN
/*
-- Export instructions before rollback if they need to be retained.
alter table public.orders drop column if exists order_notes;
*/
