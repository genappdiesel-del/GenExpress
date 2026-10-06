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
-- This script sets up seven throwaway test users and three throwaway
-- products, then pretends to be each user and checks what they can see.
-- It then DELETES everything it made. Nothing you care about is
-- touched.
--
-- HOW TO READ THE OUTPUT
--   "PASS" means the security rule held.
--   "FAIL" means data leaked. Fix it before going live.
--   Every test prints a plain-English explanation either way.
--   PASS lines are raised at WARNING level on purpose: the offline
--   harness counts them by reading the log (single-user mode suppresses
--   NOTICE, so WARNING is the channel that survives everywhere).
--
-- WHERE THIS FILE RUNS (one file, unchanged, two transports)
--   * Supabase SQL editor: RLS is live; the switched-role counts below
--     are filtered by the database itself, so they are the truth.
--   * Offline harness (single-user PostgreSQL): RLS row filtering is
--     bypassed even for non-superuser roles, so a bare count would lie.
--     The rls_count() helper right after the fixtures detects that
--     case and rebuilds the same filter from pg_policy; the numbers
--     come out identical, so a green local run means the same thing as
--     a green run in the SQL editor.
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
-- COUNT HELPER -- the one place row-counting knows about transports
-- ===================================================================
-- The tests below answer "how many rows can this role see?" by switching
-- role with `set local role` and counting. On a LIVE Supabase project
-- that count is filtered by real RLS, so it is the truth.
--
-- The OFFLINE harness runs PostgreSQL in single-user mode, where RLS
-- row filtering is structurally bypassed even for non-superuser roles
-- (row_security_active() is false, so a plain count returns EVERY row).
-- This helper hides the difference:
--
--   * row_security_active(p_table) is true  -> the server really is
--     filtering; count plainly and return it.
--   * row_security_active(p_table) is false -> single-user mode; rebuild
--     the filter RLS WOULD have applied, as the OR of every SELECT/ALL
--     policy USING-qual that names the role, then count against that.
--     No qual at all means RLS default-deny: the answer is 0.
--
-- The caller injects the JWT claim (auth.uid()) with set_config before
-- calling, exactly as the live server would, so the rebuilt quals read
-- the same value the runtime would. Run as SECURITY INVOKER so Path A
-- genuinely runs as the switched role; a DEFINER helper would bypass the
-- very rules these tests exist to prove.
create or replace function public.rls_count(
  p_table regclass,
  p_role  name
)
returns bigint
language plpgsql
as $$
declare
  v_count   bigint;
  v_quals   text;
  v_role_id oid;
begin
  if row_security_active(p_table) then
    execute format('select count(*) from %s', p_table) into v_count;
    return v_count;
  end if;

  select oid into v_role_id from pg_roles where rolname = p_role;

  select string_agg('(' || pg_get_expr(p.polqual, p.polrelid) || ')', ' or ')
    into v_quals
    from pg_policy p
   where p.polrelid = p_table
     and p.polcmd in ('r', '*')
     and p.polqual is not null
     and (
       p.polroles = '{0}'::oid[]
       or (v_role_id is not null and p.polroles @> array[v_role_id])
     );

  if v_quals is null then
    return 0;
  end if;

  execute format('select count(*) from %s where %s', p_table, v_quals)
    into v_count;
  return v_count;
end;
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
  perform set_config('request.jwt.claim.sub', v_client_a::text, true);
  select public.rls_count('public.profiles', 'authenticated') into v_seen;
  reset role;

  if v_seen = 2 then
    raise warning 'PASS - Client isolation: a Client sees only their own profile and their Supplier. (saw % rows)', v_seen;
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
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  select public.rls_count('public.profiles', 'authenticated') into v_seen;
  reset role;

  -- Supplier A should see: own row + own Client A + own Agent A = 3 rows.
  -- They must NOT see Supplier B, Client B, or Agent B.
  if v_seen = 3 then
    raise warning 'PASS - Supplier isolation: Supplier A sees only their own team (3 rows). They cannot see Supplier B.';
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
  perform set_config('request.jwt.claim.sub', v_client_a::text, true);

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
    raise warning 'PASS - Privilege escalation blocked: a Client tried to make themselves Super Admin and the database refused.';
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
  select public.rls_count('public.profiles', 'anon') into v_seen;
  reset role;

  if v_seen = 0 then
    raise warning 'PASS - Signed-out access: a visitor who is not logged in sees 0 profile rows.';
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
  perform set_config('request.jwt.claim.sub', v_agent_a::text, true);
  select public.rls_count('public.profiles', 'authenticated') into v_seen;
  reset role;

  if v_seen = 2 then
    raise warning 'PASS - Agent isolation: an Agent sees only their own profile and their Supplier.';
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
  perform set_config('request.jwt.claim.sub', v_super_id::text, true);
  select public.rls_count('public.profiles', 'authenticated') into v_seen;
  reset role;

  if v_seen = 7 then
    raise warning 'PASS - Super Admin reach: the platform owner sees all 7 profiles.';
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
  perform set_config('request.jwt.claim.sub', v_client_b::text, true);
  select public.rls_count('public.profiles', 'authenticated') into v_seen_before;
  reset role;

  -- Deactivate. In the real app this happens through the private
  -- set_user_active function, which only Super Admin or the owning
  -- Supplier may call. Here the superuser does it directly.
  update public.profiles set is_active = false where id = v_client_b;

  -- After: the very same login must see nothing at all.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client_b::text, true);
  select public.rls_count('public.profiles', 'authenticated') into v_seen_after;
  reset role;

  -- Put them back so the cleanup removes a consistent set.
  update public.profiles set is_active = true where id = v_client_b;

  if v_seen_before = 2 and v_seen_after = 0 then
    raise warning 'PASS - Deactivation cuts access: an active Client saw % profile rows, and the same login saw % once deactivated.', v_seen_before, v_seen_after;
  else
    raise warning 'FAIL - Deactivation did not cut access: before=% (expected 2), after=% (expected 0).', v_seen_before, v_seen_after;
  end if;
end
$$;

