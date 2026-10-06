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

// ===================================================================
// MESSAGES THAT COME FROM OUR OWN DATABASE FUNCTIONS
// ===================================================================
// When a database function refuses an action it raises an error with a
// machine-readable code. Those codes are listed here so the person sees
// a sentence they can act on instead of a raw database message.
//
// The rule for this table: it must match the `raise exception` codes in
// supabase/migrations. If a code is added there and missing here, the
// person sees the generic fallback at the bottom -- which is honest, but
// unhelpful. Check both places when adding a new one.
// ===================================================================
const BY_CODE: Record<string, string> = {
  // 009_stock_movements.sql
  PRODUCT_NOT_FOUND_OR_INACTIVE: 'That product could not be found. It may have been removed.',
  NOT_YOUR_PRODUCT: 'That product belongs to another supplier.',
  NEGATIVE_STOCK_NOT_ALLOWED:
    'There is not enough stock, and backorder is switched off. Ask your supplier, or reduce the quantity.',
  STOCK_MOVEMENTS_ARE_APPEND_ONLY:
    'Stock history cannot be edited. Please post a correcting entry instead.',
  ACCOUNT_IS_NOT_ACTIVE: 'Your account is not active. Please contact your supplier.',

  // 004_private_functions.sql
  USER_NOT_FOUND: 'That user could not be found.',
  NOT_AUTHORISED: 'You do not have permission to do that.',
  PASSWORD_TOO_SHORT: 'The password is too short. Use at least 8 characters.',
  NEW_PASSWORD_MUST_DIFFER:
    'The new password must be different from the old one.',
  CANNOT_DEACTIVATE_SELF: 'You cannot switch off your own account.',
  CANNOT_DEACTIVATE_LAST_SUPER_ADMIN:
    'This is the last active platform owner. Switch on another one first.',

  // 003_grants_and_audit.sql
  USERNAME_TAKEN: 'That username is already taken. Please choose a different one.',
  USERNAME_TOO_SHORT: 'The username is too short. Use at least 4 characters.',
}

const FRIENDLY: Array<[RegExp, string]> = [
  [
    /row-level security/i,
    'You do not have permission to do that. Ask your manager to check your account.',
  ],

  // ------------------------------------------------------------------
  // Barcode and product rules
  // ------------------------------------------------------------------
  // Postgres reports a broken unique index as "duplicate key value
  // violates unique constraint products_supplier_barcode_key". The
  // constraint name is more precise than the generic duplicate message,
  // so it is matched first and given its own sentence.
  [
    /products_supplier_barcode_key/i,
    'This barcode is already used by another one of your products. Each product needs its own barcode.',
  ],
  [
    /products_supplier_sku_key/i,
    'This product code is already used by another one of your products.',
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

  // --- Our own database function codes come first -------------------
  // These are the most specific messages we have, and they are checked
  // before the generic patterns so a specific code is never swallowed by
  // a broad "permission denied" rule.
  for (const [code, message] of Object.entries(BY_CODE)) {
    // Match either the bare code or the database message that wraps it,
    // e.g. "NEGATIVE_STOCK_NOT_ALLOWED" or the same text inside a longer
    // Postgres error.
    if (raw.includes(code)) return message
  }

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