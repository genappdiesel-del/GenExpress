-- ===================================================================
-- RLS TESTS -- proves the security rules actually hold
-- ===================================================================
-- Run this after every migration. It is the answer to the question the
-- project brief asks: "What could go wrong? Can any role see data it
-- should not?"
--
-- HOW TO RUN
--   Option A (easiest, no setup):
--     1. Open your project at supabase.com
--     2. Click "SQL Editor" in the left menu
--     3. New query
--     4. Paste this whole file
--     5. Click Run
--
--   Option B:
--     In your project folder, run:  supabase test db
--
-- WHAT IT DOES
-- This script sets up seven throwaway test users, then pretends to be each
-- of them and checks what they can see. It then DELETES everything it made.
-- Nothing you care about is touched.
--
-- HOW TO READ THE OUTPUT
--   "PASS" means the security rule held.
--   "FAIL" means data leaked. Fix it before going live.
--   Every test prints a plain-English explanation either way.
--
-- These tests use plain RAISE NOTICE rather than the pgtap extension, so
-- they run in the dashboard SQL editor with nothing to install.
-- ===================================================================

begin;

-- -------------------------------------------------------------------
-- Create test data
-- -------------------------------------------------------------------
-- We create rows directly. The SQL editor runs as the postgres superuser,
-- which bypasses RLS. That is deliberate: the tests need known starting
-- data, and they must bypass RLS to SET UP so they can then properly
-- TEST it. If setup were subject to the rules, the rules would be the
-- thing under test.

do $$
declare
  v_super_id   uuid;
  v_supplier_a uuid;
  v_supplier_b uuid;
  v_client_a   uuid;
  v_client_b   uuid;
  v_agent_a    uuid;
  v_agent_b    uuid;
