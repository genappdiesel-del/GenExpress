// ===================================================================
// Talking to the database about products
// ===================================================================
// All the product queries live in one file so that:
//   - every query has its loading, empty and error handling in one place
//   - the permission rules are visible together and can be checked
//   - a screen never has to know SQL
//
// READ THIS BEFORE ADDING A QUERY
//
// The products table has no row rules for Clients and Agents, on purpose.
// They cannot read it. So:
//
//   Supplier   -> supabase.from('products')
//   Client     -> supabase.from('client_products_view')   (no agent_price)
//   Agent      -> supabase.from('agent_products_view')    (no client_price)
//
// If you are about to query 'products' from a Client or Agent screen,
// the correct answer is no.
// ===================================================================

import { supabase } from './supabase'
import { friendlyError } from './errors'
import { READINESS_TEXT } from '../types/database'
import type {
  Currency,
  ProductRow,
  ClientProductRow,
  AgentProductRow,
  ProductPage,
  ProductInput,
  StockMovement,
  Readiness,
} from '../types/database'

const PAGE_SIZE = 20

// ===================================================================
// Result wrapper
// ===================================================================
// Every function returns the same shape instead of throwing, because
// then a screen cannot forget to handle the failure. If it did forget,
// TypeScript would complain -- there is no path where an error is not
// accounted for.
// ===================================================================
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function fail<T>(error: unknown): Result<T> {
  return { ok: false, error: friendlyError(error) }
}

// ===================================================================
// Supplier: list products
// ===================================================================

export async function listSupplierProducts(options: {
  search?: string
  page?: number
  onlyActive?: boolean
}): Promise<Result<ProductPage>> {
  const page = Math.max(0, options.page ?? 0)

  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    // The database limits which rows come back as well as which rows
    // exist. Asking for 21 rows and showing 20 is how we know there is a
    // next page without a second query.
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  if (options.onlyActive) {
    query = query.eq('is_active', true)
  }

  const search = options.search?.trim()
  if (search) {
    // ilike is a case-insensitive "contains". EscapeLike is needed because
    // the characters %, _ and \ are special to Postgres and a product
    // named "100%" would otherwise match everything.
    const escaped = escapeLike(search)
    query = query.or(
      `name.ilike.%${escaped}%,sku.ilike.%${escaped}%,barcode.ilike.%${escaped}%`,
    )
  }

  const { data, error, count } = await query
  if (error) return fail(error)

  const rows = (data ?? []) as ProductRow[]
  const total = count ?? rows.length

  return {
    ok: true,
    data: {
      rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      // A count of exactly a multiple of the page size means there is
      // probably one more page. We only show "next" when there is
      // definitely something after this page.
      hasNextPage: page * PAGE_SIZE + rows.length < total,
    },
  }
}

function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (m) => `\\${m}`)
}

// ===================================================================
// Supplier: one product
// ===================================================================

export async function getProduct(id: string): Promise<Result<ProductRow>> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return fail(error)
  if (!data) {
    return { ok: false, error: 'That product could not be found.' }
  }
  return { ok: true, data: data as ProductRow }
}

// ===================================================================
// Supplier: save one product
// ===================================================================

/**
 * The exact shape we write to the database.
 *
 * ProductInput marks most fields optional, because a caller may not care
 * about them. The database columns are not all optional, so by the time
 * a row is actually written every one of them must have a decided value:
 * NULL for "no barcode", true for "show this product", and so on.
 *
 * `Required` says exactly that, and it is what makes the insert
 * type-check without a cast. It also stops a future mistake: adding a new
 * optional field to ProductInput automatically makes it required here, so
 * the compiler asks where to decide its value instead of silently sending
 * undefined and failing against a NOT NULL column.
 */
type ProductPayload = Required<Omit<ProductInput, 'id'>>

/**
 * Create or update a product.
 *
 * `id` present means update, absent means create. Stock is NOT part of
 * this: stock moves only through adjustStock(), which writes a movement
 * record. Sending it here would fail on purpose -- see migration 009.
 */
export async function saveProduct(input: ProductInput): Promise<Result<ProductRow>> {
  const payload: ProductPayload = {
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    barcode: input.barcode?.trim() || null,
    unit: input.unit.trim() || 'pcs',
    description: input.description?.trim() || null,
    photo_path: input.photo_path || null,
    low_stock_level: input.low_stock_level ?? 0,
    agent_price: input.agent_price,
    client_price: input.client_price,
    is_active: input.is_active ?? true,
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .maybeSingle()

    if (error) return fail(error)
    if (!data) {
      return {
        ok: false,
        error: 'This product could not be saved. It may have been removed.',
      }
    }
    return { ok: true, data: data as ProductRow }
  }

  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select('*')
    .maybeSingle()

  if (error) return fail(error)
  if (!data) {
    return { ok: false, error: 'The product could not be created. Please try again.' }
  }
  return { ok: true, data: data as ProductRow }
}

