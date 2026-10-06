-- ===================================================================
-- Migration 006: products
-- ===================================================================
-- One row per thing a Supplier sells.
--
-- THE TWO PRICES ARE THE WHOLE POINT OF THIS TABLE.
--
--   agent_price   what the Supplier PAYS the Agent for the goods
--   client_price  what the Client PAYS the Supplier
--
-- The gap between them is the Supplier's margin. The brief says the
-- client price should be higher than the agent price, and that we should
-- WARN rather than block if it is not. A warning, not a constraint,
-- because there are legitimate reasons: a clearance sale, a goodwill
-- order, a startup price. Blocking it would stop the Supplier doing
-- business. So the rule lives in the interface, where the Supplier will
-- actually see it, and not in a database constraint that rejects the
-- save and leaves them guessing.
--
-- WHY numeric AND NOT float
-- numeric(14,2) stores money exactly, as typed. A float can quietly turn
-- 1000.10 into 1000.099999999. The brief says "never change my
-- numbers", and this is the column type that keeps that promise.
-- ===================================================================

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),

  -- The Supplier who owns this product. A product belonging to nobody
  -- makes no sense, so this cannot be empty.
  supplier_id uuid not null references public.profiles(id) on delete cascade,

  name        text not null check (length(btrim(name)) > 0),
  sku         text,

  -- The barcode printed on the product. Nullable, because not every
  -- product has one yet. Uniqueness is enforced per Supplier, not
  -- globally -- see the index below for why.
  barcode     text check (barcode is null or length(btrim(barcode)) <= 64),

  -- kg, pcs, box, litre, and so on. Free text so a Supplier can use
  -- whatever word their business actually uses.
  unit        text not null default 'pcs' check (length(btrim(unit)) > 0),

  description text,

  -- Where the photo lives in Supabase Storage. We store only the path,
  -- never the file itself, to keep the database small.
  photo_path  text,

  -- How many we have. May go negative IF the Supplier has switched on
  -- "allow backorder", which the check below defers to a trigger.
  stock_qty      numeric(14,3) not null default 0,
  -- Warn when stock falls to or below this number. 0 means "no warning".
  low_stock_level numeric(14,3) not null default 0
                   check (low_stock_level >= 0),

  -- What we pay the Agent. Zero is allowed: giving goods away free is a
  -- real thing that happens on samples and replacements.
  agent_price  numeric(14,2) not null default 0 check (agent_price >= 0),

  -- What the Client pays us.
  client_price numeric(14,2) not null default 0 check (client_price >= 0),

  -- A retired product is hidden from Clients but still keeps its history,
  -- so old orders and reports still make sense. Never delete a product
  -- that has been ordered.
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -------------------------------------------------------------------
-- Uniqueness
-- -------------------------------------------------------------------
-- The brief says "same barcode on two products -> block, with a clear
-- message". We enforce it PER SUPPLIER, not across the whole platform.
--
-- Reason: a barcode is a manufacturer code, not ours. Two Suppliers who
-- both sell the same brand of milk will legitimately hold the same EAN.
-- Forcing them to invent different barcodes would corrupt real product
-- data and break their label printing.
--
-- Making it unique per Supplier is also exactly what the app needs: an
-- Agent scans a barcode to ask for goods, and an Agent belongs to one
-- Supplier. So the lookup is always "this barcode, within my Supplier",
-- which this index supports directly.
--
-- The partial index skips rows with no barcode, because many products
-- will not have one and they should not collide with each other on empty.
create unique index if not exists products_supplier_barcode_key
  on public.products (supplier_id, btrim(barcode))
  where barcode is not null and btrim(barcode) <> '';

-- Same reasoning for the Supplier's own internal code (SKU).
create unique index if not exists products_supplier_sku_key
  on public.products (supplier_id, lower(btrim(sku)))
  where sku is not null and btrim(sku) <> '';

-- "Show me my active products, newest first" is the most common query on
-- the product screen.
create index if not exists products_supplier_active_idx
  on public.products (supplier_id, is_active, created_at desc);

-- "Show me everything at or below the low stock level" powers the low
-- stock report and the Supplier dashboard warning.
create index if not exists products_low_stock_idx
  on public.products (supplier_id, low_stock_level)
  where is_active;

-- -------------------------------------------------------------------
-- Keep updated_at honest
-- -------------------------------------------------------------------
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ===================================================================
-- SECURITY
-- ===================================================================
-- THE IMPORTANT PART: there is deliberately NO policy for the client or
-- agent roles on this table.
--
-- The brief is explicit: "Clients read the view, never the products
-- table" and "Agents can read products ... through a view". That is not
-- a style preference. If a Client could read this table, they would see
-- agent_price, which is the single most damaging number in this app --
-- it reveals what the Supplier pays their own Agents, and therefore the
-- Supplier's profit, to a customer.
--
-- With no policy, Postgres returns zero rows. The Client then reads
-- client_products_view instead, which is built to expose only the
-- columns a Client is allowed to see. That view is created in migration
-- 008.
--
-- The GRANT below still gives authenticated SELECT on this table. That
-- looks contradictory but is not: GRANT says "you may ask", RLS decides
-- "what you get back". A Client asking gets an empty result, not an
-- error. Supabase gives every logged-in user one database role
-- (authenticated), so a table-level grant cannot be withheld from Clients
-- while being given to Suppliers. The RLS policy is the only gate that
-- can separate them, which is why the missing policy is the security.
-- ===================================================================

alter table public.products enable row level security;

-- Super Admin: everything.
drop policy if exists "products_all_super_admin" on public.products;
create policy "products_all_super_admin"
  on public.products
  for all
  to authenticated
  using (select public.is_super_admin())
  with check (select public.is_super_admin());

-- Supplier: only their own products, and only while active.
drop policy if exists "products_all_own_supplier" on public.products;
create policy "products_all_own_supplier"
  on public.products
  for all
  to authenticated
  using (
    (select public.current_is_active())
    and (select auth.uid()) = supplier_id
  )
  with check (
    (select public.current_is_active())
    and (select auth.uid()) = supplier_id
  );

-- The WITH CHECK above is what stops a Supplier writing a row that
-- belongs to somebody else. Without it, a Supplier could pass another
-- Supplier's id and the USING clause would be re-checked on the new row
-- and would fail -- so the write would be rejected. WITH CHECK makes that
-- explicit rather than accidental.

-- No SELECT policy for client or agent. See the note above. This absence
-- is load-bearing and must not be "tidied up".

-- -------------------------------------------------------------------
-- GRANT
-- -------------------------------------------------------------------
-- Required: from 2026-10-30 Supabase does not expose new public-schema
-- tables to the Data API by default, and every query would fail with
-- "permission denied" even with perfect RLS. See migration 003.
-- -------------------------------------------------------------------
grant select, insert, update, delete on public.products to authenticated;

-- -------------------------------------------------------------------
-- Comments in the database itself
-- -------------------------------------------------------------------
-- Supabase shows these in Studio, so whoever is looking at a table later
-- reads the same explanation we wrote here.
comment on table public.products is
  'Products a Supplier sells. agent_price is what the Supplier pays their Agent; client_price is what a Client pays the Supplier. Clients and Agents must read the views in migration 008, never this table.';
comment on column public.products.agent_price is
  'What the Supplier pays the Agent. Never visible to a Client.';
comment on column public.products.client_price is
  'What the Client pays the Supplier. Never visible to an Agent.';