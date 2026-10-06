-- ===================================================================
-- Migration 002: Row Level Security on profiles
-- ===================================================================
-- RLS = the database decides which rows you can see.
--
-- The rule we are enforcing:
--   super_admin -> sees everything
--   supplier    -> sees own row, plus own clients and own agents
--   client      -> sees ONLY own row and their own Supplier's row
--   agent       -> sees ONLY own row and their own Supplier's row
--
-- Note the difference between "the screen hides it" and "the database
-- refuses it". This file is the second one. That is the whole point.
-- ===================================================================

alter table public.profiles enable row level security;

-- -------------------------------------------------------------------
-- READ
-- -------------------------------------------------------------------
-- No policy = no access. Postgres denies by default once RLS is on, so we
-- only write policies for the access we actually intend to allow.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (
    -- A deactivated account gets nothing at all. Doing this here, in the
    -- database, means switching someone off actually switches them off.
    (select public.current_is_active())

    -- 1. You can always read your own row.
    and (
      id = (select auth.uid())

      -- 2. Super Admin can read everyone's row.
      or (select public.is_super_admin())

      -- 3. A Client or Agent can read the Supplier they belong to, so their
      --    screens can show that Supplier's name.
      --    Note the direction: we compare the ROW's id against OUR
      --    supplier_id. This is the OPPOSITE direction from rule 4, and
      --    getting it backwards is an easy mistake that silently hides the
      --    row rather than leaking it.
      or id = (select public.current_supplier_id())

      -- 4. A Supplier can read their own Clients and Agents, so they can
      --    build the "my agents" list and show agent names on their own
      --    screens. Here we compare the ROW's supplier_id against OUR id.
      or supplier_id = (select auth.uid())
    )
  );

-- -------------------------------------------------------------------
-- Why there is no branch for "a Supplier can read another Supplier"
-- -------------------------------------------------------------------
-- Deliberate. Two competing suppliers must never see each other's
-- businesses. If a row is not yours and does not belong to you, you do not
-- get it. Adding a Supplier-to-Supplier branch later would break the
-- isolation that test 2 checks, so it needs a decision rather than a
-- quick edit.

-- -------------------------------------------------------------------
-- UPDATE
-- -------------------------------------------------------------------
-- A user may update their own profile, but ONLY these columns.
-- WITHOUT a column list, a user could change their own `role` to
-- 'super_admin' and take over the platform. This is the single most
-- dangerous hole in a profile-update policy.
drop policy if exists "profiles_update_own_safe_columns" on public.profiles;
create policy "profiles_update_own_safe_columns"
  on public.profiles
  for update
  to authenticated
  using (
    (select public.current_is_active())
    and (
      id = (select auth.uid())
      or (select public.is_super_admin())
    )
  )
  with check (
    -- WITH CHECK re-validates the row AFTER the update. Without it, someone
    -- could update a row they are allowed to touch and then rewrite the
    -- role inside the same statement.
    (
      -- Branch A: a normal user editing their own row.
      (
        id = (select auth.uid())
        -- They must not be able to change these two fields. If they could
        -- set their own role to 'super_admin', they would own the platform.
        and role = (select public.current_role())
        and supplier_id is not distinct from (select public.current_supplier_id())
      )
      -- Branch B: Super Admin is allowed to edit anyone's row, including
      -- role and is_active. This must be a separate branch, otherwise
      -- Branch A would block Super Admin from managing other accounts.
      or (select public.is_super_admin())
    )
  );

-- Only THREE columns are self-editable: full_name, phone and address.
-- Role, supplier_id, is_active and must_change_password are NOT here, and
-- must never be added without a matching decision in DECISIONS.md.
grant update (full_name, phone, address)
  on public.profiles
  to authenticated;

-- -------------------------------------------------------------------
-- INSERT
-- -------------------------------------------------------------------
-- Accounts are NOT created by inserting into profiles from the browser.
-- They are created by the create-user Edge Function, which runs with the
-- service role and bypasses RLS. So no INSERT policy exists on purpose.
-- If we added one here, anyone could invent their own account.

-- -------------------------------------------------------------------
-- DELETE
-- -------------------------------------------------------------------
-- No DELETE policy on purpose. The project rules say: never hard-delete a
-- user who has transactions. Deactivate instead. Without a policy, Postgres
-- refuses all deletes.

-- ===================================================================
-- Column-level protection, in one place
-- ===================================================================
-- The GRANT above lets a user change only full_name, phone and address.
-- A restricted-column UPDATE still needs a SELECT policy to evaluate, and
-- we have one above. Good.
--
-- The `role` and `is_active` columns can only be changed by Super Admin or
-- by the create-user / set_user_active Edge Functions.
--
-- Two independent gates are doing the work here, and both are needed:
--   GRANT   -- is this column writable at all by this database role?
--   POLICY  -- of the rows you may touch, is this new value acceptable?
-- Turning on one without the other is the most common way a profile app
-- leaks its own permission model.
-- ===================================================================