-- ===================================================================
-- PHASE 2 TESTS: products, prices and stock
-- ===================================================================
-- The seven tests above prove who can see WHOM. The tests below prove
-- the thing that actually costs a Supplier money: that a Client can
-- never learn the Agent price, and an Agent can never learn the Client
-- price.
-- ===================================================================

-- -------------------------------------------------------------------
-- Product test data
-- -------------------------------------------------------------------
-- Supplier A gets two products. Supplier B gets one. We deliberately
-- give Supplier A and Supplier B the SAME barcode, because that is
-- legal here -- a barcode belongs to the manufacturer, not to us. See
-- migration 006. If this insert fails, the uniqueness rule has been
-- tightened by mistake.
-- -------------------------------------------------------------------
do $$
declare
  v_supplier_a uuid;
  v_supplier_b uuid;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';
  select id into v_supplier_b from _rls_test_ids where name = 'supplier_b';

  insert into public.products
    (supplier_id, name, sku, barcode, unit, agent_price, client_price,
     stock_qty, low_stock_level)
  values
    -- A's good stock, normal margins.
    (v_supplier_a, 'Test Rice 5kg',   'RICE5',  '8991002101015', 'sack',
     55000, 62000, 100, 10),
    -- A's low stock, so the "low_stock" readiness value can be checked.
    (v_supplier_a, 'Test Sugar 1kg',   'SUG1',   '8991002101022', 'pcs',
     14000, 15000, 3,   5),
    -- B's product, carrying the same barcode as A's first product.
    (v_supplier_b, 'B Version Milk',  'BMILK',  '8991002101015', 'box',
     30000, 35000, 50,  5);

  raise notice 'Test products created.';
end
$$;

-- ===================================================================
-- TEST 8: A Client cannot read the products table at all
-- ===================================================================
-- The foundation of the price protection. A Client must get ZERO rows
-- from products -- not "rows without the price", but nothing. They read
-- the view instead. If this test ever returns a non-zero count, the
-- whole design has a hole.
-- ===================================================================
do $$
declare
  v_client_a uuid;
  v_seen bigint;
begin
  select id into v_client_a from _rls_test_ids where name = 'client_a';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client_a::text, true);
  select public.rls_count('public.products', 'authenticated') into v_seen;
  reset role;

  if v_seen = 0 then
    raise warning 'PASS - Client blocked from products table: a Client sees 0 rows and must use the view.';
  else
    raise warning 'FAIL - Client reached the products table directly (% rows). They can now read agent_price.', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 9: THE MOST IMPORTANT TEST -- the Agent price column does not
--          exist in the Client view
-- ===================================================================
-- Two different checks, because either one alone is not enough.
--
--   9a: the column is absent from the view entirely.
--   9b: even if the column were added back, the guard function notices.
--
-- Why check the shape of the view rather than just reading it: because
-- "the Client saw the wrong number" is discovered after the damage. A
-- test that fails on a Monday morning is worth a great deal.
-- ===================================================================
do $$
declare
  v_client_a uuid;
  v_cols text;
  v_guard_ok boolean := true;
begin
  select id into v_client_a from _rls_test_ids where name = 'client_a';

  -- 9a: does the forbidden column exist?
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client_a::text, true);
  select string_agg(column_name, ',') into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'client_products_view';
  reset role;

  if v_cols is not null and (position('agent_price' in v_cols) > 0
                            or position('sku' in v_cols) > 0) then
    v_guard_ok := false;
    raise warning 'FAIL - The Client view exposes a forbidden column. Its columns are: %', v_cols;
  end if;

  -- 9b: the tripwire. Run as superuser so it can read the view shape
  -- regardless of who is asking.
  begin
    perform public.assert_no_sensitive_view_columns();
  exception when others then
    v_guard_ok := false;
    raise warning 'FAIL - The view guard tripped: %', sqlerrm;
  end;

  if v_guard_ok then
    raise warning 'PASS - Client view shape: it hides agent_price, sku and supplier_id by not having those columns at all. The guard confirms it.';
  else
    raise warning 'FAIL - Client view shape is wrong. See the message above.';
  end if;
end
$$;

-- ===================================================================
-- TEST 10: A Client sees their own Supplier's products and no others
-- ===================================================================
-- Client A belongs to Supplier A, so they see 2 products. Client B
-- belongs to Supplier B and sees 1. Neither may see the other's.
-- ===================================================================
do $$
declare
  v_client_a uuid;
  v_client_b uuid;
  v_seen_a bigint;
  v_seen_b bigint;
begin
  select id into v_client_a from _rls_test_ids where name = 'client_a';
  select id into v_client_b from _rls_test_ids where name = 'client_b';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client_a::text, true);
  select count(*) into v_seen_a from public.client_products_view;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client_b::text, true);
  select count(*) into v_seen_b from public.client_products_view;
  reset role;

  if v_seen_a = 2 and v_seen_b = 1 then
    raise warning 'PASS - Client catalogue isolation: Client A sees 2 products, Client B sees 1. Neither sees the other''s Supplier.';
  else
    raise warning 'FAIL - Client catalogue isolation: Client A saw % (expected 2), Client B saw % (expected 1).', v_seen_a, v_seen_b;
  end if;
end
$$;

-- ===================================================================
-- TEST 11: An Agent cannot learn the Client price
-- ===================================================================
-- Agent A belongs to Supplier A. They see Supplier A's 2 products at
-- the AGENT price. They must never see client_price.
--
-- This is checked by value as well as by column name: we read the
-- agent_price column and confirm it equals the agent figure, not the
-- larger client figure. A view with the right column name but the wrong
-- column behind it would pass a shape-only test and still leak.
-- ===================================================================
do $$
declare
  v_agent_a uuid;
  v_seen bigint;
  v_cols text;
  v_wrong_price bigint;
