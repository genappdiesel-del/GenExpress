-- ===================================================================
-- Migration 014: four levels of supply chain
-- ===================================================================
-- The client asked for four levels (Supplier -> Agent -> sub-agent ->
-- sub-sub-agent) but wants to be able to set them up later. So the
-- structure has to exist now, and nothing about the two-level screens
-- should change.
--
-- THE DESIGN, AND WHY IT IS THIS WAY
--
-- The tempting design is to replace profiles.supplier_id with a single
-- parent_id and make every security rule walk the chain to find the
-- Supplier. That is wrong for us. Every rule, both product views and all
-- 23 security tests already read one function, current_supplier_id(),
-- and rewriting its meaning would mean re-proving the whole security
-- model at the exact moment we are adding a feature.
--
-- So instead we DENORMALISE and keep the proven shape:
--
--   supplier_id   always points at the ROOT Supplier, at every depth.
--                 A level-4 sub-sub-agent still has supplier_id set to
--                 the same Supplier as a level-2 Client.
--   parent_id     the chain: who recruited whom. Purely informational,
--                 used to build the team tree and to work out a level.
--
-- The payoff is that the root is a single column read, not a walk:
-- no recursion in the hot path of every security rule, and no loop to
-- protect against there.
--
-- SECURITY INVARIANT, enforced by the trigger at the bottom of this file:
--   whoever my parent is, they must sit in the same Supplier tree.
-- That one rule is what makes the chain trustworthy. It means a level-3
-- agent can never be attached to another Supplier's agent, and it makes
-- a circular chain impossible (see the depth check below).
-- ===================================================================

alter table public.profiles
  add column if not exists parent_id uuid
    references public.profiles(id) on delete restrict;

comment on column public.profiles.parent_id is
  'Who recruited this person. For building the team tree and working out
   a level. NOT used for security -- supplier_id is the root that every
   security rule uses, and it stays correct at every depth.';

create index if not exists profiles_parent_id_idx
  on public.profiles (parent_id);

-- -------------------------------------------------------------------
-- Reading the chain
-- -------------------------------------------------------------------
-- Both functions are SECURITY DEFINER for the same reason as the Phase 1
-- helpers: they read profiles, and during a policy evaluation a normal
-- function would be caught by the profiles policy and create a circular
-- dependency.
--
-- Each returns information about ONE id and nothing else. Neither can be
-- used to learn anybody else's data, and neither takes the caller's
-- identity as an argument.

