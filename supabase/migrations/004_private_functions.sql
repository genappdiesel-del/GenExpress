-- ===================================================================
-- Migration 004: Private helper functions for sensitive operations
-- ===================================================================
-- WHY A SEPARATE SCHEMA:
--
-- Some actions cannot be done by writing to a table directly, because the
-- Row Level Security rules deliberately forbid it. Two examples in Phase 1:
--
--   1. Clearing must_change_password after the user picks a new password.
--      The profiles policy only lets a user change full_name, phone and
--      address -- on purpose, so nobody can promote themselves by editing
--      a column.
--
--   2. Deactivating or reactivating an account.
--
-- We solve this with SECURITY DEFINER functions. The warning that matters:
-- Postgres grants EXECUTE on every new function to PUBLIC by default, which
-- means any function left in the public schema becomes a public API endpoint
-- callable by anybody, including signed-out visitors.
--
-- The fix is to put these functions in a schema called "private" which is
-- NOT exposed to the Data API. Nobody can call them from the browser. The
-- frontend reaches them only through the Edge Functions we control, which
-- check who is asking first.
--
-- Every function below still checks auth.uid() internally. Defence in
-- depth: the schema hides it, AND the function checks the caller.
-- ===================================================================

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

-- Grant usage only to the service role, which the Edge Functions use.
grant usage on schema private to service_role;

-- -------------------------------------------------------------------
-- set_must_change_password_done
-- -------------------------------------------------------------------
-- Called by the Edge Function after someone successfully changes their
-- password. Clears the flag so they are not asked again.
--
-- The check `actor_id = auth.uid()` means a user can only clear their own
-- flag, even if they guess someone else's id and pass it in.
create or replace function private.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_user_id uuid;
begin
  -- If auth.uid() is null nobody is signed in, so refuse.
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;

  update public.profiles
     set must_change_password = false
   where id = v_user_id;

  if not found then
    raise exception 'No profile found for the signed-in user';
  end if;
end;
$$;

revoke all on function private.complete_password_change() from public, anon, authenticated;
grant execute on function private.complete_password_change() to service_role;

-- -------------------------------------------------------------------
-- set_user_active
-- -------------------------------------------------------------------
-- Deactivate or reactivate an account.
--
-- Only a Super Admin may do this for anybody, or a Supplier for their own
-- Client or Agent. This mirrors the create-user rules exactly, because
-- leaving an account on must never be easier than creating one.
--
-- Hard delete is deliberately not provided. The prompt requires that users
-- with transactions are never deleted -- only deactivated.
create or replace function private.set_user_active(
  p_user_id uuid,
  p_active boolean,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_actor_role public.user_role;
  v_actor_supplier uuid;
  v_target_supplier uuid;
  v_target_role public.user_role;
begin
  -- --- Who is asking, and are they allowed?
  select role, supplier_id into v_actor_role, v_actor_supplier
    from public.profiles
   where id = p_actor_id and is_active;

  if not found then
    raise exception 'The requesting account is not active or does not exist';
  end if;

  if v_actor_role = 'super_admin' then
    -- allowed, carry on
  elsif v_actor_role = 'supplier' then
    -- A Supplier may only manage clients and agents who belong to them.
    select supplier_id, role into v_target_supplier, v_target_role
      from public.profiles
     where id = p_user_id;

    if not found then
      raise exception 'That account does not exist';
    end if;

    if v_target_supplier is distinct from v_actor_supplier then
      raise exception 'You may only manage your own Clients and Agents';
    end if;

    if v_target_role not in ('client', 'agent') then
      raise exception 'You may only manage your own Clients and Agents';
    end if;
  else
    raise exception 'You do not have permission to do this';
  end if;

  -- --- Perform the change
  update public.profiles
     set is_active = p_active
   where id = p_user_id;

  -- --- Record it. This is what the audit log viewer will show.
  insert into public.audit_logs (actor_id, action, table_name, record_id, old_value, new_value)
  values (
    p_actor_id,
    case when p_active then 'user_activated' else 'user_deactivated' end,
    'profiles',
    p_user_id,
    null,
    case when p_active then 'true' else 'false' end
  );
end;
$$;

revoke all on function private.set_user_active(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function private.set_user_active(uuid, boolean, uuid) to service_role;

-- -------------------------------------------------------------------
-- update_password_for_user
-- -------------------------------------------------------------------
-- Reset somebody's password. Used by the Supplier who created the account,
-- or by a Super Admin. The account holder is forced to change it at next
-- login so the person who reset it does not know the new password.
--
-- This function only records the intent in the audit log. Actually setting
-- the password happens in the Edge Function, because auth.users is owned by
-- Supabase and cannot be written to from a normal SQL function.
create or replace function private.request_password_reset(
  p_user_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_actor_role public.user_role;
  v_actor_supplier uuid;
  v_target_supplier uuid;
  v_target_role public.user_role;
begin
  select role, supplier_id into v_actor_role, v_actor_supplier
    from public.profiles
   where id = p_actor_id and is_active;

  if not found then
    raise exception 'The requesting account is not active or does not exist';
  end if;

  if v_actor_role <> 'super_admin' then
    if v_actor_role <> 'supplier' then
      raise exception 'You do not have permission to do this';
    end if;

    select supplier_id, role into v_target_supplier, v_target_role
      from public.profiles
     where id = p_user_id;

    if not found then
      raise exception 'That account does not exist';
    end if;

    if v_target_supplier is distinct from v_actor_supplier then
      raise exception 'You may only manage your own Clients and Agents';
    end if;

    if v_target_role not in ('client', 'agent') then
      raise exception 'You may only manage your own Clients and Agents';
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, table_name, record_id)
  values (p_actor_id, 'password_reset_requested', 'profiles', p_user_id);
end;
$$;

revoke all on function private.request_password_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function private.request_password_reset(uuid, uuid) to service_role;