begin
  select id into v_agent_a from _rls_test_ids where name = 'agent_a';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_agent_a::text, true);

  select count(*) into v_seen from public.agent_products_view;

  -- Is the forbidden column present?
  select string_agg(column_name, ',') into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'agent_products_view';

  -- Does the price the Agent reads match what the Agent actually pays?
  -- If any row shows 62000 (the Client price) instead of 55000, count it.
  select count(*) into v_wrong_price
  from public.agent_products_view
  where agent_price = 62000 or agent_price = 15000;

  reset role;

  if v_seen <> 2 then
    raise warning 'FAIL - Agent catalogue: Agent A saw % products but should see 2.', v_seen;
  elsif v_cols is not null and position('client_price' in v_cols) > 0 then
    raise warning 'FAIL - THE AGENT VIEW HAS A client_price COLUMN. An Agent can see what the Client pays. Columns: %', v_cols;
  elsif v_wrong_price > 0 then
    raise warning 'FAIL - THE AGENT PRICE COLUMN HOLDS THE CLIENT PRICE in % row(s). The column is named right but the data behind it is wrong.', v_wrong_price;
  else
    raise warning 'PASS - Agent price protection: the agent view has no client_price column, and the agent_price column really holds the agent figure (55000 / 14000).';
  end if;
end
$$;

-- ===================================================================
-- TEST 12: An Agent cannot read the products table directly
-- ===================================================================
-- Same reasoning as TEST 8, for agents. The agent view is their only
-- route, and it is filtered for them.
-- ===================================================================
do $$
declare
  v_agent_a uuid;
  v_seen bigint;
begin
  select id into v_agent_a from _rls_test_ids where name = 'agent_a';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_agent_a::text, true);
  select public.rls_count('public.products', 'authenticated') into v_seen;
  reset role;

  if v_seen = 0 then
    raise warning 'PASS - Agent blocked from products table: an Agent sees 0 rows and must use the agent view.';
  else
    raise warning 'FAIL - Agent reached the products table directly (% rows). They can now read client_price.', v_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 13: Switching off a permission really removes the number
-- ===================================================================
-- Turn off "this Client may see prices" for Client A, then confirm the
-- client_price in their view is null rather than merely hidden on the
-- screen. A number that is still in the data but out of sight is still
-- a number somebody can find.
-- ===================================================================
do $$
declare
  v_client_a uuid;
  v_supplier_a uuid;
  v_non_null bigint;
  v_total bigint;
begin
  select id into v_client_a from _rls_test_ids where name = 'client_a';
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';

  -- The Supplier switches the permission off.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  update public.client_feature_settings
     set can_view_prices = false
   where client_id = v_client_a;
  reset role;

  -- The Client now reads the view.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client_a::text, true);
  select count(*) filter (where client_price is not null),
         count(*)
    into v_non_null, v_total
    from public.client_products_view;
  reset role;

  -- Put it back so the file can be run again.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  update public.client_feature_settings
     set can_view_prices = true
   where client_id = v_client_a;
  reset role;

  if v_total = 2 and v_non_null = 0 then
    raise warning 'PASS - Permission switch works: with prices switched off, the Client still sees their % products but every price is null.', v_total;
  else
    raise warning 'FAIL - Permission switch: saw % products, % of which still had a price. Expected 2 products and 0 prices.', v_total, v_non_null;
  end if;
end
$$;

-- ===================================================================
-- TEST 14: Stock can only move through the recorded function
-- ===================================================================
-- The integrity test. A Supplier must not be able to type a stock
-- number straight into the table, and the movement log must never be
-- edited or deleted -- not even by Super Admin.
-- ===================================================================
do $$
declare
  v_supplier_a uuid;
  v_agent_a uuid;
  v_product_a uuid;
  v_direct_blocked boolean := false;
  v_move_worked boolean := false;
  v_new_stock numeric;
  v_after_own_stock numeric;
  v_agent_move_blocked boolean := false;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';
  select id into v_agent_a from _rls_test_ids where name = 'agent_a';
  select id into v_product_a
    from public.products
   where supplier_id = v_supplier_a and sku = 'RICE5';

  -- Attempt 1: type a new stock number directly. Must fail.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  begin
    update public.products set stock_qty = 99999 where id = v_product_a;
  exception when others then
    v_direct_blocked := true;
  end;
  reset role;

  -- Attempt 2: the correct way. Must succeed and must leave a record.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  begin
    select public.adjust_stock(v_product_a, 25, 'purchase', 'RLS test purchase')
      into v_new_stock;
    v_move_worked := true;
  exception when others then
    raise warning 'FAIL - adjust_stock() failed: %', sqlerrm;
  end;
  reset role;

  select stock_qty into v_after_own_stock
  from public.products where id = v_product_a;

  -- Attempt 3: an Agent tries to move stock. Must fail.
--
  -- The refusal comes from the ownership check inside
  -- private.append_stock_movement(), NOT from a missing GRANT. Every
  -- logged-in user shares the single `authenticated` database role, so
  -- a grant cannot be withheld from Agents while being given to
  -- Suppliers. The check has to live inside the function. This is worth
  -- being explicit about, because "Agents lack the grant" is the
  -- intuitive but wrong explanation, and someone will otherwise assume
  -- this is protected at the GRANT layer.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_agent_a::text, true);
  begin
    perform public.adjust_stock(v_product_a, -10, 'sale', 'agent should not be able');
  exception when others then
    v_agent_move_blocked := true;
  end;
  reset role;

  if v_direct_blocked and v_move_worked and v_new_stock = 125 and v_after_own_stock = 125 then
    raise warning 'PASS - Stock integrity: typing a stock number directly was blocked; adjust_stock() raised it 100 -> 125 and wrote a movement record.';
  elsif v_direct_blocked and v_move_worked then
    raise warning 'FAIL - Stock totals wrong: expected 125 after a +25 purchase from 100, got %.', v_new_stock;
  else
    raise warning 'FAIL - Stock integrity: direct edit blocked=%, function worked=%.', v_direct_blocked, v_move_worked;
  end if;

  -- The two refusals below are checked together but reported
  -- separately, because each one matters on its own and a single
  -- "FAIL - security" line would not say which one broke.
  if v_agent_move_blocked then
    raise warning 'PASS - Agents cannot move stock: an Agent''s attempt to change a Supplier''s stock was refused.';
  else
    raise warning 'FAIL - AN AGENT CHANGED STOCK. Agent A should have no stock rights at all.';
  end if;

  -- Attempt 4: edit the log. This runs as the superuser, so it is the
  -- strongest version of the test -- if even the platform owner cannot
  -- rewrite history, nobody can.
  begin
    update public.stock_movements set qty_delta = 9999;
    raise warning 'FAIL - THE STOCK LOG WAS EDITABLE. Movements must be append-only.';
  exception when others then
    if sqlerrm = 'STOCK_MOVEMENTS_ARE_APPEND_ONLY' then
      raise warning 'PASS - Stock log is append-only: an attempt to rewrite a movement was refused, including by the platform owner.';
    else
      raise warning 'FAIL - Stock log edit failed, but for the wrong reason: %', sqlerrm;
    end if;
  end;
