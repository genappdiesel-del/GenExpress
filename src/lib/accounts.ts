// ===================================================================
// Reading the account list, and switching accounts on and off
// ===================================================================
// Two jobs, both belonging to whoever is managing accounts.
//
// 1. LISTING ACCOUNTS
//    The Super Admin's list needs the name of the Supplier each person
//    belongs to. That join is not something the browser can do -- it may
//    only read one table per request. So a view in the database does the
//    join, and this file reads the view.
//
//    The important part: the view does not expose settings or permission
//    switches. Building a list of people must not hand over the ability
//    to change what they can see. Those are separate, deliberate acts.
//
// 2. SWITCHING AN ACCOUNT OFF
//    A person leaves the business. Their account is NOT deleted. Deleting
//    would take their orders and history with it, and in a business that
//    keeps records for tax, that history has to survive.
//
//    So "off" means is_active = false. They cannot sign in, and every
//    database rule already checks that flag, so they lose access
//    immediately without anything else having to be switched off.
//
//    Why the database does it rather than this file: the flag lives in
//    the private schema, which the browser cannot call at all. There is
//    one function, it checks the caller is a Super Admin, and it writes
//    an audit row. No amount of editing this file reaches it.
// ===================================================================

import { supabase } from './supabase'
import { friendlyError } from './errors'
import type { AccountListRow } from '../types/database'

/** The same Result shape as the rest of the app, so no screen can forget
 *  to handle the failure. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// ===================================================================
// Creating an account
// ===================================================================
// New people cannot sign themselves up, and that is deliberate. If
// anybody could create an account, anybody could create a Client account
// and then read a Supplier's whole catalogue.
//
// So creation goes through a server function that checks who is asking
// before it does anything. The function is the only thing that can do
// this, because only the server holds the key that creates accounts. The
// browser never receives that key, so no amount of editing the page can
// make it create an account by itself.
//
// The rules, in plain words:
//   - Super Admin may create anybody.
//   - Supplier may create a Client or an Agent, and only for themselves.
//     Their own id is read from their signed-in session, never from the
//     form, so a Supplier cannot file somebody under a different
//     Supplier by editing the page.
//   - Client and Agent may create nobody.
//
// The screen mirrors those rules so nobody fills in something that will
// be refused. The screen is a convenience; the function is the
// authority, and re-checks everything regardless.

/** What the caller has to supply. */
export interface NewAccount {
  username: string
  /** Chosen by the person creating the account. The new user is made to
   *  change it the first time they sign in. */
  password: string
  fullName: string
  role: 'supplier' | 'client' | 'agent'
  phone?: string
  address?: string
  /** Only a Super Admin sends this, naming whose people they are. A
   *  Supplier leaves it out and the function uses their own id from the
   *  session, which is the only value that cannot be tampered with. */
  supplierId?: string | null
  /** Who recruited this person. Left out means level 2, straight under the
   *  Supplier. Filling it in means level 3 or 4.
   *
   *  The function checks the person named here is inside the caller's own
   *  Supplier chain before using this value, and the database checks it
   *  again. So a wrong id cannot move an account into a rival's team --
   *  at worst it is ignored and the account lands at level 2. */
  parentId?: string | null
}

/** Field-level problems, so each message can sit next to its own box.
 *  These keys match what the function returns. */
export type FieldErrors = Partial<Record<keyof NewAccount, string>>

export type CreateAccountResult =
  | { ok: true; data: { id: string; username: string } }
  | { ok: false; error: string; fieldErrors: FieldErrors }

/** Create one account. Returns a Result rather than throwing, so no screen
 *  can forget to handle the failure. */
export async function createAccount(account: NewAccount): Promise<CreateAccountResult> {
  let payload: {
    error?: string
    fieldErrors?: FieldErrors
    user?: { id?: string; username?: string }
  }

  try {
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: account,
    })

    // A network drop, or a function that has not been deployed yet. The
    // message says which, because "something went wrong" on a sign-up
    // screen tells a non-technical person nothing about what to do.
    if (error) {
      return {
        ok: false,
        error:
          error.message.includes('fetch') || error.message.includes('network')
            ? 'Could not reach the server. Check the internet connection and try again.'
            : error.message,
        fieldErrors: {},
      }
    }

    const response = data as Response

    try {
      payload = (await response.json()) as typeof payload
    } catch {
      return {
        ok: false,
        error: 'The server sent back something we could not read.',
        fieldErrors: {},
      }
    }

    // The function's own message is the one written for a person to
    // read. Passing it through beats inventing a vaguer one, because
    // the function knows the specific reason it refused.
    if (!response.ok) {
      return {
        ok: false,
        error: payload.error ?? 'The account could not be created.',
        fieldErrors: payload.fieldErrors ?? {},
      }
    }
  } catch (thrown) {
    return {
      ok: false,
      error: thrown instanceof Error ? thrown.message : 'Unexpected error.',
      fieldErrors: {},
    }
  }

  return {
    ok: true,
    data: {
      id: payload.user?.id ?? '',
      username: payload.user?.username ?? account.username,
    },
  }
}

/**
 * Check a username while the person is typing.
 *
 * Runs the same rule the server runs, so an obvious mistake is caught
 * without a round trip.
 *
 * It is NOT a security check, and it cannot be. Finding out a username
 * is already taken would mean reading other people's usernames, so that
 * particular answer can only come from the server, and only after it
 * refuses.
 */
export function checkUsername(username: string): string | null {
  const value = username.trim()

  if (value.length === 0) return 'Enter a username.'
  if (value.length < 3) return 'Use at least 3 characters.'
  if (!/^[a-z0-9._-]+$/i.test(value)) {
    return 'Use letters, numbers, dot, dash or underscore only.'
  }
  return null
}

