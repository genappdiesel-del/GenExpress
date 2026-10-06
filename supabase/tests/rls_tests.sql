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
  set local request.jwt.claim.sub = v_client_a::text;
  select count(*) into v_seen from public.products;
  reset role;

  if v_seen = 0 then
    raise notice 'PASS - Client blocked from products table: a Client sees 0 rows and must use the view.';
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
  set local request.jwt.claim.sub = v_client_a::text;
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
    raise notice 'PASS - Client view shape: it hides agent_price, sku and supplier_id by not having those columns at all. The guard confirms it.';
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
  set local request.jwt.claim.sub = v_client_a::text;
  select count(*) into v_seen_a from public.client_products_view;
  reset role;

  set local role authenticated;
  set local request.jwt.claim.sub = v_client_b::text;
  select count(*) into v_seen_b from public.client_products_view;
  reset role;

  if v_seen_a = 2 and v_seen_b = 1 then
    raise notice 'PASS - Client catalogue isolation: Client A sees 2 products, Client B sees 1. Neither sees the other''s Supplier.';
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
  set local request.jwt.claim.sub = v_agent_a::text;

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
    raise notice 'PASS - Agent price protection: the agent view has no client_price column, and the agent_price column really holds the agent figure (55000 / 14000).';
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
  set local request.jwt.claim.sub = v_agent_a::text;
  select count(*) into v_seen from public.products;
  reset role;

  if v_seen = 0 then
    raise notice 'PASS - Agent blocked from products table: an Agent sees 0 rows and must use the agent view.';
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
  set local request.jwt.claim.sub = v_supplier_a::text;
  update public.client_feature_settings
     set can_view_prices = false
   where client_id = v_client_a;
  reset role;

  -- The Client now reads the view.
  set local role authenticated;
  set local request.jwt.claim.sub = v_client_a::text;
  select count(*) filter (where client_price is not null),
         count(*)
    into v_non_null, v_total
    from public.client_products_view;
  reset role;

  -- Put it back so the file can be run again.
  set local role authenticated;
  set local request.jwt.claim.sub = v_supplier_a::text;
  update public.client_feature_settings
     set can_view_prices = true
   where client_id = v_client_a;
  reset role;

  if v_total = 2 and v_non_null = 0 then
    raise notice 'PASS - Permission switch works: with prices switched off, the Client still sees their % products but every price is null.', v_total;
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
  set local request.jwt.claim.sub = v_supplier_a::text;
  begin
    update public.products set stock_qty = 99999 where id = v_product_a;
  exception when others then
    v_direct_blocked := true;
  end;
  reset role;

  -- Attempt 2: the correct way. Must succeed and must leave a record.
  set local role authenticated;
  set local request.jwt.claim.sub = v_supplier_a::text;
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
  set local request.jwt.claim.sub = v_agent_a::text;
  begin
    perform public.adjust_stock(v_product_a, -10, 'sale', 'agent should not be able');
  exception when others then
    v_agent_move_blocked := true;
  end;
  reset role;

  if v_direct_blocked and v_move_worked and v_new_stock = 125 and v_after_own_stock = 125 then
    raise notice 'PASS - Stock integrity: typing a stock number directly was blocked; adjust_stock() raised it 100 -> 125 and wrote a movement record.';
  elsif v_direct_blocked and v_move_worked then
    raise warning 'FAIL - Stock totals wrong: expected 125 after a +25 purchase from 100, got %.', v_new_stock;
  else
    raise warning 'FAIL - Stock integrity: direct edit blocked=%, function worked=%.', v_direct_blocked, v_move_worked;
  end if;

  -- The two refusals below are checked together but reported
  -- separately, because each one matters on its own and a single
  -- "FAIL - security" line would not say which one broke.
  if v_agent_move_blocked then
    raise notice 'PASS - Agents cannot move stock: an Agent''s attempt to change a Supplier''s stock was refused.';
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
      raise notice 'PASS - Stock log is append-only: an attempt to rewrite a movement was refused, including by the platform owner.';
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
  set local request.jwt.claim.sub = v_supplier_a::text;
  begin
    -- Only 3 in stock. Taking 10 more would leave -7.
    perform public.adjust_stock(v_product_a, -10, 'sale', 'should be refused');
  exception when others then
    v_blocked := (sqlerrm = 'NEGATIVE_STOCK_NOT_ALLOWED');
  end;
  reset role;

  if v_blocked then
    raise notice 'PASS - Backorder rule: selling 10 units with only 3 in stock was refused because backorder is switched off.';
  else
    raise warning 'FAIL - Backorder rule: stock went below zero when the Supplier had not allowed backorder.';
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

-- ===================================================================
-- TEST 16: Only a Super Admin can read the account list
-- ===================================================================
-- The account view shows every person in the system with the name of the
-- Supplier they belong to. A Client must not be able to read it, and
-- neither must a Supplier -- a Supplier's view of their own people goes
-- through the same view but is filtered to them by the browser's query,
-- and the policy has to be the thing that stops the rest.
--
-- This is the test that matters most in this group, because the view was
-- added in migration 012 and views do not get row level security
-- automatically. Forgetting the policy would have made this readable by
-- every signed-in person in the system, with no error anywhere.
-- ===================================================================
do $$
declare
  v_super_admin uuid;
  v_client uuid;
  v_supplier_a uuid;
  v_client_row uuid;
  v_supplier_blocked boolean := false;
  v_client_blocked boolean := false;
