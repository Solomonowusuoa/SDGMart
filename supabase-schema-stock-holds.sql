-- SDGMart: stock reservations (audit finding C-10)
--
-- Before this, decrementStock was the only code that ever touched stock and it
-- only subtracted: read-modify-write (so two concurrent orders both read the
-- same number and wrote the same decrement, losing a sale), running after the
-- commit inside a swallowed catch, with no restock on cancel, payment failure
-- or deletion. Harmless only because the deduct_stock toggle is off.
--
-- ── The model ────────────────────────────────────────────────────────────
-- products.stock means WHAT IS PHYSICALLY ON THE SHELF. It is never reduced to
-- represent "someone might buy this".
--
-- A hold is a row in stock_holds with an expiry. Availability is
--     products.stock - SUM(qty of unexpired holds)
-- so an abandoned checkout returns its stock the moment its hold lapses, with
-- no sweep required for correctness. expire_stock_holds() only reclaims disk.
--
-- Holds are taken at CHECKOUT, never at add-to-cart: carts here persist across
-- sessions and devices, so a cart-level hold would lock the last of an item
-- indefinitely for someone who wandered off.
--
-- Every function locks its product rows with FOR UPDATE in id order, so
-- concurrent checkouts serialise instead of racing or deadlocking.
--
-- All of this is inert while the deduct_stock admin toggle is off — the
-- application does not call any of it.
--
-- Run on STAGING first. Additive and re-runnable.


-- ══ 1. THE HOLDS TABLE ════════════════════════════════════════════════════
create table if not exists stock_holds (
  id          bigserial primary key,
  product_id  bigint      not null references products(id) on delete cascade,
  qty         integer     not null check (qty > 0),
  hold_key    text        not null,   -- groups every line of one checkout attempt
  user_id     bigint      references users(id) on delete set null,  -- null for guests
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists stock_holds_product_active_idx
  on stock_holds (product_id, expires_at);
create index if not exists stock_holds_key_idx
  on stock_holds (hold_key);


-- ══ 2. AVAILABILITY ═══════════════════════════════════════════════════════
-- What a customer can actually buy right now.
create or replace function stock_available(p_ids bigint[])
returns table (product_id bigint, on_shelf integer, held integer, available integer)
language sql stable as $fn$
  select p.id,
         p.stock,
         coalesce(h.held, 0)::integer,
         greatest(p.stock - coalesce(h.held, 0), 0)::integer
    from products p
    left join (
      select sh.product_id, sum(sh.qty)::integer as held
        from stock_holds sh
       where sh.expires_at > now()
       group by sh.product_id
    ) h on h.product_id = p.id
   where p.id = any(p_ids);
$fn$;


-- ══ 3. TAKE A HOLD ════════════════════════════════════════════════════════
-- p_items: [{"id": 12, "qty": 2}, ...]
-- Returns {"ok": true}, or {"ok": false, "shortfalls": [{...}]}.
-- All or nothing: if any line cannot be satisfied, nothing is held.
create or replace function hold_stock(p_items jsonb, p_hold_key text, p_ttl_minutes int default 15)
returns jsonb
language plpgsql as $fn$
declare
  v_short jsonb := '[]'::jsonb;
  v_row   record;
begin
  if p_hold_key is null or length(p_hold_key) = 0 then
    raise exception 'hold_stock requires a hold key';
  end if;

  perform 1 from products
   where id in (select (value->>'id')::bigint from jsonb_array_elements(p_items))
   order by id
     for update;

  for v_row in
    select (e.value->>'id')::bigint  as pid,
           (e.value->>'qty')::int    as want,
           greatest(p.stock - coalesce((
             select sum(sh.qty) from stock_holds sh
              where sh.product_id = p.id and sh.expires_at > now()
           ), 0), 0)::int            as avail
      from jsonb_array_elements(p_items) e
      join products p on p.id = (e.value->>'id')::bigint
  loop
    if v_row.want > v_row.avail then
      v_short := v_short || jsonb_build_object(
        'id', v_row.pid, 'want', v_row.want, 'available', v_row.avail);
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('ok', false, 'shortfalls', v_short);
  end if;

  insert into stock_holds (product_id, qty, hold_key, expires_at)
  select (e.value->>'id')::bigint,
         (e.value->>'qty')::int,
         p_hold_key,
         now() + (p_ttl_minutes || ' minutes')::interval
    from jsonb_array_elements(p_items) e;

  return jsonb_build_object('ok', true);
end $fn$;


-- ══ 4. RELEASE A HOLD (abandoned checkout) ════════════════════════════════
create or replace function release_stock_hold(p_hold_key text)
returns integer
language plpgsql as $fn$
declare v_n integer;
begin
  delete from stock_holds where hold_key = p_hold_key;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;


-- ══ 5. COMMIT A HOLD (the order was placed) ═══════════════════════════════
-- Turns held quantities into a real reduction of what is on the shelf, and
-- drops the holds — under one row lock.
create or replace function commit_stock_hold(p_hold_key text)
returns jsonb
language plpgsql as $fn$
declare v_n integer;
begin
  perform 1 from products
   where id in (select product_id from stock_holds where hold_key = p_hold_key)
   order by id
     for update;

  update products p
     set stock = greatest(p.stock - h.qty, 0)
    from (select product_id, sum(qty)::int as qty
            from stock_holds where hold_key = p_hold_key
           group by product_id) h
   where p.id = h.product_id;

  delete from stock_holds where hold_key = p_hold_key;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'lines', v_n);