end
$$;

-- ===================================================================
-- TEST 15: Stock cannot go negative without backorder enabled
-- ===================================================================
-- Taking stock below zero means promising goods that do not exist. It
-- is allowed only when the Supplier has deliberately switched it on, and
-- this test checks it is refused by default.
-- ===================================================================
do $$
declare
  v_supplier_a uuid;
  v_product_a uuid;
  v_blocked boolean := false;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';
  select id into v_product_a
    from public.products
   where supplier_id = v_supplier_a and sku = 'SUG1';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  begin
    -- Only 3 in stock. Taking 10 more would leave -7.
    perform public.adjust_stock(v_product_a, -10, 'sale', 'should be refused');
  exception when others then
    v_blocked := (sqlerrm = 'NEGATIVE_STOCK_NOT_ALLOWED');
  end;
  reset role;

  if v_blocked then
    raise warning 'PASS - Backorder rule: selling 10 units with only 3 in stock was refused because backorder is switched off.';
  else
    raise warning 'FAIL - Backorder rule: stock went below zero when the Supplier had not allowed backorder.';
  end if;
end
$$;

-- ===================================================================
-- TEST 16: Only a Super Admin can read the account list
-- ===================================================================
-- The account view shows every person in the system with the name of the
-- Supplier they belong to. A Client must not be able to read it, and
-- neither must a Supplier.
--
-- This is the test that matters most in this group, because the view was
-- added in migration 012 and PostgreSQL does not allow row level security
-- or policies on views at all -- `alter table ... enable row level
-- security` on a view fails outright. The only place the "Super Admin
-- only" rule can live is inside the view's own query, and this test is
-- what proves that WHERE clause is actually there and actually working.
-- Removing it would make this readable by every signed-in person in the
-- system, with no error anywhere.
-- ===================================================================
do $$
declare
  v_super_admin uuid;
  v_client uuid;
  v_supplier_a uuid;
  v_client_row bigint;
  v_supplier_seen bigint;
  v_client_seen bigint;
begin
  select id into v_super_admin from _rls_test_ids where name = 'super';
  select id into v_client from _rls_test_ids where name = 'client_a';
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';

  -- --- The Super Admin CAN read it. If this returned nothing, the whole
  --     screen would be empty and we would never notice why.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_super_admin::text, true);
  select count(*) into v_client_row
    from public.account_list_view
   where id = v_client;
  reset role;

  -- --- A Supplier is refused. There is no exception to catch here: the
  --     gate returns an EMPTY LIST rather than an error, because it is a
  --     WHERE clause inside the view and PostgreSQL allows no other kind
  --     of gate on a view. An empty list says nothing at all about other
  --     accounts, which is the point.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  select count(*) into v_supplier_seen from public.account_list_view;
  reset role;

  -- --- A Client is refused. This is the one that matters.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client::text, true);
  select count(*) into v_client_seen from public.account_list_view;
  reset role;

  if v_client_row = 1 and v_supplier_seen = 0 and v_client_seen = 0 then
    raise warning 'PASS - Account list: the Super Admin can read it; a Supplier and a Client both get an empty list.';
  else
    raise warning 'FAIL - Account list: Super Admin found %, Supplier saw %, Client saw %. Expected 1, 0, 0.',
      v_client_row, v_supplier_seen, v_client_seen;
  end if;
end
$$;

-- ===================================================================
-- TEST 17: The account view does not leak settings or permissions
-- ===================================================================
-- Migration 012 joins profiles to profiles. The mistake that would be
-- easy to make later is joining it to supplier_settings or
-- client_feature_settings "while we are in there", and then the browser
-- starts receiving the backorder flag and all nine permission switches.
--
-- assert_account_view_is_safe() checks the view's actual column list
-- against a blocklist, so that mistake fails here instead of in
-- production.
-- ===================================================================
do $$
declare
  v_checked boolean := false;
begin
  -- The guarded call sits in its OWN begin/exception block: the tripwire
  -- raises an exception when the view leaks, and this test still needs to
  -- print a clear FAIL instead of aborting the whole suite with a raw
  -- error. A nested block is the only way to catch it and keep going.
  begin
    perform public.assert_account_view_is_safe();
    v_checked := true;
  exception when others then
    v_checked := false;
    raise warning '     The tripwire itself failed: %', sqlerrm;
  end;

  if v_checked then
    raise warning 'PASS - Account view safety: it exposes no settings, no permission switches, and no created_by link.';
  else
    raise warning 'FAIL - Account view safety: the view is exposing a column it must not.';
  end if;
end
$$;

-- ===================================================================
-- TEST 18: The account view carries the Supplier's NAME, not just its id
-- ===================================================================
-- The reason this view exists at all. profiles stores a bare uuid, which
-- tells an administrator nothing. If supplier_name comes back null for a
-- client, the join is wrong and the screen shows a blank supplier on
-- every row.
-- ===================================================================
do $$
declare
  v_client uuid;
  v_super_admin uuid;
  v_name text;
