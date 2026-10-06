-- ===================================================================
-- Migration 009: stock movements
-- ===================================================================
-- products.stock_qty is a number anyone could edit. That is dangerous,
-- because stock is money: 50 crates exist or they do not, and if two
-- people change the count there is no way to find out who was right.
--
-- The fix is to stop treating stock_qty as something anybody writes. It
-- becomes a running total that the DATABASE computes, from an
-- append-only list of movements that nobody may alter.
--
--   products.stock_qty   the current answer.  Read-only to everyone.
--   stock_movements      the evidence.  Written once, never edited,
--                        never deleted.
--
-- If a number is ever wrong, we look at the movements and see exactly
-- which one was wrong and who entered it. Without that list, a wrong
-- number is just wrong.
-- ===================================================================

create type public.stock_movement_reason as enum (
  'purchase',        -- goods we bought
  'sale',            -- goods we sold
  'delivery_out',    -- we sent to an Agent or Client
  'delivery_in',     -- an Agent or Client returned goods
  'adjustment',      -- a counted correction, e.g. damaged in the warehouse
  'opening'          -- the count we started from
);

create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),

  supplier_id uuid not null references public.profiles(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete restrict,

  -- How much to ADD to stock. A sale is a negative number.
  -- Stored as a signed change rather than a running total so that
  -- summing the column gives the current stock, which is the one
  -- property we actually care about.
  qty_delta   numeric(14,3) not null
              check (qty_delta <> 0),

  reason      public.stock_movement_reason not null,

  -- Free text the person types: "van broke down", "counted the shelf".
  -- Recorded so a strange number can be explained later.
  note        text,

  -- Who pressed the button. Kept even though the row can never change,
  -- because an append-only log that does not say who wrote it is only
  -- half the answer to "how did this happen".
  created_by  uuid not null references public.profiles(id) on delete restrict,

  -- The stock level AFTER this movement was applied. Stored per row so
  -- history can be read forwards without replaying everything, and so
  -- the running total can be verified against itself.
  qty_after   numeric(14,3) not null,

  created_at  timestamptz not null default now()
);

-- The product screen's history list: newest first, for one product.
create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

-- "Show me everything that moved today" for the Supplier dashboard.
create index if not exists stock_movements_supplier_time_idx
  on public.stock_movements (supplier_id, created_at desc);

-- A product's stock is the sum of its movements. This index makes that
-- sum cheap even for a product with years of history.
create index if not exists stock_movements_product_qty_idx
  on public.stock_movements (product_id, qty_delta);

-- -------------------------------------------------------------------
-- append_movement: writes the evidence
-- -------------------------------------------------------------------
-- SECURITY DEFINER for one specific reason. It has to write to
-- products.stock_qty, but Suppliers must NOT be able to write that
-- column themselves -- that is the whole point of this migration. A
-- SECURITY DEFINER function runs with the table owner's rights, so it
-- can update stock_qty without ever granting that right to a person.
--
-- It lives in the private schema so the Data API cannot reach it at all.
-- Only the wrapper below can call it.
create or replace function private.append_stock_movement(
  p_product_id  uuid,
  p_qty_delta   numeric,
  p_reason      public.stock_movement_reason,
  p_note        text
)
returns numeric
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_supplier_id uuid;
  v_before      numeric;
  v_after       numeric;
  v_caller      uuid := auth.uid();
  v_allow_backorder boolean;
begin
  -- Lock the product row for the rest of this transaction. Two people
  -- adjusting the same product at the same time would otherwise both
  -- read the same "before" figure and the second write would overwrite
  -- the first -- a lost update, and stock that does not add up.
  select supplier_id, stock_qty into v_supplier_id, v_before
  from public.products
  where id = p_product_id and is_active
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'
      using hint = 'product_not_found_or_inactive';
  end if;

  -- Permission: the Supplier who owns the product, or the platform owner.
  if v_caller is distinct from v_supplier_id
     and not public.is_super_admin() then
    raise exception 'NOT_YOUR_PRODUCT'
      using hint = 'not_your_product';
  end if;

  v_after := v_before + p_qty_delta;

  -- The backorder rule. Going negative means promising goods we do not
  -- have, which is allowed only if the Supplier has switched it on.
  select allow_backorder into v_allow_backorder
  from public.supplier_settings
  where supplier_id = v_supplier_id;

  if v_after < 0 and not coalesce(v_allow_backorder, false) then
    raise exception 'NEGATIVE_STOCK_NOT_ALLOWED'
      using hint = 'negative_stock_not_allowed';
  end if;

  -- Evidence first, then the total. Both inside the caller's
  -- transaction, so if the second statement fails both are rolled back
  -- and we never end up with stock that does not match its own history.
  insert into public.stock_movements
    (supplier_id, product_id, qty_delta, reason, note, created_by, qty_after)
  values
    (v_supplier_id, p_product_id, p_qty_delta, p_reason, p_note, v_caller, v_after);

  update public.products
  set stock_qty = v_after
  where id = p_product_id;

  return v_after;