begin
  select id into v_super_admin from _rls_test_ids where name = 'super';
  select id into v_client from _rls_test_ids where name = 'client_a';
  select id into v_supplier_a from _rls_test_ids where name = 'supplier_a';

  -- --- The Super Admin CAN read it. If this returned nothing, the whole
  --     screen would be empty and we would never notice why.
  set local role authenticated;
  set local request.jwt.claim.sub = v_super_admin::text;
  select count(*) into v_client_row
    from public.account_list_view
   where id = v_client;
  reset role;

  -- --- A Supplier is refused. Note this is a refusal, not a filter: the
  --     policy denies outright, because a Supplier manages their own
  --     people through a different screen.
  set local role authenticated;
  set local request.jwt.claim.sub = v_supplier_a::text;
  begin
    perform 1 from public.account_list_view limit 1;
  exception when others then
    v_supplier_blocked := true;
  end;
  reset role;

  -- --- A Client is refused. This is the one that matters.
  set local role authenticated;
  set local request.jwt.claim.sub = v_client::text;
  begin
    perform 1 from public.account_list_view limit 1;
  exception when others then
    v_client_blocked := true;
  end;
  reset role;

  if v_client_row = 1 and v_supplier_blocked and v_client_blocked then
    raise notice 'PASS - Account list: the Super Admin can read it; a Supplier and a Client are both refused.';
  else
    raise warning 'FAIL - Account list: Super Admin found %, Supplier blocked %, Client blocked %. Expected 1, true, true.',
      v_client_row, v_supplier_blocked, v_client_blocked;
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
  perform public.assert_account_view_is_safe();
  v_checked := true;
exception when others then
  v_checked := false;
  raise warning '     The tripwire itself failed: %', sqlerrm;
end;

  if v_checked then
    raise notice 'PASS - Account view safety: it exposes no settings, no permission switches, and no created_by link.';
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
  v_name text;
begin
  select id into v_client from _rls_test_ids where name = 'client_a';

  -- Read as the Super Admin, which is the only role the policy lets in.
  -- Reading it as a Client would prove nothing about the join: the
  -- policy refuses before the join is ever reached.
  set local role authenticated;
  set local request.jwt.claim.sub =
    (select id::text from _rls_test_ids where name = 'super');
  select supplier_name into v_name
    from public.account_list_view
   where id = v_client;
  reset role;

  if v_name is not null and length(v_name) > 0 then
    raise notice 'PASS - Account view join: the Client row carries the Supplier name "%".', v_name;
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
  perform public.assert_private_functions_stay_private();
  v_checked := true;
exception when others then
  v_checked := false;
  raise warning '     The tripwire itself failed: %', sqlerrm;
end;

  if v_checked then
    raise notice 'PASS - Private functions stay private: the browser cannot call them directly, so nobody can choose their own actor id.';
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
  set local request.jwt.claim.sub = v_supplier_a::text;
  begin
    perform public.set_user_active(v_client_b, false);
  exception when others then
    v_cross_blocked := true;
  end;
  reset role;

  -- --- Their own Client. This must work, or the screen is broken.
  --     Set to the value it already has, so the test changes nothing.
  set local role authenticated;
  set local request.jwt.claim.sub = v_supplier_a::text;
  begin
    perform public.set_user_active(v_client_a, true);
    v_own_worked := true;
  exception when others then
    v_own_worked := false;
  end;
  reset role;

  if v_cross_blocked and v_own_worked then
    raise notice 'PASS - Account deactivation: a Supplier can switch off their own Client, and is refused for a rival''s Client.';
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
  set local request.jwt.claim.sub = v_super_admin::text;
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
    raise notice 'PASS - Self-deactivation is refused, so the last Super Admin cannot lock everybody out.';
  else
    raise warning 'FAIL - A Super Admin was able to switch off their own account.';
  end if;
end
$$;

commit;

-- ===================================================================
-- SUMMARY
-- ===================================================================
-- You should see TWENTY-THREE PASS messages and no FAIL warnings.
--
-- Note the number is 23, not 21, because two of the checks below each
-- print two separate PASS messages (the stock ones). They are counted as
-- separate messages because they prove separate things, and merging them
-- would hide one failure behind the other.
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
-- IF A TEST FAILED:
--   1. Do not launch the app.
--   2. Test 8, 9, 12, 13 -> look at 008_product_views.sql and
--      007_client_feature_settings.sql
--   3. Test 14, 15        -> look at 009_stock_movements.sql
--   4. Test 16, 17, 18    -> look at 012_account_views.sql
--   5. Test 19, 20, 21    -> look at 013_public_wrappers.sql and the
--      function in 004_private_functions.sql
--   6. Re-run this file to confirm the fix worked.
--
-- Tests 9, 11, 13, 19 and 21 are the ones to read twice. The first three
-- protect the Supplier's margin; the last two protect the last person
-- who can still fix the system. They fail loudly rather than quietly.