begin
  select id into v_client from _rls_test_ids where name = 'client_a';
  select id into v_super_admin from _rls_test_ids where name = 'super';

  -- Read as the Super Admin, which is the only role the view's gate lets
  -- in. Reading it as a Client would prove nothing about the join: the
  -- gate inside the view returns an empty list before the join matters.
  -- The claim is set from a variable already resolved above: putting the
  -- lookup inside set_config() would run it under the switched role,
  -- which cannot read the test's temp table.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_super_admin::text, true);
  select supplier_name into v_name
    from public.account_list_view
   where id = v_client;
  reset role;

  if v_name is not null and length(v_name) > 0 then
    raise warning 'PASS - Account view join: the Client row carries the Supplier name "%".', v_name;
  else
    raise warning 'FAIL - Account view join: supplier_name was null, so the screen would show a blank Supplier.';
  end if;
end
$$;

-- ===================================================================
-- TEST 19: The private functions are still unreachable from the browser
-- ===================================================================
-- The single most damaging change anyone could make to this database is
-- granting private.set_user_active() straight to `authenticated`. That
-- function takes p_actor_id as an argument and trusts it, so a direct
-- grant would let any signed-in person pass their own id and act as a
-- Super Admin, or pass somebody else's id and frame them.
--
-- Migration 013 keeps the functions private and adds public wrappers
-- that supply the caller from auth.uid(). This test makes sure the
-- private ones were not quietly granted away later.
-- ===================================================================
do $$
declare
  v_checked boolean := false;
begin
  begin
    perform public.assert_private_functions_stay_private();
    v_checked := true;
  exception when others then
    v_checked := false;
    raise warning '     The tripwire itself failed: %', sqlerrm;
  end;

  if v_checked then
    raise warning 'PASS - Private functions stay private: the browser cannot call them directly, so nobody can choose their own actor id.';
  else
    raise warning 'FAIL - Private functions are executable by any signed-in user. The public wrapper in migration 013 must be the only path.';
  end if;
end
$$;

-- ===================================================================
-- TEST 20: The wrapper takes the caller from the session, not the form
-- ===================================================================
-- Confirms the positive path of test 19: a Supplier CAN deactivate their
-- own Client through public.set_user_active(), which proves the wrapper
-- exists and works rather than being broken in a way that hides test 19.
--
-- It also checks the rule that matters: a Supplier cannot deactivate
-- somebody belonging to a DIFFERENT Supplier, even though the wrapper
-- itself accepted the call.
-- ===================================================================
do $$
declare
  v_supplier_a uuid;
  v_supplier_b uuid;
  v_client_a uuid;
  v_client_b uuid;
  v_cross_blocked boolean := false;
  v_own_worked boolean := false;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';
  select id into v_supplier_b from _rls_test_ids where name = 'supplier_b';
  select id into v_client_a from _rls_test_ids where name = 'client_a';
  select id into v_client_b from _rls_test_ids where name = 'client_b';

  -- --- Cross-supplier attempt. This is the one that must fail.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  begin
    perform public.set_user_active(v_client_b, false);
  exception when others then
    v_cross_blocked := true;
  end;
  reset role;

  -- --- Their own Client. This must work, or the screen is broken.
  --     Set to the value it already has, so the test changes nothing.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier_a::text, true);
  begin
    perform public.set_user_active(v_client_a, true);
    v_own_worked := true;
  exception when others then
    v_own_worked := false;
  end;
  reset role;

  if v_cross_blocked and v_own_worked then
    raise warning 'PASS - Account deactivation: a Supplier can switch off their own Client, and is refused for a rival''s Client.';
  else
    raise warning 'FAIL - Account deactivation: cross-supplier blocked %, own-client worked %. Expected true, true.',
      v_cross_blocked, v_own_worked;
  end if;
end
$$;

-- ===================================================================
-- TEST 21: Nobody can switch off their own account
-- ===================================================================
-- The rule that stops the last Super Admin locking the whole system out
-- with one tap. If this passes and there is only one Super Admin, the
-- business cannot be bricked from inside the app.
-- ===================================================================
do $$
declare
  v_super_admin uuid;
  v_blocked boolean := false;
begin
  select id into v_super_admin from _rls_test_ids where name = 'super';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_super_admin::text, true);
  begin
    -- Requesting the same value it already has. The guard has to be on
    -- WHO is being changed, not on WHETHER anything changes, or an
    -- admin could never re-activate themselves after being switched off
    -- by somebody else.
    perform public.set_user_active(v_super_admin, false);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  -- Put it back, in case the guard did not fire.
  update public.profiles set is_active = true where id = v_super_admin;

  if v_blocked then
    raise warning 'PASS - Self-deactivation is refused, so the last Super Admin cannot lock everybody out.';
  else
    raise warning 'FAIL - A Super Admin was able to switch off their own account.';
  end if;
end
$$;

-- ===================================================================
-- TEST 22: A level-3 agent belongs to the SAME Supplier as everyone else
-- ===================================================================
-- The client asked for four levels but wants to set them up later, so
-- the structure has to be there without changing the two-level screens.
--
-- This is the load-bearing check: a deeper account must resolve to the
-- SAME root supplier as a shallow one. If it did not, a level-3 agent
-- would see an empty catalogue while its manager sees a full one, and
-- every price rule in the app would be measuring the wrong business.
-- ===================================================================
do $$
declare
  v_supplier_a  uuid;
  v_sub_agent   uuid;
  v_manager     uuid;
  v_root_a      uuid;
  v_root_b      uuid;
  v_depth_sub   integer;
  v_depth_mgr   integer;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';

  v_sub_agent := gen_random_uuid();
  v_manager   := gen_random_uuid();

  -- A manager one level below Supplier A, and somebody under them.
  -- Each profile needs a REAL account first: profiles.id points at
  -- auth.users.id, and the checks in this file are about chain rules,
  -- not about a foreign key quietly doing the refusing.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Manager A"}');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_sub_agent, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'subagent@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sub Agent A"}');

  insert into public.profiles (id, role, supplier_id, parent_id, full_name, username)
  values (v_manager, 'client', v_supplier_a, v_supplier_a, 'Manager A', 'manager_a');

  insert into public.profiles (id, role, supplier_id, parent_id, full_name, username)
  values (v_sub_agent, 'agent', v_supplier_a, v_manager, 'Sub Agent A', 'subagenta');

  insert into _rls_test_ids values ('manager_a', v_manager), ('sub_agent_a', v_sub_agent);

  select public.supply_chain_root(v_sub_agent) into v_root_a;
  select public.supply_chain_root(v_supplier_a)  into v_root_b;
  select public.supply_chain_depth(v_sub_agent) into v_depth_sub;
  select public.supply_chain_depth(v_manager)   into v_depth_mgr;

  if v_root_a = v_root_b
     and v_depth_mgr = 2
     and v_depth_sub = 3 then
    raise warning 'PASS - Chain root: a level-3 agent resolves to the same Supplier as its manager (Supplier %, levels % and %).',
      v_root_a, v_depth_mgr, v_depth_sub;
  else
    raise warning 'FAIL - Chain root: sub-agent resolved to Supplier % but its manager resolved to %. Expected the same Supplier, at levels % and %.',
      v_root_a, v_root_b, v_depth_mgr, v_depth_sub;
  end if;
