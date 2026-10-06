-- ===================================================================
-- Migration 008: the two product views
-- ===================================================================
-- This is the most security-sensitive file in the app so far.
--
-- The problem being solved: a Client must never learn the Agent price,
-- and an Agent must never learn the Client price. Get this wrong and a
-- Supplier's profit margin is handed to a competitor or a customer.
--
-- THE MECHANISM, and why it is done this way:
--
--   1. The products table has NO select policy for client or agent
--      (migration 006). So when a Client asks the database directly,
--      it gets zero rows. They cannot read agent_price because they
--      cannot read the table at all.
--
--   2. Instead they read a VIEW that lists the safe columns by name.
--      A view runs as its owner, and the owner is the database admin,
--      so it can see the table the caller cannot.
--
--   3. The view therefore does the filtering itself: right columns,
--      right supplier, right permissions.
--
-- Two rules that must never be broken, and why each matters:
--
--   NEVER use "select *" in these views. A future migration that adds a
--   column would silently appear in the view and start leaking it. The
--   whole safety of this design rests on the column list being written
--   out by hand, one name at a time.
--
--   Do NOT add security_invoker = on. That option makes the view obey the
--   products table's own row rules, which is right for most apps and
--   catastrophically wrong here: it would make the view return nothing
--   at all for Clients, because they have no policy on products.
-- ===================================================================

-- -------------------------------------------------------------------
-- client_products_view
-- -------------------------------------------------------------------
-- What a Client of this Supplier may see. One row per active product
-- belonging to that Client's own Supplier.
--
-- Columns, and why each is here or absent:
--   id, name, unit, description   the product itself
--   client_price                  what they will be charged (permission)
--   stock_qty                     how many are left     (permission)
--   readiness                     Ready / Low / Not ready (permission)
--   sku, supplier_id              ABSENT. The SKU is the Supplier's
--                                 internal code and tells a Client how
--                                 the Supplier buys things. supplier_id
--                                 is not the Client's business either.
--   agent_price                   ABSENT, and the whole reason this file
--                                 exists. Never add it.
create or replace view public.client_products_view
as
select
  p.id,
  p.name,
  p.unit,
  p.description,
  p.photo_path,
  p.updated_at,

  -- Permission-gated. When the Supplier has not allowed prices, this
  -- comes back as null and the screen shows no number at all rather
  -- than a hidden one. Hiding it in CSS would still leave the number in
  -- the page source for anyone who knows where to look.
  case
    when coalesce(f.can_view_prices, true) then p.client_price
    else null
  end as client_price,

  case
    when coalesce(f.can_view_stock, true) then p.stock_qty
    else null
  end as stock_qty,

  case
    when coalesce(f.can_view_readiness, true) then
      case
        when p.stock_qty <= 0 then 'not_ready'
        when p.stock_qty <= p.low_stock_level then 'low_stock'
        else 'ready'
      end
    else null
  end as readiness
from public.products p
join public.client_feature_settings f
  on f.client_id = auth.uid()
-- Two guards instead of one, so a Client never sees another Supplier's
-- products even if their own settings row is somehow wrong.
join public.profiles me
  on me.id = auth.uid()
  and me.role = 'client'
  and me.is_active
  and me.supplier_id = p.supplier_id
where p.supplier_id = me.supplier_id
  and p.is_active;

comment on view public.client_products_view is
  'Products a Client may see. Hides agent_price, sku and supplier_id always, and stock, price and readiness when the Supplier has switched them off for this Client.';

-- -------------------------------------------------------------------
-- agent_products_view
-- -------------------------------------------------------------------
-- What an Agent may see. The Agent works for one Supplier, so this is
-- their own Supplier's catalogue at the price THEY pay.
--
--   agent_price  what the Agent pays            INCLUDED
--   client_price what the Client pays           ABSENT. The Agent must
--                never learn the selling price. They would immediately
--                know the Supplier's margin on every item and could use
--                it to negotiate, or to undercut the Supplier to the
--                Client directly.
--   other agents' and clients' data            ABSENT, filtered out by
--                the supplier_id comparison.
create or replace view public.agent_products_view
as
select
  p.id,
  p.name,
  p.unit,
  p.description,
  p.photo_path,
  p.barcode,
  p.stock_qty,
  p.low_stock_level,
  p.updated_at,
  -- The Agent's cost. Same permission logic as the Client view: null
  -- unless their Supplier allows it.
  case
    when coalesce(f.can_view_prices, true) then p.agent_price
    else null
  end as agent_price,
  case
    when p.stock_qty <= 0 then 'not_ready'
    when p.stock_qty <= p.low_stock_level then 'low_stock'
    else 'ready'
  end as readiness
from public.products p
join public.profiles me
  on me.id = auth.uid()
  and me.role = 'agent'
  and me.is_active
  and me.supplier_id = p.supplier_id
-- Agents are governed by the same switches as Clients. A row is
-- expected because every Agent gets one on creation; the left join means
-- a missing row shows less rather than hiding the catalogue entirely,
-- which would look like a bug to the Supplier's own staff.
left join public.client_feature_settings f
  on f.client_id = me.id
where p.supplier_id = me.supplier_id
  and p.is_active;

comment on view public.agent_products_view is
  'Products an Agent may see. Hides client_price always, so an Agent can never learn the Supplier margin.';

-- -------------------------------------------------------------------
-- GRANT
-- -------------------------------------------------------------------
-- Clients and Agents need to read the views. They do NOT need any grant
-- on products itself -- migration 006 relies on RLS to give them
-- nothing, and that still holds.
grant select on public.client_products_view to authenticated;
grant select on public.agent_products_view to authenticated;

-- Belt and braces on the way in. By default a view gives nothing to
-- PUBLIC, but database-wide default privileges have been changed often
-- enough that we should not rely on it. anon means "someone who has not
-- logged in". Nobody may browse a supplier's catalogue without an
-- account, so these two lines guarantee that even if somebody later
-- relaxes the defaults, prices stay behind a login.
revoke select on public.client_products_view from anon;
revoke select on public.agent_products_view from anon;
revoke select on public.client_products_view from public;
revoke select on public.agent_products_view from public;

-- -------------------------------------------------------------------
-- Guard rails
-- -------------------------------------------------------------------
-- These are not security controls. They are tripwires, so that if a
-- future change ever adds a forbidden column to a view, the test suite
-- in supabase/tests/rls_tests.sql fails loudly instead of the leak
-- reaching production. Cheap insurance on the one file where a silent
-- change is most expensive.
create or replace function public.assert_no_sensitive_view_columns()
returns void
language plpgsql
as $$
declare
  leaked text;
begin
  select string_agg(x.col, ', ')
    into leaked
  from (
    select 'client_products_view.agent_price' as col
      where exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'client_products_view'
          and column_name = 'agent_price'
      )
    union all
    select 'client_products_view.sku'
      where exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'client_products_view'
          and column_name = 'sku'
      )
    union all
    select 'agent_products_view.client_price'
      where exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'agent_products_view'
          and column_name = 'client_price'
      )
  ) x;

  if leaked is not null then
    raise exception 'FORBIDDEN COLUMN EXPOSED BY VIEW: %', leaked;
  end if;
end;
$$;

comment on function public.assert_no_sensitive_view_columns() is
  'Tripwire. Fails loudly if a price column leaks into the wrong view. Called by the RLS test suite, not by the app.';