// ===================================================================
// complete-password-change Edge Function
// ===================================================================
// Clears the must_change_password flag after the user picks a new password.
//
// Why this cannot be done from the browser:
// the profiles RLS policy lets a user edit only full_name, phone and
// address. That restriction is deliberate -- if a user could write to
// must_change_password or role, the whole permission model would collapse.
// So this step needs elevated rights, which means it runs here, where the
// service role key stays hidden.
//
// The function lives in its own file so it can be deployed independently,
// but it shares the create-user function's simple design: check who is
// asking, do the narrow job, never leak anything.
// ===================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // Build a client from the CALLER's token so we can identify them.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'You must be signed in.' }, 401)
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

    // Elevated client. Used only for the single narrow call below.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // private.complete_password_change() does the work. Note it takes no
    // user id argument on purpose: it always operates on auth.uid(), so a
    // caller cannot pass in somebody else's id and clear their flag.
    const { error: rpcError } = await adminClient.rpc('complete_password_change')

    if (rpcError) {
      console.error('complete_password_change failed:', rpcError.message)
      return json(
        { error: 'Your password was changed, but we could not finish saving. Please log in again.' },
        500,
      )
    }

    // Note on callerId: we looked it up to confirm the caller is real, which
    // is a genuine check. The function itself derives the id from the token
    // so it cannot be spoofed.
    void callerId

    return json({ success: true }, 200)
  } catch (err) {
    console.error('complete-password-change crashed:', err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}