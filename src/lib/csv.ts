// ===================================================================
// Reading and writing CSV files, by hand
// ===================================================================
// Importing products is one of the two things a Supplier does most often
// after typing them in -- a shop with 400 items already listed in a
// spreadsheet should not have to type 400 rows.
//
// We parse it ourselves rather than pulling in a library. Two reasons:
// a CSV parser is about sixty lines, and the free libraries that do it
// are mostly aimed at files with hundreds of thousands of rows and
// bring edge cases we would then have to handle.
//
// WHAT A CSV IS, for anyone reading this later: a plain text file where
// each row is on its own line, and each value is separated by a comma.
// If a value itself contains a comma, it is wrapped in "double quotes",
// like "Sambal, extra hot". Inside those quotes a comma is just a comma
// and a "" means one literal quote character.
//
// The parser below handles exactly that, including quotes, commas inside
// quotes, and newlines inside quotes.
// ===================================================================

/** One parsed product row, with the problems found in it. */
export interface ParsedRow {
  /** 1-based line number in the original file, for the error message. */
  line: number
  values: Record<string, string>
  /** Non-empty when this row cannot be saved. */
  error?: string
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Problems with the file as a whole, e.g. a missing column. */
  fatal?: string
  /** Header names found in the file, for the "expected columns" message. */
  headers: string[]
}

/**
 * Split CSV text into rows of cells.
 * Exported separately because the labels page also writes CSV.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 byte order mark. Excel writes one when saving as CSV, and
  // it would otherwise become part of the first header name, so "name"
  // would never match and every row would report a missing column.
  const clean = text.replace(/^\uFEFF/, '')

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]

    if (inQuotes) {
      if (char === '"') {
        // Two quotes in a row inside a quoted value means one quote.
        if (clean[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      // Handle Windows (\r\n) and old Mac (\r) line endings. A lone \r must
      // not also be read as a second empty line.
      if (char === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  // Whatever is left over is the last row, if the file did not end on a
  // newline. Many editors do not add one.
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

/**
 * Turn CSV text into product rows, checking each one.
 *
 * The point of checking here rather than on save is that a 300-row file
 * with 4 mistakes should not fail 300 times. The person sees a list of
 * every bad line at once and fixes them in one pass.
 */
export function parseProductCsv(text: string, language: 'id' | 'en'): ParseResult {
  const rows = parseCsv(text)
  if (rows.length === 0) {
    return {
      rows: [],
      headers: [],
      fatal:
        language === 'id'
          ? 'File kosong. Tidak ada data untuk diimpor.'
          : 'The file is empty. There is nothing to import.',
    }
  }

  // Header names, lowercased so "Name", "name" and " NAME " all match.
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const column = (name: string) => headers.indexOf(name)

  const idCol = column('id')
  const nameCol = column('name')
  const skuCol = column('sku')
  const barcodeCol = column('barcode')
  const unitCol = column('unit')
  const descriptionCol = column('description')
  const agentPriceCol = column('agent_price')
  const clientPriceCol = column('client_price')
  const stockCol = column('stock_qty')
  const lowStockCol = column('low_stock_level')

  // "name" is the only genuinely required column. Everything else has a
  // sensible default, and the database enforces the rest.
  if (nameCol === -1) {
    return {
      rows: [],
      headers,
      fatal:
        language === 'id'
          ? 'Kolom "name" tidak ditemukan. Pastikan baris pertama berisi nama kolom, dan salah satunya "name".'
          : 'The "name" column is missing. The first row must list column names, including "name".',
    }
  }

  const out: ParsedRow[] = []

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    // Skip blank lines rather than reporting them as errors. A file
    // exported from a spreadsheet almost always ends with several.
    if (cells.every((c) => c.trim() === '')) continue

    const get = (index: number) =>
      index === -1 ? '' : (cells[index] ?? '').trim()

    const values: Record<string, string> = {
      id: get(idCol),
      name: get(nameCol),
      sku: get(skuCol),
      barcode: get(barcodeCol),
      unit: get(unitCol),
      description: get(descriptionCol),
      agent_price: get(agentPriceCol),
      client_price: get(clientPriceCol),
      stock_qty: get(stockCol),
      low_stock_level: get(lowStockCol),
    }

    out.push({ line: r + 1, values, error: validateProductRow(values, language) })
  }

  if (out.length === 0) {
    return {
      rows: [],
      headers,
      fatal:
        language === 'id'
          ? 'File tidak berisi data produk, hanya baris kosong.'
          : 'The file contains no product rows, only empty lines.',
    }
  }

  return { rows: out, headers }
}