end $fn$;


-- ══ 6. CONSUME WITHOUT A PRIOR HOLD (cash on delivery) ════════════════════
-- Cash orders commit immediately, so there is no gap to hold across. This is
-- the atomic check-and-decrement the old read-modify-write should have been.
create or replace function consume_stock(p_items jsonb)
returns jsonb
language plpgsql as $fn$
declare
  v_short jsonb := '[]'::jsonb;
  v_row   record;
begin
  perform 1 from products
   where id in (select (value->>'id')::bigint from jsonb_array_elements(p_items))
   order by id
     for update;

  for v_row in
    select (e.value->>'id')::bigint as pid,
           (e.value->>'qty')::int   as want,
           greatest(p.stock - coalesce((
             select sum(sh.qty) from stock_holds sh
              where sh.product_id = p.id and sh.expires_at > now()
           ), 0), 0)::int           as avail
      from jsonb_array_elements(p_items) e
      join products p on p.id = (e.value->>'id')::bigint
  loop
    if v_row.want > v_row.avail then
      v_short := v_short || jsonb_build_object(
        'id', v_row.pid, 'want', v_row.want, 'available', v_row.avail);
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('ok', false, 'shortfalls', v_short);
  end if;

  update products p
     set stock = greatest(p.stock - e.qty, 0)
    from (select (value->>'id')::bigint as id, sum((value->>'qty')::int)::int as qty
            from jsonb_array_elements(p_items) group by 1) e
   where p.id = e.id;

  return jsonb_build_object('ok', true);
end $fn$;


-- ══ 7. PUT STOCK BACK (cancel, payment failure, deletion) ═════════════════
-- The path that did not exist at all. Without it a cancelled order left its
-- stock permanently subtracted, and the shop eventually reported "sold out"
-- for items sitting on the shelf.
create or replace function restock_items(p_items jsonb)
returns jsonb
language plpgsql as $fn$
begin
  perform 1 from products
   where id in (select (value->>'id')::bigint from jsonb_array_elements(p_items))
   order by id
     for update;

  update products p
     set stock = p.stock + e.qty
    from (select (value->>'id')::bigint as id, sum((value->>'qty')::int)::int as qty
            from jsonb_array_elements(p_items) group by 1) e
   where p.id = e.id;

  return jsonb_build_object('ok', true);
end $fn$;


-- ══ 8. RECLAIM EXPIRED HOLD ROWS ══════════════════════════════════════════
-- Correctness does not depend on this — availability already ignores expired
-- rows. This is disk hygiene, called from the daily job.
create or replace function expire_stock_holds()
returns integer
language plpgsql as $fn$
declare v_n integer;
begin
  delete from stock_holds where expires_at < now() - interval '1 day';
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;


-- ══ 9. VERIFY ═════════════════════════════════════════════════════════════
--   select * from stock_available(array[1,2,3]);
--
-- Take a hold, watch availability drop, release it, watch it return:
--   select hold_stock('[{"id":1,"qty":2}]'::jsonb, 'test-key', 15);
--   select * from stock_available(array[1]);      -- available is 2 lower
--   select release_stock_hold('test-key');
--   select * from stock_available(array[1]);      -- back to on_shelf
--
-- Over-holding is refused rather than going negative:
--   select hold_stock('[{"id":1,"qty":999999}]'::jsonb, 'test-2', 15);
--   -- {"ok": false, "shortfalls": [...]}


-- ══ DOWN ══
drop function if exists expire_stock_holds();
drop function if exists restock_items(jsonb);
drop function if exists consume_stock(jsonb);
drop function if exists commit_stock_hold(text);
drop function if exists release_stock_hold(text);
drop function if exists hold_stock(jsonb, text, int);
drop function if exists stock_available(bigint[]);
drop table if exists stock_holds;
