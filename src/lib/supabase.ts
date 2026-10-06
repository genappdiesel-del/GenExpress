import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// ===================================================================
// One Supabase client for the whole app.
// ===================================================================
// We use the ANON key here. That is deliberate and safe.
//
// "Doesn't the anon key let anyone read the database?"
// No. The anon key is public by design -- it ships in every web page and in
// the browser's network tab. It only opens the door to the Data API.
// What the person is allowed to see once inside is decided by the Row
// Level Security policies in the database. A logged-out visitor with this
// key gets zero rows from every table, because RLS blocks them.
//
// The key that would be dangerous is service_role, because it skips RLS
// entirely. That key never enters this codebase. It lives only as a secret
// inside the create-user Edge Function.

// If the .env file is missing, we want a clear message on screen rather than
// a blank white page. This check runs once at startup.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  console.error(
    'Supabase keys are missing. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
  )
}

export const supabase = createClient<Database>(
  url ?? 'https://placeholder.invalid',
  anonKey ?? 'placeholder-key',
  {
    auth: {
      // Keep the user signed in across page reloads by storing the session
      // in localStorage. This is the default, stated here so the next
      // person reading does not wonder.
      persistSession: true,
      autoRefreshToken: true,
      // We do not use a server, so there is nothing to refresh tokens against.
      detectSessionInUrl: false,
    },
  },
)