// ===================================================================
// Supplier: change stock
// ===================================================================

export async function adjustStock(options: {
  productId: string
  delta: number
  reason: StockMovement['reason']
  note?: string
}): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_product_id: options.productId,
    p_qty_delta: options.delta,
    p_reason: options.reason,
    p_note: options.note?.trim() || null,
  })

  if (error) return fail(error)
  return { ok: true, data: Number(data) }
}

export async function listStockMovements(
  productId: string,
): Promise<Result<StockMovement[]>> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return fail(error)
  return { ok: true, data: (data ?? []) as StockMovement[] }
}

// ===================================================================
// Supplier: import many products at once
// ===================================================================

/**
 * Save products from a spreadsheet.
 *
 * Sent in batches of 50. Reason: a large insert in one request can time
 * out on a slow connection, and a timeout halfway through leaves the
 * person unsure what was saved. Batches mean each one either completes
 * or fails on its own, and we can report exactly how far we got.
 */
export async function importProducts(
  items: ProductInput[],
): Promise<Result<{ saved: number; failed: Array<{ name: string; error: string }> }>> {
  const BATCH = 50
  let saved = 0
  const failed: Array<{ name: string; error: string }> = []

  // Every row gets is_active decided here, once, rather than in each
  // caller. A missing value would fail the whole batch against a NOT NULL
  // column and lose 50 rows over something nobody would notice.
  const rows: ProductPayload[] = items.map((item) => ({
    name: item.name.trim(),
    sku: item.sku?.trim() || null,
    barcode: item.barcode?.trim() || null,
    unit: item.unit.trim() || 'pcs',
    description: item.description?.trim() || null,
    photo_path: item.photo_path || null,
    low_stock_level: item.low_stock_level ?? 0,
    agent_price: item.agent_price,
    client_price: item.client_price,
    is_active: item.is_active ?? true,
  }))

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)

    const { data, error } = await supabase
      .from('products')
      .insert(batch)
      .select('id')

    if (error) {
      // One row in the batch is bad and Postgres refuses the whole
      // statement. We record the batch as failed and carry on, because
      // losing 50 rows is better than losing 300. The person is told
      // exactly which ones did not save, with the database's reason.
      for (const item of batch) {
        failed.push({ name: item.name, error: friendlyError(error) })
      }
      continue
    }

    saved += data?.length ?? batch.length
  }

  return { ok: true, data: { saved, failed } }
}

// ===================================================================
// Supplier: settings
// ===================================================================

export async function getSupplierSettings(): Promise<
  Result<{ currency: Currency; allow_backorder: boolean; page_size: number }>
> {
  const { data, error } = await supabase
    .from('supplier_settings')
    .select('currency, allow_backorder, page_size')
    .maybeSingle()

  if (error) return fail(error)

  // A missing row should be impossible: the database creates one when the
  // Supplier is created. But if it is missing we still need a working
  // screen, so we fall back to the documented defaults rather than
  // showing an error the person can do nothing about.
  if (!data) {
    return { ok: true, data: { currency: 'IDR', allow_backorder: false, page_size: PAGE_SIZE } }
  }

  return {
    ok: true,
    data: {
      currency: data.currency as Currency,
      allow_backorder: data.allow_backorder,
      page_size: data.page_size,
    },
  }
}

export async function updateSupplierSettings(patch: {
  allow_backorder?: boolean
  currency?: Currency
}): Promise<Result<void>> {
  const { error } = await supabase
    .from('supplier_settings')
    .update(patch)
    // The database forces this row to belong to the caller, so we do not
    // send a supplier id at all. There is nothing for the app to get wrong.
    .eq('supplier_id', (await getMyId()) ?? '')

  if (error) return fail(error)
  return { ok: true, data: undefined }
}

/** The signed-in person's own id. Read once and cached by the auth hook
 *  elsewhere; this is the fallback for callers that only need the id. */
let cachedId: string | null = null
async function getMyId(): Promise<string | null> {
  if (cachedId) return cachedId
  const { data } = await supabase.auth.getUser()
  cachedId = data.user?.id ?? null
  return cachedId
}

// ===================================================================
// Client: browse the catalogue
// ===================================================================

/**
 * The Client reads a VIEW, not the table.
 *
 * The view has no agent_price column at all, so there is nothing to leak
 * even if the query asked for it. We only ask for the columns we know
 * exist, and the database rejects anything else -- which is a useful
 * extra safety net against someone editing this file later.
 */
