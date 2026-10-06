// ===================================================================
// Turning a typed error into a sentence a person can act on
// ===================================================================
// Supabase returns messages like:
//   "duplicate key value violates unique constraint"
//   "new row violates row-level security policy for table \"profiles\""
//
// Showing that to a shop owner is useless and confusing. This file maps the
// common cases to plain instructions, and falls back to something honest
// rather than inventing a reason we do not know.
// ===================================================================

const FRIENDLY: Array<[RegExp, string]> = [
  [
    /row-level security/i,
    'You do not have permission to do that. Ask your manager to check your account.',
  ],
  [/duplicate key/i, 'That value is already used. Please choose a different one.'],
  [
    /username/i,
    'That username is already taken. Please choose a different one.',
  ],
  [
    /invalid login credentials/i,
    'Wrong username or password. Please check and try again.',
  ],
  [
    /email.*registered|already.*registered|already been registered/i,
    'That username is already taken. Please choose a different one.',
  ],
  [
    /password.*should be at least|password.*too short/i,
    'The password is too short. Use at least 8 characters.',
  ],
  [
    /new password should be different/i,
    'The new password must be different from the old one.',
  ],
  [
    /failed to fetch|networkerror|network request failed/i,
    'No internet connection. Your work is saved on this screen. Try again when you have signal.',
  ],
  [
    /jwt expired|token.*expired/i,
    'Your session has expired. Please log in again.',
  ],
]

/** Convert any thrown error into a message safe to show a non-technical user. */
export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.'

  const raw =
    typeof error === 'string'
      ? error
      : ((error as { message?: string }).message ?? String(error))

  for (const [pattern, message] of FRIENDLY) {
    if (pattern.test(raw)) return message
  }

  // Postgres error code 42501 is the generic "permission denied".
  const code = (error as { code?: string }).code
  if (code === '42501') {
    return 'You do not have permission to do that.'
  }

  // We do not recognise this one. Say so plainly rather than pretending.
  // The full text goes to the browser console for whoever is debugging.
  console.error('[friendlyError] unrecognised error:', raw, error)
  return 'Something went wrong. Please try again.'
}

/**
 * Show a "Not saved yet" banner when the connection drops.
 * Used by the forms that must not lose typed data on a bad signal.
 */
export function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|networkerror|network request failed/i.test(message)
}