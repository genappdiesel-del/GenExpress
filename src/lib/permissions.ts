// ===================================================================
// Per-Client permission switches
// ===================================================================
// Nine booleans per Client, and the two rules that make them safe.
//
// RULE 1: THE DATABASE SAYS WHO OWNS THIS ROW
// -------------------------------------------
// A Supplier may only change switches for their OWN Clients. That check
// is a row level security rule, not something this file decides. The
// update below does not send a supplier id, because there is nothing
// safe for it to send: whatever value it sent, the database compares it
// against the signed-in session and ignores it if it disagrees.
//
// RULE 2: THE BUSINESS-INFORMATION SWITCHES START OFF
// ---------------------------------------------------
// Migration 007 splits the defaults. Prices, stock, availability and
// placing orders are ON, because without them a Client has a login that
// shows an empty screen. Order history, payments and the three reports
// are OFF, because they reveal how busy a business is and what it charges
// other people.
//
// The split is recorded in DECISIONS.md section 5.7. Getting it wrong in
// either direction is a real cost: all-ON hands a competitor the
// inventory, all-OFF hands the Client an empty screen.
//
// WHY ONE SWITCH AT A TIME
// ------------------------
// Each switch saves the instant it is flipped, and returns the whole row
// as the database now holds it. So the screen never has to guess what
// the database decided -- it shows what is actually stored. A form with
// one Save button for nine switches leaves all nine looking changed
// while none of them were.
// ===================================================================

import { supabase } from './supabase'
import { friendlyError } from './errors'
import { CLIENT_FEATURE_FLAGS } from '../types/database'
import type { ClientFeatureFlags } from '../types/database'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: friendlyError(error) }
}

/**
 * Read one Client's nine switches.
 *
 * The row is created by a database trigger the moment a Client account
 * is made, so it should always exist. If it somehow does not, this
 * returns all-off rather than an error.
 *
 * All-off is the right answer here, not the normal one. It is the
 * fallback for a row we cannot read, and it is deliberately stricter
 * than the real defaults: if we ever cannot tell what a Client may see,
 * the answer is "nothing" rather than a guess.
 */
export async function getClientFeatures(
  clientId: string,
): Promise<Result<ClientFeatureFlags>> {
  const { data, error } = await supabase
    .from('client_feature_settings')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) return fail(error)

  if (!data) return { ok: true, data: { ...ALL_OFF } }

  // Picked by name rather than spread, so a column added to the table
  // later does not silently appear in this object and get counted as a
  // permission.
  return {
    ok: true,
    data: {
      can_view_stock: data.can_view_stock,
      can_view_readiness: data.can_view_readiness,
      can_view_prices: data.can_view_prices,
      can_place_orders: data.can_place_orders,
      can_view_order_history: data.can_view_order_history,
      can_view_payments: data.can_view_payments,
      can_view_report_sales: data.can_view_report_sales,
      can_view_report_statement: data.can_view_report_statement,
      can_view_report_product_availability:
        data.can_view_report_product_availability,
    },
  }
}

/** Every switch off. The default for anything we cannot read. */
const ALL_OFF: ClientFeatureFlags = {
  can_view_stock: false,
  can_view_readiness: false,
  can_view_prices: false,
  can_place_orders: false,
  can_view_order_history: false,
  can_view_payments: false,
  can_view_report_sales: false,
  can_view_report_statement: false,
  can_view_report_product_availability: false,
}

/**
 * Change one switch, or read them all.
 *
 * Passing null for `patch` reads instead of writes. That reads like a
 * shortcut and it is a small one, so the permissions screen uses it --
 * but it is the one place in this app where a null argument changes what
 * the function does rather than only what it sends, and that is worth
 * knowing before extending it.
 */
export async function setClientFeature(
  clientId: string,
  patch: Partial<ClientFeatureFlags> | null,
): Promise<Result<ClientFeatureFlags>> {
  // No supplier id is sent, and no client id beyond the row being
  // matched. The database works out who is allowed from the session.
  if (patch === null) {
    return getClientFeatures(clientId)
  }

  // Refuse an unknown key before sending it. TypeScript should already
  // have caught this, but this object arrives from a form and a bad key
  // here would fail against the database with a message nobody can read.
  for (const key of Object.keys(patch)) {
    if (!FLAGS_KEYS.has(key)) {
      return {
        ok: false,
        error: `"${key}" is not a permission this app knows about.`,
      }
    }
  }

  const { data, error } = await supabase
    .from('client_feature_settings')
    .update(patch)
    .eq('client_id', clientId)
    .select('*')
    // `.single()` rather than `.maybeSingle()`: after a successful
    // update there must be exactly one row. Two would mean the
    // database's own rule about one row per Client had been broken, and
    // that is worth an error rather than a silent pick of the first.
    .single()

  if (error) return fail(error)

  // The whole row comes back, not just what we sent. If the database
  // disagreed with what we asked for, this is the version that is
  // actually stored.
  return {
    ok: true,
    data: {
      can_view_stock: data.can_view_stock,
      can_view_readiness: data.can_view_readiness,
      can_view_prices: data.can_view_prices,
      can_place_orders: data.can_place_orders,
      can_view_order_history: data.can_view_order_history,
      can_view_payments: data.can_view_payments,
      can_view_report_sales: data.can_view_report_sales,
      can_view_report_statement: data.can_view_report_statement,
      can_view_report_product_availability:
        data.can_view_report_product_availability,
    },
  }
}

/** The nine real column names, built once from the one list. */
const FLAGS_KEYS = new Set<string>(
  CLIENT_FEATURE_FLAGS.map((flag) => flag.key as string),
)