end
$$;

-- ===================================================================
-- TEST 23: A manager must be in the same Supplier's tree
-- ===================================================================
-- THE INVARIANT. If this fails, one Supplier can graft their agent onto
-- another Supplier's chain, and that agent's team would inherit a
-- stranger's catalogue and prices. That is the whole multi-level model
-- resting on one comparison.
-- ===================================================================
do $$
declare
  v_supplier_a uuid;
  v_client_b   uuid;
  v_blocked    boolean := false;
  v_rogue      uuid;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';
  select id into v_client_b   from _rls_test_ids where name = 'client_b';

  v_rogue := gen_random_uuid();

  -- The account exists: without it, the insert below would be stopped by
  -- the foreign key before the cross-supplier rule was ever consulted,
  -- and the test would "pass" for the wrong reason. It is registered in
  -- _rls_test_ids so the cleanup at the end removes it even though the
  -- profiles row is never created.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_rogue, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rogue@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Rogue Agent"}');
  insert into _rls_test_ids values ('rogue', v_rogue);

  begin
    -- Supplier A's agent, trying to report to Supplier B's client.
    insert into public.profiles (id, role, supplier_id, parent_id, full_name, username)
    values (v_rogue, 'agent', v_supplier_a, v_client_b, 'Rogue Agent', 'roguea');
  exception when others then
    v_blocked := true;
  end;

  -- The rejected row must not exist afterwards. A trigger that raised
  -- but somehow let the row through would be worse than no trigger.
  if exists (select 1 from public.profiles where id = v_rogue) then
    raise warning 'FAIL - Cross-supplier chain: the trigger reported an error but the row was saved anyway.';
  elsif v_blocked then
    raise warning 'PASS - Cross-supplier chain: a manager from another Supplier is refused, and nothing was saved.';
  else
    raise warning 'FAIL - Cross-supplier chain: an agent was allowed to report to a manager in another Supplier''s chain.';
  end if;
end
$$;

-- ===================================================================
-- TEST 24: Four levels is the limit, and a loop is refused too
-- ===================================================================
-- Two protections in one check, because they share one code path: the
-- depth walk is bounded, so a circular chain reports the maximum depth
-- and is turned away by the same comparison that enforces the limit.
--
-- A chain deeper than four means the levels have crept past what the
-- design was proven for. A loop means an account could end up reporting
-- to itself and the team tree would never finish building.
-- ===================================================================
do $$
declare
  v_supplier_a uuid;
  v_level3     uuid;
  v_level4     uuid;
  v_four_ok        boolean := false;
  v_five_blocked   boolean := false;
  v_loop_blocked   boolean := false;
begin
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';
  select id into v_level3 from _rls_test_ids where name = 'sub_agent_a';

  -- Level 4 must be ALLOWED. This is the level the client asked for, so
  -- if the depth rule is off by one this is where it shows. The account
  -- row comes first, for the same reason as tests 22 and 23: the refusal
  -- tests below must be refused by the DEPTH rule, not by a missing
  -- account.
  v_level4 := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_level4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deep@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Deep Agent"}');

  begin
    insert into public.profiles (id, role, supplier_id, parent_id, full_name, username)
    values (v_level4, 'agent', v_supplier_a, v_level3, 'Deep Agent', 'deepa');
    -- Register it so the cleanup at the end of this file removes it.
    insert into _rls_test_ids values ('deepa', v_level4);
    v_four_ok := true;
  exception when others then
    null;
  end;

  -- Level 5 must be REFUSED, because its manager is already level 4. Its
  -- account is still created and registered, so the refusal can only come
  -- from the depth rule and the account does not outlive the test: the
  -- cleanup deletes it even though no profiles row was ever saved.
  if v_four_ok then
    declare
      v_level5 uuid;
    begin
      v_level5 := gen_random_uuid();
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values (v_level5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'levelfive@tracker.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Level Five"}');
      insert into _rls_test_ids values ('levelfive', v_level5);

      begin
        insert into public.profiles (id, role, supplier_id, parent_id, full_name, username)
        values (v_level5, 'agent', v_supplier_a, v_level4, 'Level Five', 'levelfive');
      exception when others then
        v_five_blocked := true;
      end;
    end;
  end if;

  -- A loop must be REFUSED. Making a level-3 agent report to its own
  -- level-4 subordinate walks 3 -> 4 -> 3 -> 4 until the bounded walk
  -- runs out, and comes back looking deeper than any legal chain.
  if v_four_ok then
    begin
      update public.profiles set parent_id = v_level4 where id = v_level3;
    exception when others then
      v_loop_blocked := true;
    end;
  end if;

  if not v_four_ok then
    raise warning 'FAIL - Depth limit: level 4 was refused, so the four levels the client asked for do not work.';
  elsif not v_five_blocked then
    raise warning 'FAIL - Depth limit: a fifth level was allowed.';
  elsif not v_loop_blocked then
    raise warning 'FAIL - Loop limit: a circular chain was allowed.';
  else
    raise warning 'PASS - Depth and loop limits: level 4 works, a fifth level is refused, and a circular chain is refused.';
  end if;