end;
$$;

-- -------------------------------------------------------------------
-- The wrapper the app actually calls
-- -------------------------------------------------------------------
-- Put in public because the browser has to be able to reach it. Given
-- only to authenticated, because anonymous callers must never be able to
-- change stock.
--
-- The permission check lives INSIDE the private function, not here. That
-- is deliberate: the check must be somewhere the private function
-- controls, so that this wrapper cannot be edited later into something
-- that skips it.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_qty_delta  numeric,
  p_reason     public.stock_movement_reason,
  p_note       text default null
)
returns numeric
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  if (select public.current_is_active()) is not true then
    raise exception 'ACCOUNT_IS_NOT_ACTIVE' using hint = 'account_not_active';
  end if;

  return private.append_stock_movement(
    p_product_id, p_qty_delta, p_reason, p_note
  );
end;
$$;

comment on function public.adjust_stock(uuid, numeric, public.stock_movement_reason, text) is
  'Adds to or subtracts from a product''s stock and records why. Stock can only change through this function.';

grant execute on function public.adjust_stock(uuid, numeric, public.stock_movement_reason, text)
  to authenticated;

-- Nobody gets to call the private one directly.
revoke execute on function private.append_stock_movement(uuid, numeric, public.stock_movement_reason, text)
  from public, anon, authenticated;

-- -------------------------------------------------------------------
-- products.stock_qty is now read-only
-- -------------------------------------------------------------------
-- Suppliers are permitted to update a product -- name, price, and so on.
-- But they are no longer permitted to update the stock column, because
-- a stock change without a movement record is an unexplainable number.
--
-- Postgres column-level grants do exactly this: full rights on the
-- table, minus one column.
--
-- Super Admin also loses it. If the platform owner can type a stock
-- number in directly, the rule has a hole and the hole will be used.
-- The correct repair is to post an adjustment, which leaves a note and a
-- name behind it.
revoke update on public.products from authenticated;
grant update (name, sku, barcode, unit, description, photo_path,
              low_stock_level, agent_price, client_price, is_active)
  on public.products to authenticated;

-- ===================================================================
-- SECURITY on the movement log
-- ===================================================================
-- Read: the owning Supplier, and Super Admin.
--
-- Write: nobody. The log is appended to only by the SECURITY DEFINER
-- function above, which runs as the table owner. That is the whole
-- enforcement: there is no INSERT policy for people at all.
--
-- Update and delete: nobody, ever, including Super Admin. If a movement
-- is wrong the answer is a correcting movement, which keeps the truth
-- and shows that a correction happened. Rewriting history to look
-- tidier is how inventory records stop being usable.
-- ===================================================================

alter table public.stock_movements enable row level security;

drop policy if exists "stock_movements_select_own" on public.stock_movements;
create policy "stock_movements_select_own"
  on public.stock_movements
  for select
  to authenticated
  using (
    (select public.current_is_active())
    and (
      supplier_id = (select auth.uid())
      or (select public.is_super_admin())
    )
  );

-- No INSERT, UPDATE or DELETE policy on purpose. See above.

grant select on public.stock_movements to authenticated;
-- Deliberately no insert/update/delete grant: from 2026-10-30 nothing new
-- is exposed to the Data API unless asked for, and we are not asking.

-- -------------------------------------------------------------------
-- Defence in depth against silent edits
-- -------------------------------------------------------------------
-- The grants already prevent editing this table. This trigger is the
-- second lock on the same door: even if somebody later hands back a
-- grant by mistake, an edit to a movement still fails loudly.
create or replace function public.reject_stock_movement_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'STOCK_MOVEMENTS_ARE_APPEND_ONLY'
    using hint = 'post_a_correcting_movement_instead';
end;
$$;

drop trigger if exists stock_movements_no_update on public.stock_movements;
create trigger stock_movements_no_update
  before update or delete on public.stock_movements
  for each row execute function public.reject_stock_movement_change();

comment on table public.stock_movements is
  'Append-only record of every change to products.stock_qty. Written only by private.append_stock_movement(). Never updated, never deleted -- post a correcting movement instead.';

comment on column public.products.stock_qty is
  'Current stock. Read-only: changes only through public.adjust_stock(), which records a stock_movements row in the same transaction.';