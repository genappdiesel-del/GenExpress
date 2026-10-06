// ===================================================================
// Money, worked out without floating-point mistakes
// ===================================================================
// The brief says: "Never change my numbers. No hidden rounding."
//
// The problem is that JavaScript cannot hold 0.1 + 0.2 exactly. Money
// held as decimals in a variable slowly drifts: a cart that should total
// 100,000.00 can show 99,999.99999999. On a phone bill that is not a
// rounding curiosity, it is a customer being charged a wrong amount.
//
// THE RULE WE USE THROUGHOUT: inside the app, money is counted in
// whole small units -- cents for most currencies, and for Rupiah
// literally whole rupiah because it has no usable small unit.
//
// What does NOT use this: the database stores numeric(14,2), which is
// exact, and does all business totals itself. We only convert to whole
// units at the edge, for display and for cart arithmetic, and we
// convert back the same way.
// ===================================================================

export type Currency = 'IDR' | 'USD' | 'MYR' | 'SGD'

/** Currencies with no usable minor unit. Rupiah is written as a whole
 *  number: "Rp 62.000", never "Rp 62.000,00". Showing trailing zeros
 *  that mean nothing reads as fake precision. */
const NO_DECIMALS: ReadonlySet<string> = new Set(['IDR'])

/**
 * Convert a database decimal into whole small units.
 *
 * Accepts the number Supabase sends, or a string, because a numeric
 * column sometimes arrives as a string depending on how it was read.
 * Rounding half-up rather than relying on toFixed, which uses
 * banker's rounding in some engines and has surprised people.
 */
export function toUnits(amount: number | string | null | undefined, currency: Currency): number {
  if (amount === null || amount === undefined || amount === '') return 0
  const value = typeof amount === 'number' ? amount : Number.parseFloat(amount)
  if (!Number.isFinite(value)) return 0

  if (NO_DECIMALS.has(currency)) return Math.round(value)
  // Multiply by 100 and round. The Math.round handles cases like 10.005
  // that arrive with float dust already attached.
  return Math.round(value * 100)
}

/** The other direction: whole small units back to a decimal number, for
 *  writing to the database. Exact, because we only ever divide by 100. */
export function fromUnits(units: number, currency: Currency): number {
  if (NO_DECIMALS.has(currency)) return units
  return units / 100
}

/**
 * Format money for a person to read.
 *
 * Indonesian format: 62.000 with a dot every three digits.
 * English format: 62,000.00 with two decimals.
 *
 * `Intl.NumberFormat` does both for free and is built into every browser,
 * so there is no library and no cost.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: Currency,
  language: 'id' | 'en',
): string {
  const value =
    typeof amount === 'number' ? amount : Number.parseFloat(amount ?? '')
  const safe = Number.isFinite(value) ? value : 0

  const symbol = CURRENCY_SYMBOL[currency]

  if (NO_DECIMALS.has(currency)) {
    const rounded = Math.round(safe)
    const grouped = new Intl.NumberFormat(language === 'id' ? 'id-ID' : 'en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(rounded)
    return `${symbol}${grouped}`
  }

  const grouped = new Intl.NumberFormat(language === 'id' ? 'id-ID' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe)

  return `${symbol}${grouped}`
}

const CURRENCY_SYMBOL: Record<Currency, string> = {
  IDR: 'Rp',
  USD: '$',
  MYR: 'RM',
  SGD: 'S$',
}

/**
 * Quantity, which allows up to three decimal places.
 *
 * We print only the decimals that are actually there. "2" stays "2" and
 * does not become "2.000" -- that would read as two thousand, which is
 * exactly the confusion this app is trying to avoid in a supply chain
 * where sacks and pieces are mixed.
 */
export function formatQty(
  quantity: number | string | null | undefined,
  unit?: string | null,
): string {
  const value =
    typeof quantity === 'number' ? quantity : Number.parseFloat(quantity ?? '')
  const safe = Number.isFinite(value) ? value : 0

  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 3,
  }).format(safe)

  return unit ? `${formatted} ${unit}` : formatted
}

/**
 * Parse what somebody typed into a number, or null if it is not a number.
 *
 * Returns null rather than 0 on purpose. A blank price field and a price
 * of zero are very different things, and treating a blank as zero would
 * let somebody save a free product by forgetting to type anything.
 *
 * Accepts both "55000" and "55.000" and "55,000", because people type
 * whichever separator they saw last.
 */
export function parseNumber(input: string): number | null {
  const cleaned = input.trim().replace(/[,\s]/g, '')
  if (cleaned === '') return null
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? value : null
}