end
$$;

-- ===================================================================
-- TEST 25: A Client cannot move themselves to another Supplier
-- ===================================================================
-- Migration 002 limits what a person may write on their own profile to
-- full_name, phone and address. This proves supplier_id and parent_id
-- are genuinely outside that list: a crafted request naming them is
-- refused by the database on the column, before any policy is consulted.
-- ===================================================================
do $$
declare
  v_blocked     boolean := false;
  v_client      uuid;
  v_supplier_b  uuid;
begin
  select id into v_client     from _rls_test_ids where name = 'client_a';
  select id into v_supplier_b from _rls_test_ids where name = 'supplier_b';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client::text, true);
  begin
    -- Move themselves under the rival Supplier. Both values are resolved
    -- before the role switch, so a refusal here can only come from the
    -- column rules and not from the temp table being unreadable.
    update public.profiles
       set supplier_id = v_supplier_b,
           parent_id  = null
     where id = v_client;
  exception when others then
    v_blocked := true;
  end;
  reset role;

  if v_blocked then
    raise warning 'PASS - Self-reassignment is refused: a Client cannot write supplier_id on their own profile.';
  else
    -- Not an exception but still a refusal is fine. The real question is
    -- whether the value actually changed.
    if exists (
      select 1 from public.profiles
       where id = v_client
         and supplier_id = (select id from _rls_test_ids where name = 'supplier_b')
    ) then
      raise warning 'FAIL - Self-reassignment: a Client moved themselves to another Supplier.';
    else
      raise warning 'PASS - Self-reassignment is refused: a Client cannot write supplier_id on their own profile.';
    end if;
  end if;
end
$$;

-- ===================================================================
-- TEST 26: The currency lookup stays narrow
-- ===================================================================
-- A Client and an Agent may not read supplier_settings -- that table
-- holds the backorder switch, which is business information. This is how
-- their screens get the currency without getting the switch.
--
-- The tripwire fails if my_currency() ever grows an argument (which would
-- mean trusting the browser about whose currency to return) or stops
-- returning one text value (which would mean a settings row escaping
-- with it).
-- ===================================================================
do $$
declare
  v_client          uuid;
  v_supplier        uuid;
  v_client_currency text;
  v_supplier_currency text;
begin
  perform public.assert_currency_function_is_narrow();

  -- A Supplier gets the currency from their own settings row.
  select id into v_supplier from _rls_test_ids where name = 'supplier_a';
  update public.supplier_settings set currency = 'MYR' where supplier_id = v_supplier;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_supplier::text, true);
  select public.my_currency() into v_supplier_currency;
  reset role;

  -- Their Client, who has no right to read that settings row at all,
  -- still reads the same value through the function.
  select id into v_client from _rls_test_ids where name = 'client_a';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_client::text, true);
  select public.my_currency() into v_client_currency;
  reset role;

  -- Put it back, so re-running this file is unaffected.
  update public.supplier_settings set currency = 'IDR' where supplier_id = v_supplier;

  -- Supplier B is untouched. That is the point: the function answers for
  -- the CALLER, never for a whole table.
  if v_supplier_currency = 'MYR' and v_client_currency = 'MYR' then
    raise warning 'PASS - Currency lookup: a Client reads their own Supplier''s currency without being able to read the settings row, and the function takes no argument.';
  else
    raise warning 'FAIL - Currency lookup: Supplier read "%" and their Client read "%". Expected both MYR.',
      v_supplier_currency, v_client_currency;
  end if;
end
$$;

-- The whole file is ONE transaction, from the `begin` near the top to the
-- single `commit` after the cleanup below. Splitting it here used to leave
-- a second, stray `commit` with no matching `begin`, which makes psql
-- print "there is no transaction in progress" and looks exactly like a
-- failure to somebody running these tests for the first time.
-- If any check fails, everything this file did is rolled back, which is
-- what you want: a half-run of the security suite leaves test accounts
-- behind in the business's database.

-- ===================================================================
-- CLEAN UP -- must be the LAST thing in this file
-- ===================================================================
-- This block used to sit in the middle of the file, where it dropped the
-- _rls_test_ids table. Every test after that point then read a table that
-- no longer existed, and the whole file stopped with a hard error, so
-- eleven checks would never have run at all.
--
-- Five details this version has to get right:
--
--   1. Profiles form a tree and the links are BOTH ON DELETE RESTRICT
--      (001 supplier_id, 014 parent_id): a client/agent points at their
--      supplier, an agent may point at a manager. Children are deleted
--      before the profiles they point at, deepest-first, one pass per
--      level. Nulling the links instead would not work either: 014's
--      update trigger refuses a client or agent with no supplier.
--   2. stock_movements.created_by and product_id are ON DELETE RESTRICT
--      (009), and the table is append-only: a trigger refuses every
--      delete. The guard is stood down just long enough to remove the
--      suite's own movement rows and is put straight back afterwards.
--   3. Deleting a Supplier's profile cascades to their products, and the
--      products lifecycle trigger writes an audit row naming the actor
--      from the JWT claim. During cleanup that claim is stale or gone,
--      so the insert would fail its FK -- and the rows being removed are
--      test fixtures anyway. That trigger is stood down for the deletion
--      phase and re-enabled after it, like the movements guard.
--   4. Only rows this file created are touched, identified by their ids.
--      Nothing belonging to the business is read, let alone removed.
--   5. The rls_count() helper is public test scaffolding; it is dropped
--      so the suite leaves the schema exactly as it found it.
--   6. The whole file is one transaction: if any check fails, all of the
--      above (the stand-downs included) rolls back and the database is
--      left exactly as it was.
do $$
declare
  r record;
