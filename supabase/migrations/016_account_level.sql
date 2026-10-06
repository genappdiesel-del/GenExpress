-- ===================================================================
-- Migration 016: show WHICH LEVEL each account sits at
-- ===================================================================
-- What this changes: one column added to account_list_view.
--
-- Migration 012 built the account list with nine columns. Four-level
-- chains (migration 014) mean the list has to answer one more question:
-- "and how far down is this person?" A list that shows a name and a
-- role cannot tell a Supplier whether their team is two levels or four,
-- so the structure they set up is invisible to them. That makes the
-- feature unusable, however correctly it works underneath.
--
-- WHY A NEW MIGRATION RATHER THAN EDITING 012
-- Editing an already-committed migration means the file that a person
-- may have already run no longer matches what is on disk. Supabase
-- applies migrations by filename, so a change to 012 would simply never
-- reach a database that already has it -- and there would be no error,
-- only a missing column. Adding a file means every database that ran 012
-- runs this too, in order, and the column appears.
--
-- WHY THE GATE IS RESTATED BELOW (AND WHY THE FIRST VERSION OF THIS FILE
-- WAS WRONG)
-- `create or replace view` replaces the ENTIRE stored query. It keeps
-- GRANTs and ownership, but the SELECT body -- and every clause inside
-- it, including 012's reader gate -- is gone the moment this file runs.
-- The first version of this file assumed the gate "travels with the view
-- body", shipped without it, and handed the whole account list to every
-- signed-in user. The test suite caught it (test 16 reads the list as a
-- Supplier and expects an empty result). The gate is therefore restated
-- at the end of the SELECT below, exactly as 012 wrote it.
--
-- The explicit column list is repeated below rather than reused, because
-- Postgres has no way to inherit it -- and an explicit list is the whole
-- point: a `select *` would let any column added to profiles in a later
-- phase start shipping to the browser.
--
-- WHAT IS STILL NOT EXPOSED
-- Nothing but level is added. Settings, permission switches and
-- created_by remain absent, and the tripwire from 012 still checks for
-- them. The level is a small integer about one person; it says nothing
-- about anybody else.
-- ===================================================================

begin;

-- No `with (security_definer = true, owner = postgres)` on this view --
-- see migration 012 for why both words are rejected by PostgreSQL. The
-- owner was already set to `postgres` there, and `create or replace`
-- preserves ownership, so it carries over here.
create or replace view public.account_list_view
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
  p.created_at,
  -- NEW: 1 is the Supplier, 4 is the deepest anybody may go. Read from
  -- the same bounded walk the database uses to enforce the limit, so a
  -- row's level here can never disagree with the rule that created it.
  --
  -- It sits LAST, not next to role, because Postgres will only let
  -- `create or replace view` APPEND columns. Putting it in the middle
  -- fails outright with "cannot change name of view column", which is a
  -- good rule: it stops an existing column being quietly shifted and
  -- every consumer of it reading by position instead of by name. Nothing
  -- in this app reads a view column by position -- PostgREST returns
  -- named objects -- so the order costs nothing.
  case
    when p.role = 'super_admin' then 1
    else public.supply_chain_depth(p.id)
  end as level
from public.profiles p
-- A left join, not an inner one. An inner join would silently drop the
-- Super Admin row and any supplier row, because their supplier_id is
-- null and no supplier row matches. The list would then be missing the
-- very person looking at it, with no error to explain why.
left join public.profiles s
  on s.id = p.supplier_id
 and s.role = 'supplier'
-- THE GATE, RESTATED. Only the Super Admin ever gets rows out of this
-- view; every other role gets an empty list. The functions underneath
-- read the caller's own id from the JWT, not from the view's owner, so
-- running this as postgres does not accidentally open the list to
-- everyone. If this WHERE clause is ever removed, the whole account list
-- becomes readable by every signed-in user -- see the warning at the top
-- of this file, and the tripwire below that checks for it in the stored
-- definition.
where (select public.current_is_active())
  and (select public.is_super_admin());

comment on view public.account_list_view is
  'Accounts for the Super Admin list, with the owning Supplier name and '
  'the level each person sits at. Readable only by a Super Admin. '
  'No settings, no permissions.';

-- The GRANT is deliberately NOT repeated here: it survives `create or
-- replace` and is stated once, in 012. The reader gate is the opposite:
-- it lives INSIDE the query, and the query is replaced wholesale, so it
-- IS restated above -- see the warning at the top of this file. (There
-- is no policy on this view: PostgreSQL does not allow row policies on
-- views, so the gate lives in the query -- migration 012 explains why.)

-- -------------------------------------------------------------------
-- The tripwire, repeated with `level` allowed
-- -------------------------------------------------------------------
-- 012's version checks a list of column names that must not appear. It
-- already tolerates anything not on that list, so `level` passes without
-- change. This copy exists to state the positive shape of the view: ten
-- columns, no more.
create or replace function public.assert_account_view_is_safe()
returns void
language plpgsql
as $$
declare
  leaked text;
  v_count integer;
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

  -- The gate. A view can pass every column check above and still be wide
  -- open if the reader gate is missing from its query -- that is exactly
  -- what the first version of migration 016 did, and no column check
  -- caught it. The gate must be found in the stored definition, not
  -- assumed.
  if not exists (
    select 1 from pg_views
     where schemaname = 'public'
       and viewname = 'account_list_view'
       and definition ~* 'current_is_active'
       and definition ~* 'is_super_admin'
  ) then
    raise exception
      'account_list_view lost its reader gate. Restore the '
      '"where (select public.current_is_active()) and '
      '(select public.is_super_admin())" clause before releasing.';
  end if;

  -- The shape. Ten columns is the contract this view has with the
  -- screen. Eleven means somebody added one, and the right response is a
  -- decision, not a shrug.
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'account_list_view';

  if v_count <> 10 then
    raise exception
      'account_list_view has % columns, expected 10. Decide deliberately '
      'what the new one exposes before adding it.', v_count;
  end if;
end;
$$;

comment on function public.assert_account_view_is_safe() is
  'Test tripwire. Fails if account_list_view ever grows a settings, '
  'permission or created_by column, or changes shape. Called by '
  'supabase/tests/rls_tests.sql.';

-- Not for the browser. This is a checking tool, and giving it to
-- authenticated would let anybody probe it for information.
revoke all on function public.assert_account_view_is_safe() from public, anon, authenticated;

commit;
