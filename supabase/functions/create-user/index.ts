// ===================================================================
// create-user Edge Function
// ===================================================================
// Accounts can ONLY be created through this function. There is no INSERT
// policy on the profiles table, so the browser cannot invent an account
// even if someone tampers with the frontend code.
//
// This function holds the service-role key. That key bypasses every
// security rule in the database, so it must NEVER appear in frontend code,
// in this repository, or in any log output. It lives in the Edge Function
// environment as a secret that only the Supabase dashboard can set.
//
// Rules enforced here:
//   super_admin -> may create a supplier, or any user of any supplier
//   supplier    -> may create only a client or agent who belongs to THEM
//   anyone else -> refused
//
// The check below is repeated in the database via RLS. It is normal and
// correct to enforce a rule twice: here it gives a clear error message,
// and in the database it is the actual guarantee. If someone found a way
// around this function, the RLS policies would still hold the line.
// ===================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Which headers Supabase requires on every Edge Function call.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// The fake email domain. Agents and Clients often have no email address,
// so we store the username as if it were an email: "ali" becomes
// "ali@tracker.local". The user never sees or types this.
const FAKE_EMAIL_DOMAIN = 'tracker.local'

Deno.serve(async (req) => {
  // The browser asks "is it allowed?" before sending the real request.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // ----------------------------------------------------------------
    // Step 1: who is calling?
    // ----------------------------------------------------------------
    // We build a client from the CALLER's Authorization header. That client
    // runs as the caller, so any database read it does is subject to RLS.
    // This is how we learn the caller's role without trusting anything
    // they sent in the request body.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'You must be signed in to create a user.' }, 401)
    }

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData?.user) {
      return json({ error: 'Your session has expired. Please log in again.' }, 401)
    }
    const callerId = userData.user.id

    // Read the caller's own profile. The profiles RLS policy guarantees this
    // returns the caller's own row and nothing else.
    const { data: callerProfile, error: profileError } = await callerClient
      .from('profiles')
      .select('id, role, supplier_id, is_active')
      .eq('id', callerId)
      .single()

    if (profileError || !callerProfile) {
      return json({ error: 'Your account profile could not be found.' }, 403)
    }

    if (!callerProfile.is_active) {
      return json({ error: 'This account has been deactivated.' }, 403)
    }

    const callerRole = callerProfile.role as string

    // ----------------------------------------------------------------
    // Step 2: read and validate what they asked for
    // ----------------------------------------------------------------
    const body = await req.json()
    const {
      username,
      password,
      fullName,
      role,
      phone,
      address,
      supplierId,
    } = body ?? {}

    const errors: Record<string, string> = {}

    if (!username || String(username).trim().length < 3) {
      errors.username = 'Username must be at least 3 characters.'
    }
    if (!/^[a-z0-9._-]+$/i.test(String(username ?? ''))) {
      errors.username = 'Use letters, numbers, dot, dash or underscore only.'
    }
    if (!password || String(password).length < 8) {
      errors.password = 'Password must be at least 8 characters.'
    }
    if (!fullName || String(fullName).trim().length < 2) {
      errors.fullName = 'Please enter the full name.'
    }

    const allowedRoles = ['supplier', 'client', 'agent']
    if (!allowedRoles.includes(String(role))) {
      errors.role = 'Role must be supplier, client or agent.'
    }

    if (Object.keys(errors).length > 0) {
      return json({ error: 'Please check the form.', fieldErrors: errors }, 400)
    }

    // ----------------------------------------------------------------
    // Step 3: the ownership rule
    // ----------------------------------------------------------------
    // This is the heart of the function.
    const normalizedUsername = String(username).trim().toLowerCase()
    const targetRole = String(role)

    // A Client or Agent must belong to a supplier.
    let ownerSupplierId: string | null = null

    if (callerRole === 'super_admin') {
      // Super Admin may create anyone.
      if (targetRole === 'client' || targetRole === 'agent') {
        if (!supplierId) {
          return json({ error: 'Choose which Supplier this user belongs to.' }, 400)
        }
        ownerSupplierId = String(supplierId)
      }
      // A supplier created by Super Admin has no owner.
    } else if (callerRole === 'supplier') {
      // A Supplier may create only clients and agents, and only their own.
      if (targetRole === 'supplier') {
        return json(
          { error: 'Only the Super Admin can create another Supplier.' },
          403,
        )
      }
      // Force the owner to be the caller. Even if the request body tried to
      // say something else, we overwrite it. Never trust the client here.
      ownerSupplierId = callerId
    } else {
      // client and agent roles reach this point and are refused.
      return json({ error: 'You do not have permission to create users.' }, 403)
    }

    // ----------------------------------------------------------------
    // Step 4: verify the supplier we were told to use is really a supplier
    // ----------------------------------------------------------------
    // Stops a Super Admin accidentally assigning a client to a client.
    if (ownerSupplierId) {
      const { data: ownerProfile } = await callerClient
        .from('profiles')
        .select('id, role')
        .eq('id', ownerSupplierId)
        .single()

      if (!ownerProfile || ownerProfile.role !== 'supplier') {
        return json({ error: 'The chosen Supplier does not exist.' }, 400)
      }
    }

    // ----------------------------------------------------------------
    // Step 5: create the login
    // ----------------------------------------------------------------
    // Only NOW do we use the service role. Everything above ran with the
    // caller's own permissions. This step needs elevated rights because it
    // writes to auth.users, which no RLS policy can grant.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const fakeEmail = `${normalizedUsername}@${FAKE_EMAIL_DOMAIN}`

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: fakeEmail,
      password,
      email_confirm: true, // no email to confirm, the user typed the password themselves
      user_metadata: { full_name: fullName },
    })

    if (createError) {
      // Turn Postgres's raw wording into something a non-technical person
      // can act on.
      if (createError.message.toLowerCase().includes('already') ||
          createError.message.toLowerCase().includes('registered')) {
        return json({ error: `The username "${normalizedUsername}" is already taken.` }, 400)
      }
      // Log the detail for us (the developers) but return a plain message.
      console.error('createUser failed:', createError.message)
      return json({ error: 'The account could not be created. Please try again.' }, 500)
    }

    if (!created?.user) {
      return json({ error: 'The account could not be created. Please try again.' }, 500)
    }

    const newUserId = created.user.id

    // ----------------------------------------------------------------
    // Step 6: create the matching profile row
    // ----------------------------------------------------------------
    const { error: insertError } = await adminClient.from('profiles').insert({
      id: newUserId,
      role: targetRole as 'supplier' | 'client' | 'agent',
      supplier_id: ownerSupplierId,
      full_name: String(fullName).trim(),
      username: normalizedUsername,
      phone: phone ? String(phone).trim() : null,
      address: address ? String(address).trim() : null,
      is_active: true,
      // Force a password change on first login. The account was created by
      // someone else, so the holder should choose their own password.
      must_change_password: true,
      created_by: callerId,
    })

    if (insertError) {
      // If the profile insert fails we must not leave an orphaned login
      // behind. Clean it up so we do not end up with a half-created account.
      await adminClient.auth.admin.deleteUser(newUserId)
      console.error('profile insert failed:', insertError.message)
      return json(
        { error: 'The account could not be created. Nothing was saved.' },
        500,
      )
    }

    // ----------------------------------------------------------------
    // Step 7: write to the audit log
    // ----------------------------------------------------------------
    await adminClient.from('audit_logs').insert({
      actor_id: callerId,
      action: 'user_created',
      table_name: 'profiles',
      record_id: newUserId,
      new_value: `${targetRole}:${normalizedUsername}`,
    })

    // ----------------------------------------------------------------
    // Step 8: answer
    // ----------------------------------------------------------------
    // We deliberately do NOT return the password, and we never echo the
    // fake email back to the browser.
    return json(
      {
        success: true,
        user: {
          id: newUserId,
          username: normalizedUsername,
          fullName: String(fullName).trim(),
          role: targetRole,
        },
      },
      200,
    )
  } catch (err) {
    // Never leak a stack trace to the browser. Log it for us, tell the user
    // something plain.
    console.error('create-user crashed:', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}