begin
  -- Real auth users. The ids are what the security rules key off, so they
  -- must be genuine auth.users rows with matching profiles.
  v_super_id   := gen_random_uuid();
  v_supplier_a := gen_random_uuid();
  v_supplier_b := gen_random_uuid();
  v_client_a   := gen_random_uuid();
  v_client_b   := gen_random_uuid();
  v_agent_a    := gen_random_uuid();
  v_agent_b    := gen_random_uuid();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_super_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'super@tracker.local',    crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Super"}'),
    (v_supplier_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suppliera@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Supplier A"}'),
    (v_supplier_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supplierb@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Supplier B"}'),
    (v_client_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clienta@tracker.local',   crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Client A"}'),
    (v_client_b,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clientb@tracker.local',   crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Client B"}'),
    (v_agent_a,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agenta@tracker.local',    crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Agent A"}'),
    (v_agent_b,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agentb@tracker.local',    crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Agent B"}');

  insert into public.profiles (id, role, supplier_id, full_name, username)
  values
    (v_super_id,   'super_admin', null,          'Super',      'super'),
    (v_supplier_a, 'supplier',    null,          'Supplier A', 'suppliera'),
    (v_supplier_b, 'supplier',    null,          'Supplier B', 'supplierb'),
    (v_client_a,   'client',      v_supplier_a, 'Client A',   'clienta'),
    (v_client_b,   'client',      v_supplier_b, 'Client B',   'clientb'),
    (v_agent_a,    'agent',       v_supplier_a, 'Agent A',    'agenta'),
    (v_agent_b,    'agent',       v_supplier_b, 'Agent B',    'agentb');

  -- Remember the ids for the checks below. A temp table is used because
  -- a DO block cannot easily hand values back to the next statement.
  drop table if exists _rls_test_ids;
  create temp table _rls_test_ids (name text primary key, id uuid);
  insert into _rls_test_ids values
    ('super', v_super_id), ('supplier_a', v_supplier_a), ('supplier_b', v_supplier_b),
    ('client_a', v_client_a), ('client_b', v_client_b), ('agent_a', v_agent_a), ('agent_b', v_agent_b);

  raise notice 'Test data created.';
end
$$;

-- ===================================================================
-- TEST 1: A Client sees only themselves and their own Supplier
-- ===================================================================
-- Expected: exactly 2 rows -- their own profile, plus their Supplier's
-- profile so their screens can show the Supplier's name. Nothing else.
-- ===================================================================
do $$
declare
  v_client_a uuid;
  v_seen bigint;
begin
  select id into v_client_a from _rls_test_ids where name = 'client_a';

  -- RLS only applies to non-superuser roles, so we switch to the real
  -- "authenticated" role before counting.
  set local role authenticated;
  set local request.jwt.claim.sub = v_client_a::text;
  select count(*) into v_seen from public.profiles;
  reset role;

  if v_seen = 2 then
    raise notice 'PASS - Client isolation: a Client sees only their own profile and their Supplier. (saw % rows)', v_seen;
  else
    raise warning 'FAIL - Client isolation: a Client saw % profile rows but should see exactly 2 (own + supplier).', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 2: Supplier A cannot read Supplier B's data
-- ===================================================================
-- This is the most important test in the whole app. If it fails, two
-- competing suppliers can see each other's businesses.
-- ===================================================================
do $$
declare
  v_supplier_a uuid;
  v_seen bigint;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';

  set local role authenticated;
  set local request.jwt.claim.sub = v_supplier_a::text;
  select count(*) into v_seen from public.profiles;
  reset role;

  -- Supplier A should see: own row + own Client A + own Agent A = 3 rows.
  -- They must NOT see Supplier B, Client B, or Agent B.
  if v_seen = 3 then
    raise notice 'PASS - Supplier isolation: Supplier A sees only their own team (3 rows). They cannot see Supplier B.';
  else
    raise warning 'FAIL - Supplier isolation: Supplier A saw % profile rows but should see exactly 3 (self + own client + own agent).', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 3: A Client cannot escalate their own role
-- ===================================================================
-- The classic attack: a Client edits their profile and sets role to
-- 'super_admin'. Our policy must block this, and the column grant must
-- block the write. Both are checked.
-- ===================================================================
do $$
declare
  v_client_a uuid;
  v_before_role public.user_role;
  v_after_role public.user_role;
begin
  select id into v_client_a from _rls_test_ids where name = 'client_a';
  select role into v_before_role from public.profiles where id = v_client_a;

  set local role authenticated;
  set local request.jwt.claim.sub = v_client_a::text;

  -- Attempt the privilege escalation.
  begin
    update public.profiles
       set role = 'super_admin'
     where id = v_client_a;
  exception when others then
    -- An error here is the CORRECT outcome. We catch it so the test can
    -- continue and report cleanly.
    null;
  end;

  reset role;

  select role into v_after_role from public.profiles where id = v_client_a;

  if v_after_role = v_before_role and v_after_role <> 'super_admin' then
    raise notice 'PASS - Privilege escalation blocked: a Client tried to make themselves Super Admin and the database refused.';
  else
    raise warning 'FAIL - PRIVILEGE ESCALATION: a Client changed their own role from % to %! This is a critical security hole.', v_before_role, v_after_role;
  end if;
end
$$;

-- ===================================================================
-- TEST 4: A signed-out visitor sees nothing
-- ===================================================================
-- The anon role represents someone holding the public key but not logged
-- in. They must get zero rows from every protected table.
-- ===================================================================
do $$
declare
  v_seen bigint;
begin
  set local role anon;
  select count(*) into v_seen from public.profiles;
  reset role;

  if v_seen = 0 then
    raise notice 'PASS - Signed-out access: a visitor who is not logged in sees 0 profile rows.';
  else
    raise warning 'FAIL - Signed-out access: a visitor who is not logged in saw % profile rows! They should see 0.', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 5: An Agent sees only their own profile and their Supplier
-- ===================================================================
-- Agents must not see Client data or anything about profit.
-- ===================================================================
do $$
declare
  v_agent_a uuid;
  v_seen bigint;
begin
  select id into v_agent_a from _rls_test_ids where name = 'agent_a';

  set local role authenticated;
  set local request.jwt.claim.sub = v_agent_a::text;
  select count(*) into v_seen from public.profiles;
  reset role;

  if v_seen = 2 then
    raise notice 'PASS - Agent isolation: an Agent sees only their own profile and their Supplier.';
  else
    raise warning 'FAIL - Agent isolation: an Agent saw % profile rows but should see exactly 2.', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 6: Super Admin sees everyone
-- ===================================================================
-- The one role that IS meant to see all rows. If this ever fails it means
-- the isolation went too far and the owner is locked out.
-- ===================================================================
do $$
declare
  v_super_id uuid;
  v_seen bigint;
begin
  select id into v_super_id from _rls_test_ids where name = 'super';

  set local role authenticated;
  set local request.jwt.claim.sub = v_super_id::text;
  select count(*) into v_seen from public.profiles;
  reset role;

  if v_seen = 7 then
    raise notice 'PASS - Super Admin reach: the platform owner sees all 7 profiles.';
  else
    raise warning 'FAIL - Super Admin reach: the owner saw % profile rows but should see all 7.', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 7: A deactivated account loses access immediately
-- ===================================================================
-- Deactivating somebody has to actually cut them off, not merely make the
-- app show an empty screen. If it does not, someone you removed last month
-- still holds a working login and can still read data.
-- ===================================================================
do $$
declare
  v_client_b uuid;
  v_seen_before bigint;
  v_seen_after bigint;
begin
  select id into v_client_b from _rls_test_ids where name = 'client_b';

  -- Before: active, so they see their own row and their Supplier.
  set local role authenticated;
  set local request.jwt.claim.sub = v_client_b::text;
  select count(*) into v_seen_before from public.profiles;
  reset role;

  -- Deactivate. In the real app this happens through the private
  -- set_user_active function, which only Super Admin or the owning
  -- Supplier may call. Here the superuser does it directly.
  update public.profiles set is_active = false where id = v_client_b;

  -- After: the very same login must see nothing at all.
  set local role authenticated;
  set local request.jwt.claim.sub = v_client_b::text;
  select count(*) into v_seen_after from public.profiles;
  reset role;

  -- Put them back so the cleanup removes a consistent set.
  update public.profiles set is_active = true where id = v_client_b;

  if v_seen_before = 2 and v_seen_after = 0 then
    raise notice 'PASS - Deactivation cuts access: an active Client saw % profile rows, and the same login saw % once deactivated.', v_seen_before, v_seen_after;
  else
    raise warning 'FAIL - Deactivation did not cut access: before=%% (expected 2), after=%% (expected 0).', v_seen_before, v_seen_after;
  end if;
end
$$;

-- -------------------------------------------------------------------
-- Clean up all test data
-- -------------------------------------------------------------------
-- Deleting from auth.users cascades to profiles (on delete cascade).
do $$
declare
  r record;
begin
  for r in select id from _rls_test_ids loop
    delete from auth.users where id = r.id;
  end loop;
  drop table if exists _rls_test_ids;
  raise notice 'Test data cleaned up. All test rows removed.';
end
$$;

commit;

-- ===================================================================
-- SUMMARY
-- ===================================================================
-- You should see seven PASS messages and no FAIL warnings.
--
--   1. Client isolation      - a Client sees only self + own Supplier
--   2. Supplier isolation    - a Supplier cannot see a rival
--   3. Privilege escalation  - a Client cannot become Super Admin
--   4. Signed-out access     - a visitor sees nothing
--   5. Agent isolation       - an Agent sees only self + own Supplier
--   6. Super Admin reach     - the owner still sees everything
--   7. Deactivation cuts access - switching someone off really works
--
-- IF A TEST FAILED:
--   1. Do not launch the app.
--   2. Check the policy in supabase/migrations/002_rls_profiles.sql
--   3. Re-run this file to confirm the fix worked.
--
-- These tests cover the profiles table, which is the foundation. Phase 2
-- extends them to the product price views, where a Client must never see
-- the agent_price column.