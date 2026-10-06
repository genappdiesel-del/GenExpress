// ===================================================================
// Auth hook -- who is logged in, and what can they do
// ===================================================================
// Everything the app knows about the current user lives here.
//
// The important idea: we never trust a role value that came from anywhere
// except the database. We read the role from the profiles table, which is
// protected by Row Level Security. If someone edits localStorage to make
// themselves "super_admin", the database still says no.
// ===================================================================

import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isConfigured } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import type { Profile, UserRole } from '../types/database'

export type AuthState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'needs_password_change'; profile: Profile }
  | { status: 'signed_in'; profile: Profile }

export function useAuth() {
  // The initial value already accounts for missing configuration. Starting
  // in 'loading' and then immediately flipping to 'unconfigured' inside the
  // effect would be a wasted render -- the value is knowable at first render
  // because isConfigured is a module constant, not something that changes.
  const [state, setState] = useState<AuthState>(() =>
    isConfigured ? { status: 'loading' } : { status: 'unconfigured' },
  )
  const [error, setError] = useState<string | null>(null)

  // Load the profile whenever the session changes.
  const loadProfile = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: 'signed_out' })
      return
    }

    try {
      const { data, error: queryError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (queryError) {
        // A session can exist without a profile row. That happens if someone
        // signs in through Supabase Auth directly rather than through our
        // create-user flow. Treat it as not allowed.
        console.error('profile load failed:', queryError)
        setState({ status: 'signed_out' })
        await supabase.auth.signOut()
        return
      }

      const profile = data as Profile

      // A deactivated account keeps its Supabase session but must not use
      // the app. The RLS policies would block most things, but we stop it
      // here too so the user gets a clear message instead of empty screens.
      if (!profile.is_active) {
        setError('This account has been deactivated. Please contact your manager.')
        setState({ status: 'signed_out' })
        await supabase.auth.signOut()
        return
      }

      if (profile.must_change_password) {
        setState({ status: 'needs_password_change', profile })
        return
      }

      setState({ status: 'signed_in', profile })
    } catch (err) {
      console.error('loadProfile threw:', err)
      setState({ status: 'signed_out' })
    }
  }, [])

  useEffect(() => {
    // If the keys are missing there is nothing to synchronise with. The
    // initial state already says 'unconfigured', so returning early here is
    // enough -- no state update is needed.
    if (!isConfigured) return

    let active = true

    // Get the current session on first load. This is what keeps someone
    // logged in after they refresh the page.
    supabase.auth.getSession().then(({ data }) => {
      if (active) void loadProfile(data.session)
    })

    // Then listen for changes: sign in, sign out, token refresh.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  // --- Actions -------------------------------------------------------

  const signIn = useCallback(async (username: string, password: string) => {
    setError(null)
    try {
      // The username is stored as a fake email behind the scenes.
      // The person typing "ali" never sees or types the @tracker.local part.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: `${username.trim().toLowerCase()}@tracker.local`,
        password,
      })

      if (signInError) {
        setError(friendlyError(signInError))
        return false
      }
      return true
    } catch (err) {
      setError(friendlyError(err))
      return false
    }
  }, [])

  const changePassword = useCallback(async (newPassword: string) => {
    setError(null)
    try {
      // Step 1: change the actual password. This is a normal Supabase Auth
      // call -- a user is always allowed to change their own password.
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (updateError) {
        setError(friendlyError(updateError))
        return false
      }

      // Step 2: clear the "must change password" flag.
      //
      // We CANNOT do this with a direct table update. The profiles RLS
      // policy deliberately lets a user edit only full_name, phone and
      // address, so that nobody can promote themselves by flipping a
      // column. must_change_password is not on that list.
      //
      // The flag is cleared by the Edge Function, which holds the service
      // role key and can call private.complete_password_change(). That
      // function lives in a schema that is not reachable from the browser.
      //
      // If the function is not deployed yet, the password HAS still changed
      // and the user can log in -- they will just be asked to change it
      // again next time. That is an annoyance, not a security hole, so we
      // warn in the console and carry on.
      const { error: flagError } = await supabase.functions.invoke(
        'complete-password-change',
        { body: {} },
      )

      if (flagError) {
        console.warn(
          'Password was changed but the flag reset failed. ' +
            'Deploy the complete-password-change Edge Function. ' +
            'Detail:',
          flagError.message,
        )
      }

      return true
    } catch (err) {
      setError(friendlyError(err))
      return false
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setState({ status: 'signed_out' })
  }, [])

  return {
    state,
    error,
    clearError: () => setError(null),
    signIn,
    signOut,
    changePassword,
  }
}

/** Where each role's home screen lives. */
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return '/admin'
    case 'supplier':
      return '/supplier'
    case 'client':
      return '/client'
    case 'agent':
      return '/agent'
  }
}