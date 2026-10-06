-- ===================================================================
-- 013: public wrappers for the private functions
-- ===================================================================
-- The problem this solves
-- ---------------------
-- Migration 004 put the sensitive operations in the `private` schema
-- and granted them to `service_role` only:
--
--     private.set_user_active()
--     private.complete_password_change()
--     private.request_password_reset()
--
-- That was right for Phase 1, when the only way to reach them was an
-- Edge Function holding the service key. But it left the Super Admin
-- unable to deactivate an account from inside the app -- the only way
-- was a server function that does not exist yet.
--
-- Why we do NOT just grant the private function to `authenticated`
-- ------------------------------------------------------------------
-- Because `private.set_user_active` takes p_actor_id as a PARAMETER. If
-- the browser could call it directly, any signed-in person could pass
-- their own id and act as a Super Admin, or pass somebody else's id and
-- frame them for the change. The function trusts that argument, which is
-- only safe when the caller is the server.
--
-- The wrapper below fixes that without moving the function out of
-- `private`. It supplies p_actor_id from auth.uid() -- a value the
-- browser cannot choose -- and nothing else. Every permission check
-- stays inside the private function, where it cannot be granted away.
--
-- Why SECURITY INVOKER, not SECURITY DEFINER
-- -----------------------------------------
-- A SECURITY DEFINER wrapper would run as its owner and would then have
-- to do its own ownership checking, which means duplicating the rules
-- that already exist in one careful place.
--
-- Running as INVOKER keeps it honest: the wrapper has no privileges of
-- its own, and it can only succeed insofar as the caller is already
-- allowed to call the function inside. The rules stay in one place.
-- ===================================================================

begin;

-- -------------------------------------------------------------------
-- Deactivate or reactivate an account
-- -------------------------------------------------------------------
-- Thin by design. It does no checking of its own. If it checked
-- something, there would be two places where the rule lives, and they
-- would eventually disagree -- and the disagreement would be a security
-- hole in whichever one nobody was reading.

create or replace function public.set_user_active(
  p_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public, private, extensions
as $$
begin
  -- auth.uid() is the signed-in person's own id, read from their token
  -- by the database. The caller cannot supply it and cannot alter it.
  --
  -- If nobody is signed in, auth.uid() is null, and the private function
  -- refuses because it finds no active profile for that id. No separate
  -- check is needed here, and adding one would only risk disagreeing
  -- with the private function about when to refuse.
  perform private.set_user_active(p_user_id, p_is_active, auth.uid());
end;
$$;

comment on function public.set_user_active(uuid, boolean) is
  'Switch an account on or off. Never deletes. The caller is taken from '
  'auth.uid(), never from an argument, so nobody can act as somebody '
  'else. Rules live in private.set_user_active.';

-- Grant to every signed-in user on purpose.
--
-- This is not "letting anybody do it". Inside private.set_user_active,
-- the actor's role is read from the database and a Client or Agent is
-- refused outright. A Supplier may only manage their own Clients and
-- Agents, checked by comparing supplier ids. Only a Super Admin may
-- manage anybody.
--
-- The grant here is only the outer gate: "you may ask". The inner gate,
-- "of the accounts you named, which ones you may touch", is in the
-- private function. Granting execute here does not skip it.
grant execute on function public.set_user_active(uuid, boolean)
  to authenticated;
revoke all on function public.set_user_active(uuid, boolean)
  from public, anon;

-- -------------------------------------------------------------------
-- Reset somebody's password
-- -------------------------------------------------------------------
-- The Super Admin forgets a Client's password and has to hand them a new
-- one. Same shape as above: the browser may ask, but the private
-- function decides whether this particular actor may do this particular
-- thing.

create or replace function public.request_password_reset(
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public, private, extensions
as $$
begin
  perform private.request_password_reset(p_user_id, auth.uid());
end;
$$;

comment on function public.request_password_reset(uuid) is
  'Ask for an account password to be reset. The caller comes from '
  'auth.uid(), so nobody can reset somebody else''s password by '
  'claiming to be them. Rules live in private.request_password_reset.';

grant execute on function public.request_password_reset(uuid)
  to authenticated;
revoke all on function public.request_password_reset(uuid)
  from public, anon;

-- -------------------------------------------------------------------
-- Tripwire: the wrappers must not have become a way around the rules
-- -------------------------------------------------------------------
-- Migration 004 granted the private functions to service_role ONLY. If
-- somebody later "fixes" a permission problem by granting those directly
-- to authenticated, the actor id becomes caller-controlled and every
-- check inside them is bypassed. That is the single most damaging change
-- anyone could make to this file's security, so it is worth a test.
--
-- Called by supabase/tests/rls_tests.sql, never by the application.

create or replace function public.assert_private_functions_stay_private()
returns void
language plpgsql
as $$
declare
  leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
  into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in (
      'set_user_active',
      'complete_password_change',
      'request_password_reset'
    )
    and exists (
      select 1
      from pg_roles r
      where r.oid = p.proowner
        -- Only these two may hold execute on a private function.
        and r.rolname not in ('postgres', 'service_role', 'supabase_admin')
    )
    and has_function_privilege(
      'authenticated',
      p.oid,
      'EXECUTE'
    );

  if leaked is not null then
    raise exception
      'private functions are executable by authenticated: %. '
      'Revoke them; callers must go through the public wrapper.', leaked;
  end if;
end;
$$;

comment on function public.assert_private_functions_stay_private() is
  'Test tripwire. Fails if the browser is ever given direct execute on a '
  'private function, which would let a caller choose their own actor id.';

revoke all on function public.assert_private_functions_stay_private()
  from public, anon, authenticated;

commit;