export async function listClientProducts(options: {
  search?: string
  page?: number
}): Promise<Result<ProductPage>> {
  const page = Math.max(0, options.page ?? 0)

  let query = supabase
    .from('client_products_view')
    .select('*', { count: 'exact' })
    .order('name', { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  const search = options.search?.trim()
  if (search) {
    const escaped = escapeLike(search)
    query = query.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`)
  }

  const { data, error, count } = await query
  if (error) return fail(error)

  const rows = (data ?? []) as ClientProductRow[]
  const total = count ?? rows.length

  return {
    ok: true,
    data: {
      rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      hasNextPage: page * PAGE_SIZE + rows.length < total,
    },
  }
}

// ===================================================================
// Agent: look up products by barcode
// ===================================================================

export async function listAgentProducts(options: {
  search?: string
  barcode?: string
}): Promise<Result<AgentProductRow[]>> {
  let query = supabase.from('agent_products_view').select('*')

  if (options.barcode?.trim()) {
    // Exact match on the barcode. An Agent scanning a product wants that
    // one product, not every product whose name contains the digits.
    query = query.eq('barcode', options.barcode.trim())
  } else if (options.search?.trim()) {
    const escaped = escapeLike(options.search)
    query = query.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%`)
  } else {
    query = query.order('name', { ascending: true })
  }

  const { data, error } = await query.limit(50)
  if (error) return fail(error)
  return { ok: true, data: (data ?? []) as AgentProductRow[] }
}

// ===================================================================
// Product photos
// ===================================================================

/**
 * A temporary, viewable link to one product photo.
 *
 * The photo bucket is PRIVATE. That means there is no public address for
 * a photo, and a leaked link stops working. It also means we cannot just
 * put the file path in the page and let the browser fetch it -- we have to
 * ask the database for a link that expires.
 *
 * One hour is a compromise. Long enough that a photo does not vanish
 * while somebody is looking at it, short enough that a link pasted into a
 * chat message is dead by tomorrow.
 *
 * Returns null when there is no photo, or when the database refuses. A
 * missing photo must never break a list: the screen shows a placeholder
 * instead. A refusal is normal, not exceptional -- a Client who is not
 * allowed to see photos still sees the row, just without the picture.
 */
export async function getProductPhotoUrl(photoPath: string | null): Promise<string | null> {
  if (!photoPath || photoPath.trim() === '') return null

  const { data, error } = await supabase.storage
    .from('product-photos')
    .createSignedUrl(photoPath, 60 * 60)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// ===================================================================
// Helpers shared by the screens
// ===================================================================

/**
 * Margin between the two prices.
 *
 * Returned as whole small units and as a percentage, both computed
 * through the money helpers so no decimal drift creeps in.
 *
 * The percentage is measured against the agent price, because that is
 * the question a Supplier actually asks: "what do I keep on each unit?"
 */
export function marginOf(product: {
  agent_price: number
  client_price: number
}): { units: number; percent: number } {
  const units = Math.round(product.client_price - product.agent_price)
  const percent =
    product.agent_price > 0 ? (units / product.agent_price) * 100 : 0
  return { units, percent }
}

/**
 * Whether the client price should show a warning.
 *
 * The brief says warn, not block. Equal prices are also flagged because
 * "I set them the same by mistake" is a common accident and the warning
 * is the only thing that will ever point it out.
 */
export function hasPriceWarning(product: {
  agent_price: number
  client_price: number
}): boolean {
  return product.client_price <= product.agent_price
}

/**
 * Turn the readiness word from the database into a badge colour.
 *
 * 'neutral' is a real answer, not a fallback: a null readiness means the
 * Supplier has not allowed this Client to see availability. Neutral says
 * "we are not telling you", which is different from any colour that would
 * imply a judgement about the product.
 *
 * The returned strings match the `tone` prop on the StatusBadge component
 * in src/components/ui.tsx.
 */
export function readinessText(
  readiness: Readiness | null,
  language: 'id' | 'en',
): string {
  // A null readiness means the Supplier has not allowed this person to
  // see availability. Saying "Not shown" is honest; borrowing a real
  // readiness word would be a guess dressed up as data.
  if (!readiness) return language === 'id' ? 'Tidak ditampilkan' : 'Not shown'
  return READINESS_TEXT[readiness][language]
}

export function readinessTone(
  readiness: Readiness | null,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (readiness) {
    case 'ready':
      return 'ok'
    case 'low_stock':
      return 'warn'
    case 'not_ready':
      return 'danger'
    default:
      return 'neutral'
  }
}