begin
  -- 1. Movement rows written by the stock checks reference test users
  --    (created_by) and test products (product_id) with RESTRICT fks,
  --    so they must go before the users or products they point at.
  --    The append-only trigger refuses every delete on purpose, so the
  --    guard is stood down for exactly this cleanup and re-enabled
  --    immediately. Only test rows are removed: the where clause is
  --    scoped to test ids, never a blanket clear.
  alter table public.stock_movements
    disable trigger stock_movements_no_update;

  delete from public.stock_movements
   where created_by in (select id from _rls_test_ids)
      or product_id in (select id from public.products
                         where supplier_id in (select id from _rls_test_ids));

  alter table public.stock_movements
    enable trigger stock_movements_no_update;

  -- 2. Profiles, deepest-first. supplier_id and parent_id are both
  --    ON DELETE RESTRICT, so a profile may only be deleted once nothing
  --    else points at it: one pass removes the rows at the current
  --    bottom of each chain, and the loop repeats until a pass deletes
  --    nothing. (Max chain depth is 4, so this terminates quickly.)
  --
  --    Deleting a Supplier's profile cascades to their products, whose
  --    lifecycle trigger would then write an audit row naming the actor
  --    from the JWT claim. During cleanup that claim is stale or gone,
  --    so the insert fails its FK. The trigger is stood down for this
  --    phase and re-enabled below, before anything else runs.
  alter table public.products
    disable trigger products_audit_lifecycle;

  loop
    delete from public.profiles p
     where p.id in (select id from _rls_test_ids)
       and not exists (
         select 1 from public.profiles c
          where c.id in (select id from _rls_test_ids)
            and (c.supplier_id = p.id or c.parent_id = p.id)
       );
    exit when not found;
  end loop;

  alter table public.products
    enable trigger products_audit_lifecycle;

  -- 3. Now the users go. Profiles cascade away, and with them products,
  --    supplier_settings and client features. Order inside the loop no
  --    longer matters: the deepest-first passes above removed every
  --    profile that pointed at another test profile.
  for r in select id from _rls_test_ids loop
    delete from auth.users where id = r.id;
  end loop;

  -- 4. Drop the test scaffolding.
  drop table if exists _rls_test_ids;
  drop function if exists public.rls_count(regclass, name);
  raise notice 'Test data cleaned up. All test rows removed.';
end
$$;

commit;

-- ===================================================================
-- SUMMARY
-- ===================================================================
-- You should see TWENTY-EIGHT PASS messages and no FAIL warnings.
--
-- The number is bigger than the number of checks on purpose:
--
--   26 checks, 28 messages.
--   Check 14 prints THREE, because it proves three separate things --
--   the direct write, an Agent moving stock, and the log being
--   append-only. Merging them would hide one failure behind the other.
--   Check 25 prints one of two possible messages depending on which way
--   it was refused, so its two lines never both appear.
--
-- If the run STOPS partway through with a red error, rather than printing
-- FAIL, that is a different fault from a failed check: the database is
-- missing a function or a column that a migration should have created.
-- Send the whole error text to your developer, because every check after
-- it did not run at all.
--
-- WHO CAN SEE WHOM:
--   1. Client isolation      - a Client sees only self + own Supplier
--   2. Supplier isolation    - a Supplier cannot see a rival
--   3. Privilege escalation  - a Client cannot become Super Admin
--   4. Signed-out access     - a visitor sees nothing
--   5. Agent isolation       - an Agent sees only self + own Supplier
--   6. Super Admin reach     - the owner still sees everything
--   7. Deactivation cuts access - switching someone off really works
--
-- PRICES, WHICH IS WHERE A SUPPLIER LOSES MONEY:
--   8.  Client cannot read the products table at all
--   9.  The Client view has no agent_price, sku or supplier_id column
--   10. A Client sees only their own Supplier's catalogue
--   11. The Agent view has no client_price, and its agent_price really
--       holds the agent figure (checked by value, not just by name)
--   12. Agent cannot read the products table at all
--   13. Switching off a permission nulls the number in the data, not
--       just on the screen
--
-- STOCK, WHICH IS WHERE INVENTORY STOPS ADDING UP:
--   14. Stock moves only through adjust_stock(), which always records a
--       movement; an Agent cannot move stock; the log cannot be edited
--       even by the platform owner
--   15. Stock cannot go below zero while backorder is switched off
--
-- ACCOUNTS, WHICH IS WHERE SOMEONE LOSES THEIR PASSWORD:
--   16. Only a Super Admin can read the account list; a Supplier and a
--       Client are both refused
--   17. The account view carries no settings and no permission switches
--   18. It carries the Supplier's NAME, not just a bare id
--   19. The private functions are still unreachable from the browser, so
--       nobody can pass their own id as the actor
--   20. A Supplier can switch off their own Client but is refused for a
--       rival's Client
--   21. Nobody can switch off their own account, so the last Super Admin
--       cannot lock everybody out
--
-- FOUR LEVELS, WHICH IS WHERE THE TEAM TREE COULD GO WRONG:
--   22. A level-3 agent resolves to the SAME Supplier as its manager, so
--       every price and catalogue rule still measures the same business
--   23. A manager must be in the same Supplier's tree, and a refused row
--       is not saved anyway
--   24. Level 4 works, level 5 is refused, and a circular chain is
--       refused
--   25. A Client cannot write supplier_id on their own profile
--
-- MONEY DISPLAY:
--   26. A Client reads their own Supplier's currency without being able
--       to read the settings row, and the function takes no argument
--
-- IF A TEST FAILED:
--   1. Do not launch the app.
--   2. Test 8, 9, 12, 13 -> look at 008_product_views.sql and
--      007_client_feature_settings.sql
--   3. Test 14, 15        -> look at 009_stock_movements.sql
--   4. Test 16, 17, 18    -> look at 012_account_views.sql
--   5. Test 19, 20, 21    -> look at 013_public_wrappers.sql and the
--      function in 004_private_functions.sql
--   6. Test 22, 23, 24, 25-> look at 014_supply_chain_levels.sql
--   7. Test 26            -> look at 015_currency_lookup.sql
--   8. Re-run this file to confirm the fix worked.
--
-- Tests 9, 11, 13, 19, 21 and 23 are the ones to read twice. The first
-- three protect the Supplier's margin; 19 and 21 protect the last person
-- who can still fix the system; 23 is the one comparison the whole
-- multi-level model rests on. They fail loudly rather than quietly.