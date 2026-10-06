-- ===================================================================
-- 012: views for the account list
-- ===================================================================
-- The Super Admin needs a list of every account with the name of the
-- Supplier each one belongs to. profiles stores that link as a bare uuid,
-- which tells an administrator nothing. Joining it to a name needs a
-- view, because a plain select from the browser cannot join two tables
-- at once -- PostgREST returns one table per request.
--
-- WHY A VIEW AND NOT A JOIN IN THE BROWSER
-- The browser is not allowed to join tables, and it is not allowed to
-- read every profile either. A view is the only place where the join
-- happens, and it is written once, here, where it can be reviewed.
--
-- WHAT IS AND IS NOT EXPOSED
-- The view exposes exactly the eight columns the account list screen
-- draws. It does NOT expose:
--
--   - supplier_settings, so an admin list cannot leak the backorder
--     flag or the page size by accident.
--   - client_feature_settings, so switching a permission on is a
--     separate, deliberate act rather than a side effect of building
--     this list.
--   - any password material. There is none in profiles to begin with.
--
-- Only a Super Admin may read this view. See the GRANT and the policy
-- below.
--
-- WHY IT IS SECURITY DEFINER
-- Same reason as the Phase 2 product views: profiles has row level
-- security on it, and a plain view would be filtered by that policy
-- while joining. Making it SECURITY DEFINER means it runs as its owner
-- and the WHERE clause below is the only thing deciding what comes
-- out. The owner is the migration role, which bypasses RLS.
--
-- DO NOT add `security_invoker = on` to this view. That would make the
-- join subject to profiles' own policies and return nothing.
-- ===================================================================

begin;

-- -------------------------------------------------------------------
-- The view
-- -------------------------------------------------------------------
-- Explicit column list. Never `select *`: a column added to profiles
-- later would silently appear here and start shipping to the browser.

create or replace view public.account_list_view
with (security_definer = true, owner = postgres)
as
select
  p.id,
  p.full_name,
  p.username,
  p.role,
  p.supplier_id,
  -- A supplier is not attached to another supplier, so the name is
  -- only ever filled for a client or an agent. One join, not two.
  s.full_name as supplier_name,
  p.is_active,
  p.must_change_password,
  p.created_at
from public.profiles p
-- A left join, not an inner one. An inner join would silently drop the
-- Super Admin row and any supplier row, because their supplier_id is
-- null and no supplier row matches. The list would then be missing the
-- very person looking at it, with no error to explain why.
left join public.profiles s
  on s.id = p.supplier_id
 and s.role = 'supplier';

comment on view public.account_list_view is
  'Accounts for the Super Admin list, with the owning Supplier name. '
  'Readable only by a Super Admin. No settings, no permissions.';

-- -------------------------------------------------------------------
-- RLS on the view
-- -------------------------------------------------------------------
-- A view in Postgres does not get row level security automatically. The
-- policy below is the thing that actually stops a Client reading this.
-- Without it, any signed-in user who guessed the view name in the
-- browser could list every account in the system.

alter table public.account_list_view enable row level security;

drop policy if exists "account_list_view_super_admin_only" on public.account_list_view;
create policy "account_list_view_super_admin_only"
  on public.account_list_view
  for select
  to authenticated
  using (
    (select public.current_is_active())
    and (select public.is_super_admin())
  );

-- -------------------------------------------------------------------
-- GRANT
-- -------------------------------------------------------------------
-- Required from 2026-10-30 because Supabase stops exposing new
-- public-schema objects to the Data API by default. Without it the
-- query fails with "permission denied" even though the policy above is
-- correct.
--
-- RLS and GRANT are two separate gates. GRANT says "you may ask about
-- this at all". The policy says "of the rows in it, which ones you get".
-- Both are needed, and only SELECT: nothing here is ever written to.

grant select on public.account_list_view to authenticated;
revoke all on public.account_list_view from anon, public;

-- -------------------------------------------------------------------
-- Tripwire: prove the view does not leak settings
-- -------------------------------------------------------------------
-- Migration 008 wrote assert_no_sensitive_view_columns() for the
-- product views. This checks the thing this view could plausibly get
-- wrong: somebody later adds a join to supplier_settings or
-- client_feature_settings and the browser starts receiving them.
--
-- Called by the test suite, not by the application. A view cannot call
-- a function to check its own definition.

create or replace function public.assert_account_view_is_safe()
returns void
language plpgsql
as $$
declare
  leaked text;
begin
  -- Anything the browser may read from a view name, so the check is
  -- not defeated by renaming a column.
  select string_agg(column_name, ', ' order by column_name)
  into leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'account_list_view'
    and column_name in (
      -- Settings that belong to the Supplier.
      'allow_backorder', 'page_size', 'currency',
      -- Permission switches.
      'can_view_prices', 'can_view_stock', 'can_view_readiness',
      'can_place_orders', 'can_pay_online', 'can_view_history',
      -- Never: the row link that lets somebody walk the whole graph.
      'created_by'
    );

  if leaked is not null then
    raise exception
      'account_list_view exposes sensitive columns: %', leaked;
  end if;
end;
$$;

comment on function public.assert_account_view_is_safe() is
  'Test tripwire. Fails if account_list_view ever grows a settings or '
  'permission column. Called by supabase/tests/rls_tests.sql.';

-- Not for the browser. This is a checking tool, and giving it to
-- authenticated would let anybody probe it for information.
revoke all on function public.assert_account_view_is_safe() from public, anon, authenticated;

commit;