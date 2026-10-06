-- ===================================================================
-- FIRST SUPER ADMIN -- one-time setup script
-- ===================================================================
-- Run this ONCE to create the very first Super Admin account.
-- After that you never run it again.
--
-- -------------------------------------------------------------------
-- WHY A SQL SCRIPT AND NOT A SCREEN
-- The app has no "sign up" page on purpose. If anyone could create the
-- first account through a form, then anyone who found the site first
-- could become the owner. The first account must come from you, by hand,
-- from your own Supabase dashboard.
-- -------------------------------------------------------------------
--
-- HOW TO RUN IT (step by step)
--
-- STEP 1. Decide on a username and password.
--   Write them down. Username must be 3 or more characters, using letters,
--   numbers, dot, dash or underscore. Password must be 8 or more characters.
--
-- STEP 2. Open your Supabase project
--   Go to https://supabase.com and open your project.
--
-- STEP 3. Open the SQL Editor
--   In the left menu, click "SQL Editor".
--   Click "New query".
--
-- STEP 4. Replace the two placeholders below
--   Find the two lines marked CHANGE THESE. Replace admin with your username
--   and 'CHANGE_THIS_TO_A_STRONG_PASSWORD' with your password.
--
-- STEP 5. Click "Run"
--   You should see "Success. No rows returned".
--
-- STEP 6. Log in
--   Open your website. Type your username and password.
--   It will ask you to choose a new password straight away. Do that.
--
-- -------------------------------------------------------------------
-- IF YOU SEE AN ERROR
--   "duplicate key value violates unique constraint"
--     -> A profile with that username already exists. Pick a different one.
--   "Password hash not recognised"
--     -> The password was not wrapped in crypt() properly. Re-copy the
--        template rather than editing it by hand.
-- ===================================================================

-- -------------------------------------------------------------------
-- Do not change anything below this line unless you know why.
-- -------------------------------------------------------------------
begin;

-- crypt() with gen_salt('bf') hashes the password. The database stores only
-- the hash, never the password itself. That is the correct way to store a
-- password. Supabase itself uses the same method.
--
-- We use this because we cannot call Supabase's Auth admin API from a plain
-- SQL script, and the profiles table needs a matching auth.users row to
-- hang off. This creates both, consistently.

do $$
declare
  v_username text := 'admin'; -- CHANGE THESE: your chosen username
  v_password text := 'CHANGE_THIS_TO_A_STRONG_PASSWORD'; -- CHANGE THESE
  v_fullname text := 'Platform Owner'; -- CHANGE THESE if you like
  v_user_id  uuid := gen_random_uuid();
  v_fake_email text;
begin
  -- Step 1: the login itself.
  v_fake_email := lower(v_username) || '@tracker.local';

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
  )
  values (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_fake_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('full_name', v_fullname)
  );

  -- Step 2: the profile row that gives this person the Super Admin role.
  -- supplier_id is null: the platform owner does not belong to any supplier.
  -- must_change_password is true: you choose your own password at first login.
  insert into public.profiles (
    id,
    role,
    supplier_id,
    full_name,
    username,
    is_active,
    must_change_password
  )
  values (
    v_user_id,
    'super_admin',
    null,
    v_fullname,
    lower(v_username),
    true,
    true
  );

  -- Step 3: write it in the audit log so there is a record of who owns
  -- this platform and when the account was made.
  insert into public.audit_logs (actor_id, action, table_name, record_id, new_value)
  values (v_user_id, 'super_admin_created', 'profiles', v_user_id, 'super_admin:' || lower(v_username));

  raise notice 'Super Admin "%" created. You can log in now.', lower(v_username);
  raise notice 'You will be asked to set a new password on first login.';
end
$$;

commit;

-- ===================================================================
-- RUNNING THIS TWICE
-- If you run it again by accident, the second run fails with a duplicate
-- username error. That is safe -- it will not create a second owner or
-- change the existing one. Nothing is broken.
-- ===================================================================