/**
 * How strong a password looks, for a bar under the box.
 *
 * This is advice, not a rule. The server decides whether to accept it. A
 * bar that said "weak" and then refused would be a lie, and a bar that
 * said "weak" and allowed it would look broken -- so it says neither. It
 * only reports.
 */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3
  label: { id: string; en: string }
} {
  if (password.length === 0) return { score: 0, label: { id: '', en: '' } }

  let points = 0
  if (password.length >= 8) points++
  if (password.length >= 12) points++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points++
  if (/\d/.test(password)) points++
  if (/[^A-Za-z0-9]/.test(password)) points++

  const score = Math.min(3, Math.max(1, Math.round((points / 5) * 3))) as 1 | 2 | 3

  const labels = {
    1: { id: 'Lemah', en: 'Weak' },
    2: { id: 'Cukup', en: 'Fair' },
    3: { id: 'Kuat', en: 'Strong' },
  }

  return { score, label: labels[score] }
}

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: friendlyError(error) }
}

/**
 * Every account, for the Super Admin's list.
 *
 * Read from a view, so this is one request and the Supplier names are
 * already joined. The view is readable only by a Super Admin; if
 * somebody else calls this, the database returns an empty list rather
 * than an error, because a view filtered by RLS does not say "no". The
 * screen treats an empty list as "nothing to show" and that is honest.
 */
export async function listAccounts(): Promise<Result<AccountListRow[]>> {
  const { data, error } = await supabase
    .from('account_list_view')
    .select('*')
    .order('role', { ascending: true })
    .order('full_name', { ascending: true })

  if (error) return fail(error)
  return { ok: true, data: (data ?? []) as AccountListRow[] }
}

/** Accounts belonging to one Supplier. Used by the Supplier's own screen. */
export async function listSupplierAccounts(
  supplierId: string,
): Promise<Result<AccountListRow[]>> {
  const { data, error } = await supabase
    .from('account_list_view')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('full_name', { ascending: true })

  if (error) return fail(error)
  return { ok: true, data: (data ?? []) as AccountListRow[] }
}

/**
 * Switch an account on or off.
 *
 * This does NOT delete the account. See the note at the top of this file
 * for why. The person keeps their history; they lose access.
 *
 * Two rules are enforced by the database, not here:
 *   - only a Super Admin may call it
 *   - nobody may switch off their own account, which would lock the
 *     last administrator out of the whole system
 */
export async function setAccountActive(
  userId: string,
  isActive: boolean,
): Promise<Result<void>> {
  // No actor is sent. The database takes the caller from the signed-in
  // session, so this cannot be made to act as somebody else. See
  // migration 013 for why that matters.
  const { error } = await supabase.rpc('set_user_active', {
    p_user_id: userId,
    p_is_active: isActive,
  })

  if (error) return fail(error)
  return { ok: true, data: undefined }
}

// ===================================================================
// The team tree
// ===================================================================
// One Supplier, everyone under them, and which level each person sits
// at. Level 1 is the Supplier themselves.
//
// This is read from a database function rather than by walking accounts
// in the browser, for two reasons. First, the level is worked out by a
// bounded walk that the database already owns, so the browser never has
// to hold a chain in memory or be trusted to draw it. Second, and more
// importantly, the function returns only ONE Supplier's rows, so there
// is no version of this call that can return a stranger's team.
//
// A team can be four deep. Nobody at level 4 can have anybody under
// them, and that is checked in the database when the account is created,
// not here.

export interface TeamMember {
  id: string
  /** Who recruited them. Empty means straight under the Supplier. */
  parent_id: string | null
  role: 'supplier' | 'client' | 'agent'
  /** 1 is the Supplier, 4 is the deepest anybody may go. */
  level: number
  full_name: string
  username: string
  is_active: boolean
}

export async function listTeam(supplierId: string): Promise<Result<TeamMember[]>> {
  const { data, error } = await supabase.rpc('supply_chain_members', {
    p_supplier_id: supplierId,
  })

  if (error) return fail(error)
  return { ok: true, data: (data ?? []) as TeamMember[] }
}

/**
 * The currency this person's own Supplier trades in.
 *
 * Why this is a call and not a value the app remembers: Clients and
 * Agents may not read the settings table -- it holds business
 * information such as the backorder switch -- so before migration 015 the
 * frontend simply assumed Rupiah for them. A wrong currency symbol is a
 * money bug, not a formatting one: it turns 100 ringgit into 100 rupiah
 * and nobody notices until a customer does.
 *
 * The database function returns one value, for the caller only. This
 * screen caches the answer per signed-in person, for two reasons:
 * a currency cannot change under somebody while they are working, and a
 * shop passes one phone between people all day, so the value must be
 * thrown away when the person on it changes rather than reused.
 *
 * Passing the caller's id is what invalidates the cache. The id is read
 * from the session on the way here -- the function itself never accepts
 * a caller id, it reads auth.uid(), which the browser cannot forge.
 */
let currencyCache: { ownerId: string; value: string } | null = null

export async function getMyCurrency(ownerId: string): Promise<string> {
  if (currencyCache && currencyCache.ownerId === ownerId) return currencyCache.value

  let value = 'IDR'
  try {
    const { data } = await supabase.rpc('my_currency')
    // 'IDR' is the fallback rather than an empty string, so a failed
    // lookup shows a real currency symbol rather than an empty gap.
    if (typeof data === 'string' && data.length > 0) value = data
  } catch {
    // Keep the fallback. Refusing to draw the app over one lookup would
    // be worse than showing the confirmed default.
  }

  currencyCache = { ownerId, value }
  return value
}