/** Check one row. Returns an error sentence, or undefined if it is fine. */
function validateProductRow(
  values: Record<string, string>,
  language: 'id' | 'en',
): string | undefined {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  if (values.name === '') {
    return t('Nama produk kosong.', 'The product name is empty.')
  }

  if (values.name.length > 200) {
    return t('Nama produk terlalu panjang.', 'The product name is too long.')
  }

  // A price that is not a number is the most common spreadsheet mistake:
  // someone typed "Rp 55.000" instead of "55000".
  if (values.agent_price !== '' && !isNumeric(values.agent_price)) {
    return t(
      'Harga agent bukan angka. Gunakan angka saja, contoh: 55000',
      'The agent price is not a number. Use digits only, for example: 55000',
    )
  }

  if (values.client_price !== '' && !isNumeric(values.client_price)) {
    return t(
      'Harga client bukan angka. Gunakan angka saja, contoh: 62000',
      'The client price is not a number. Use digits only, for example: 62000',
    )
  }

  if (values.stock_qty !== '' && !isNumeric(values.stock_qty)) {
    return t(
      'Jumlah stok bukan angka.',
      'The stock quantity is not a number.',
    )
  }

  if (values.low_stock_level !== '' && !isNumeric(values.low_stock_level)) {
    return t(
      'Batas stok menipis bukan angka.',
      'The low stock level is not a number.',
    )
  }

  // The margin rule. A warning, not a block, for the same reason it is a
  // warning on the single-product form: a clearance price is legitimate
  // and the Supplier is the one who knows.
  const agent = Number.parseFloat(values.agent_price)
  const client = Number.parseFloat(values.client_price)
  if (
    values.agent_price !== '' &&
    values.client_price !== '' &&
    Number.isFinite(agent) &&
    Number.isFinite(client) &&
    client <= agent
  ) {
    return t(
      'Harga client harus lebih tinggi dari harga agent.',
      'The client price must be higher than the agent price.',
    )
  }

  return undefined
}

/** Accepts "55000", "55.000" and "55,000" -- people type whichever they
 *  saw last, and rejecting the others just causes support calls. */
function isNumeric(input: string): boolean {
  const cleaned = input.replace(/[,\s]/g, '')
  return cleaned !== '' && Number.isFinite(Number.parseFloat(cleaned))
}

/** Strip separators so "55.000" becomes 55000 before saving. */
export function cleanNumber(input: string): number {
  return Number.parseFloat(input.replace(/[,\s]/g, '')) || 0
}

/**
 * Build CSV text for the template the client downloads.
 *
 * Including one is worth the twenty lines: without it, the first import
 * fails because the person did not know the exact column names, and they
 * have to be told.
 */
export function productCsvTemplate(language: 'id' | 'en'): string {
  const header =
    language === 'id'
      ? 'id,name,sku,barcode,unit,description,agent_price,client_price,stock_qty,low_stock_level'
      : 'id,name,sku,barcode,unit,description,agent_price,client_price,stock_qty,low_stock_level'

  const example =
    language === 'id'
      ? [
          '',
          'Beras 5kg',
          'RICE5',
          '8991002101015',
          'sak',
          'Beras premium',
          '55000',
          '62000',
          '100',
          '10',
        ]
      : [
          '',
          'Rice 5kg',
          'RICE5',
          '8991002101015',
          'sack',
          'Premium rice',
          '55000',
          '62000',
          '100',
          '10',
        ]

  return `${header}\n${example.join(',')}\n`
}