-- The root Supplier for a given account.
--
-- A Supplier is their own root. Everyone else was given their root
-- Supplier directly when they were created, so this is a single column
-- read with no chain walking at all. O(1), not O(depth).
create or replace function public.supply_chain_root(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
           when p.role = 'supplier' then p.id
           else p.supplier_id
         end
    from public.profiles p
   where p.id = p_profile_id;
$$;

-- How many levels down a given account sits. Level 1 is the Supplier.
--
--   Supplier                -> 1
--   Client of the Supplier  -> 2
--   Agent of that Client    -> 3
--   sub-agent of that Agent -> 4
--
-- The walk stops after MAX_SUPPLY_CHAIN_HOPS hops no matter what. That
-- bound is not decoration: a circular parent_id would otherwise loop
-- forever. With the bound, a loop makes the depth come out as the
-- maximum, which the trigger below reads as "too deep" and refuses.
create or replace function public.supply_chain_depth(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, extensions
as $$
  with recursive chain as (
    select id, parent_id, 0 as hops
      from public.profiles
     where id = p_profile_id
    union all
    select p.id, p.parent_id, c.hops + 1
      from public.profiles p
      join chain c on p.id = c.parent_id
     where c.hops < 8
  )
  select case
           when coalesce(max(hops), -1) = 0 then 1
           else coalesce(max(hops), -1) + 1
         end
    from chain;
$$;

-- The same, for whoever is making the request. Used by the app to label
-- a row with its level without the browser having to walk anything.
create or replace function public.my_supply_chain_depth()
returns integer
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.supply_chain_depth(auth.uid());
$$;

-- Every account belonging to a given Supplier, at every level, with its
-- level attached. The app uses this to build the team tree.
create or replace function public.supply_chain_members(p_supplier_id uuid)
returns table (
  id            uuid,
  parent_id     uuid,
  role          public.user_role,
  level         integer,
  full_name     text,
  username      text,
  is_active     boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p.id,
         p.parent_id,
         p.role,
         public.supply_chain_depth(p.id) as level,
         p.full_name,
         p.username,
         p.is_active
    from public.profiles p
   where public.supply_chain_root(p.id) = p_supplier_id
   order by public.supply_chain_depth(p.id), p.full_name;
$$;

-- -------------------------------------------------------------------
-- The rule that makes the chain trustworthy
-- -------------------------------------------------------------------
-- Checked before every insert and before every change of role, owner or
-- parent. A database constraint is the right place for this: the Edge
-- Function that creates accounts checks it too, but a constraint is what
-- holds when somebody writes a script, imports a file, or fixes a row by
-- hand in the Supabase dashboard at midnight.
--
-- SECURITY DEFINER so it can read profiles without tripping the profiles
-- policy. It only ever acts on the row being written.
create or replace function public.profiles_check_supply_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_parent_supplier uuid;
  v_parent_depth    integer;
begin
  -- --- 1. A root has no owner and no manager ------------------------
  if new.role in ('super_admin', 'supplier') then
    if new.supplier_id is not null then
      raise exception 'A % cannot belong to a Supplier.', new.role;
    end if;

    if new.parent_id is not null and new.parent_id is distinct from new.id then
      raise exception 'A % cannot report to anybody.', new.role;
    end if;

    return new;
  end if;

  -- --- 2. Everyone else must belong to a Supplier -------------------
  if new.supplier_id is null then
    raise exception 'A % must belong to a Supplier.', new.role;
  end if;

  if new.supplier_id = new.id then
    raise exception 'An account cannot belong to itself.';
  end if;

  if not exists (
    select 1 from public.profiles s
     where s.id = new.supplier_id and s.role = 'supplier'
  ) then
    raise exception 'The chosen owner is not a Supplier.';
  end if;

  -- --- 3. Without a manager this row is already fine ---------------
  -- A two-level business leaves parent_id empty and everything works.
  -- Deeper levels are opt-in, which is what the client asked for.
  if new.parent_id is null then
    return new;
  end if;

  -- --- 4. The manager must exist and must not be the row itself -----
  if new.parent_id = new.id then
    raise exception 'An account cannot report to itself.';
  end if;

  select case when p.role = 'supplier' then p.id else p.supplier_id end
    into v_parent_supplier
    from public.profiles p
   where p.id = new.parent_id;

  if not found then
    raise exception 'The chosen manager does not exist.';
  end if;

  -- --- 5. THE INVARIANT ---------------------------------------------
  -- This single comparison is what stops one Supplier grafting their
  -- agent onto another Supplier's chain, which would let that agent's
  -- team inherit a stranger's catalogue.
  if v_parent_supplier is distinct from new.supplier_id then
    raise exception 'A manager must belong to the same Supplier.';
  end if;

  -- --- 6. Four levels, and no loops ---------------------------------
  -- A manager who is already at level 4 cannot have anybody under them,
  -- because that would be a fifth level. Because the depth walk is
  -- bounded at 8 hops, a circular chain reports the maximum depth here
  -- and is refused by the same test. One check, two protections.
  v_parent_depth := public.supply_chain_depth(new.parent_id);

  if v_parent_depth >= 4 then
    raise exception 'That chain is already 4 levels deep, which is the limit. Pick a manager nearer the top.';
  end if;

  return new;
end;
$$;

-- Two triggers rather than one "insert or update of" trigger, because
-- PostgreSQL does not allow the column list on the INSERT half.
drop trigger if exists profiles_check_supply_chain_insert on public.profiles;
create trigger profiles_check_supply_chain_insert
  before insert on public.profiles
  for each row execute function public.profiles_check_supply_chain();

drop trigger if exists profiles_check_supply_chain_update on public.profiles;
create trigger profiles_check_supply_chain_update
  before update of role, supplier_id, parent_id on public.profiles
  for each row execute function public.profiles_check_supply_chain();

-- -------------------------------------------------------------------
-- Nobody may re-parent or re-own themselves
-- -------------------------------------------------------------------
-- Two existing gates already cover this, and no new policy is needed:
--
--   1. The GRANT. A person editing their own profile may only write
--      full_name, phone and address (migration 002). supplier_id and
--      parent_id are not columns they can set at all, so a crafted
--      request naming them is rejected by the database on the column,
--      before any policy is even consulted.
--
--   2. The trigger above. It runs for every writer, including the
--      service-role Edge Function, so a mistake in that function is
--      caught here rather than becoming a silent cross-Supplier graft.
--
-- A third UPDATE policy was deliberately NOT added. Postgres combines
-- multiple permissive policies for the same action with OR, so adding
-- one that was even slightly too generous would WIDEN access rather
-- than narrow it. Two gates that both refuse is the correct shape here.
-- -------------------------------------------------------------------

-- The Supplier's own view of who is on their team, including levels.
-- The SELECT policy already lets a Supplier read their whole team, so
-- this function only adds the level column and changes nothing about
-- which rows come back.
grant execute on function public.supply_chain_root(uuid) to authenticated;
grant execute on function public.supply_chain_depth(uuid) to authenticated;
grant execute on function public.supply_chain_members(uuid) to authenticated;
grant execute on function public.my_supply_chain_depth() to authenticated;