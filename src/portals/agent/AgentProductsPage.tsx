// ===================================================================
// Agent: look up a product
// ===================================================================
// The Agent's screen, and the second half of the security proof.
//
// WHAT IT DOES
//
// An Agent works from the shelf. They pick something up, and they need
// to know what it is and what it costs them. So the screen is built
// around one action: scan the barcode, or type it in.
//
// WHY THE AGENT CANNOT SEE THE CLIENT PRICE
//
// This screen reads agent_products_view. That view was written without a
// client_price column, so the number this page does not receive does not
// exist in what the browser was sent. An Agent who knew both prices would
// know the Supplier's margin on every line, and could use it to
// renegotiate or to sell around the Supplier. The hiding is done by the
// database, not by this file, so it cannot be undone by editing code.
//
// WHY THE AGENT ONLY SEES THEIR OWN SUPPLIER
//
// The view filters on current_supplier_id(). An Agent works for one
// Supplier and has no reason to see another's prices. Even if somebody
// guessed a product id from another Supplier, the view would filter the
// row out.
//
// WHY BOTH WAYS TO ENTER A CODE
//
// Cameras fail: no permission, a dark warehouse, a cheap phone, a
// scratched lens. An Agent who cannot scan must still be able to type
// 13 digits. The scanner is a shortcut, never the only way through.
// ===================================================================

import { useEffect, useState } from 'react'

import { BarcodeScanner } from '../../components/supplier/BarcodeScanner'
import { EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from '../../components/ui'
import { formatMoney, formatQty } from '../../lib/money'
import { listAgentProducts, readinessText, readinessTone } from '../../lib/products'
import type { AgentProductRow, Currency } from '../../types/database'

/** How many rows the "browse" list shows. An Agent is looking, not
 *  auditing, so a short list is plenty and keeps the phone quick. */
const BROWSE_LIMIT = 50

export interface AgentProductsProps {
  currency: Currency
  language: 'id' | 'en'
}

export function AgentProducts({ currency, language }: AgentProductsProps) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  // What the Agent is searching for: either a scanned barcode or
  // something typed. Both end up here, so there is one result area rather
  // than two that behave differently.
  const [code, setCode] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)

  // Set to true once the person has asked to look up a specific code. It
  // is a flag rather than a result list, because the list belongs to the
  // child component that fetches it. Keeping a copy here as well would be
  // two sources of truth for one fact, and they would disagree the moment
  // a fetch was retried.
  const [codeSearched, setCodeSearched] = useState(false)

  // Wait a moment after typing.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(timer)
  }, [search])

  // Typing a new name clears a previous scan result, so the old answer
  // does not sit above unrelated results and look current.
  function onSearchChange(value: string) {
    setSearch(value)
    // Typing a name replaces a code lookup, so the old answer does not
    // stay on screen above unrelated results looking current.
    if (value.trim() !== '') setCodeSearched(false)
  }

  // A scan is definitive: it replaces whatever was being typed.
  function onScanned(value: string) {
    setCode(value)
    setSearch('')
    setDebouncedSearch('')
    setCodeSearched(true)
    setScannerOpen(false)
  }

  function clearAll() {
    setCode('')
    setSearch('')
    setDebouncedSearch('')
    setCodeSearched(false)
  }

  /** Look up whatever code is in the box right now. */
  function submitCode() {
    // An empty box means "no lookup", so the browse list stays on screen
    // rather than showing "barcode not found" for something never asked.
    if (code.trim() === '') return
    setSearch('')
    setDebouncedSearch('')
    setCodeSearched(true)
  }

  return (
    <>
      <PageHeader
        title={t('Cari produk', 'Find a product')}
        subtitle={t(
          'Pindai barcode, atau ketik kodenya.',
          'Scan the barcode, or type the code.',
        )}
      />

      {/* --- Scan button ------------------------------------------- */}
      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        className="btn-primary mb-3 w-full py-4 text-base"
      >
        <span aria-hidden="true" className="text-xl">
          ▣
        </span>
        {t('Pindai barcode', 'Scan barcode')}
      </button>

      {scannerOpen && (
        <BarcodeScanner
          language={language}
          onClose={() => setScannerOpen(false)}
          onScan={onScanned}
        />
      )}

      {/* --- Code entry -------------------------------------------- */}
      <div className="mb-3">
        <label className="sr-only" htmlFor="agent-code">
          {t('Kode barcode', 'Barcode code')}
        </label>
        <div className="flex gap-2">
          <input
            id="agent-code"
            className="field flex-1 font-mono"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              // Editing the digits means the previous lookup is stale.
              setCodeSearched(false)
            }}
            onKeyDown={(e) => {
              // Enter looks the code up without reaching for the phone.
              // This is a real convenience for someone holding a scanner
              // in one hand, so it is worth the three lines.
              if (e.key === 'Enter') {
                e.preventDefault()
                submitCode()
              }
            }}
            placeholder={t('Ketik kode barcode', 'Type the barcode')}
            inputMode="numeric"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={submitCode}
            disabled={code.trim() === ''}
            className="btn-secondary px-4"
          >
            {t('Cari', 'Find')}
          </button>
        </div>
      </div>

      {/* --- Name search ------------------------------------------- */}
      <div className="mb-4">
        <label className="sr-only" htmlFor="agent-search">
          {t('Cari nama atau kode produk', 'Search by product name or code')}
        </label>
        <input
          id="agent-search"
          className="field"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('Atau cari berdasarkan nama', 'Or search by name')}
        />
      </div>

      {(code.trim() !== '' || search.trim() !== '') && (
        <button type="button" onClick={clearAll} className="btn-secondary mb-4 w-full text-sm">
          {t('Bersihkan pencarian', 'Clear search')}
        </button>
      )}

      {/* --- Results ------------------------------------------------ */}
      {codeSearched ? (
        // Keyed on the code so a new scan builds a fresh lookup, already
        // loading, rather than showing the previous answer for a frame.
        <CodeLookupResult
          key={`code:${code}`}
          code={code}
          currency={currency}
          language={language}
        />
      ) : search.trim() !== '' || debouncedSearch.trim() !== '' ? (
        <BrowseResult
          key={`browse:${debouncedSearch}`}
          search={debouncedSearch}
          currency={currency}
          language={language}
        />
      ) : (
        <EmptyState
          title={t('Belum ada pencarian', 'Nothing searched yet')}
          body={t(
            'Pindai barcode di atas, atau ketik nama produk untuk melihat daftar.',
            'Scan a barcode above, or type a product name to see the list.',
          )}
        />
      )}
    </>
  )
}

// ===================================================================
// Result of looking up one barcode
// ===================================================================
function CodeLookupResult({
  code,
  currency,
  language,
}: {
  code: string
  currency: Currency
  language: 'id' | 'en'
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)
  // Starts loading, with no rows. There is no window in which this shows
  // "barcode not found" before it has actually asked the database.
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<AgentProductRow[]>([])
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    // Set when this component is thrown away, so a late reply is dropped
    // rather than written into a component that no longer exists.
    let cancelled = false

    void listAgentProducts({ barcode: code }).then((answer) => {
      if (cancelled) return
      setLoading(false)
      if (!answer.ok) {
        setLoadError(answer.error)
        return
      }
      setRows(answer.data)
    })

    return () => {
      cancelled = true
    }
  }, [code, retryToken])

  if (loading) return <Loading label={t('Mencari...', 'Looking up...')} />

  if (loadError) {
    return (
      <ErrorState
        body={loadError}
        onRetry={() => {
          setLoadError(null)
          setLoading(true)
          setRetryToken((n) => n + 1)
        }}
        retryLabel={t('Coba lagi', 'Try again')}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('Barcode tidak ditemukan', 'Barcode not found')}
        body={t(
          `Tidak ada produk dengan kode "${code}". Periksa angkanya, atau pindai ulang.`,
          `No product has the code "${code}". Check the digits, or scan again.`,
        )}
      />
    )
  }

  // Normally exactly one row comes back. If a Supplier has somehow given
  // two products the same barcode, showing both is safer than picking
  // one, because picking one could bill the wrong price.
  return (
    <ul className="space-y-2">
      {rows.map((product) => (
        <AgentProductCard
          key={product.id}
          product={product}
          currency={currency}
          language={language}
          showBarcode
        />
      ))}
    </ul>
  )
}

// ===================================================================
// Result of searching by name
// ===================================================================
function BrowseResult({
  search,
  currency,
  language,
}: {
  search: string
  currency: Currency
  language: 'id' | 'en'
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<AgentProductRow[]>([])
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    void listAgentProducts({ search }).then((answer) => {
      if (cancelled) return
      setLoading(false)
      if (!answer.ok) {
        setLoadError(answer.error)
        return
      }
      setRows(answer.data)
    })

    return () => {
      cancelled = true
    }
  }, [search, retryToken])

  if (loading) return <Loading label={t('Memuat...', 'Loading...')} />

  if (loadError) {
    return (
      <ErrorState
        body={loadError}
        onRetry={() => {
          setLoadError(null)
          setLoading(true)
          setRetryToken((n) => n + 1)
        }}
        retryLabel={t('Coba lagi', 'Try again')}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('Produk tidak ditemukan', 'No products found')}
        body={t(
          `Tidak ada produk yang namanya mengandung "${search}".`,
          `No product contains "${search}".`,
        )}
      />
    )
  }

  return (
    <>
      <p className="mb-2 text-sm text-slate-500">
        {t(`Ditemukan ${rows.length} produk`, `${rows.length} products found`)}
      </p>
      <ul className="space-y-2">
        {rows.map((product) => (
          <AgentProductCard
            key={product.id}
            product={product}
            currency={currency}
            language={language}
          />
        ))}
      </ul>
      {rows.length >= BROWSE_LIMIT && (
        <p className="mt-3 text-xs text-slate-400">
          {t(
            'Menampilkan hasil pertama saja. Tambahkan huruf untuk mempersempit pencarian.',
            'Showing the first results only. Add more letters to narrow the search.',
          )}
        </p>
      )}
    </>
  )
}

// ===================================================================
// One product
// ===================================================================
function AgentProductCard({
  product,
  currency,
  language,
  showBarcode = false,
}: {
  product: AgentProductRow
  currency: Currency
  language: 'id' | 'en'
  showBarcode?: boolean
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  // The Agent's price is never hidden from the Agent. A null here would
  // mean the Supplier has not set a price, which is a real problem worth
  // showing as a problem rather than hiding.
  const noPrice = product.agent_price === null

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{product.name}</p>
          {showBarcode && product.barcode && (
            <p className="font-mono text-xs text-slate-400">{product.barcode}</p>
          )}
          {product.description && (
            <p className="mt-0.5 text-sm text-slate-500">{product.description}</p>
          )}
        </div>

        <StatusBadge tone={readinessTone(product.readiness)}>
          {readinessText(product.readiness, language)}
        </StatusBadge>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        {noPrice ? (
          <p className="text-sm text-warn-700">
            {t('Harga belum ditetapkan.', 'No price has been set yet.')}
          </p>
        ) : (
          <p className="text-lg font-bold text-slate-900">
            {formatMoney(product.agent_price as number, currency, language)}
            <span className="ml-1 text-sm font-normal text-slate-400">
              / {product.unit}
            </span>
          </p>
        )}

        {/* An Agent picking from a shelf cares how many are left: it is
            the difference between selling the item and apologising. */}
        <p className="mt-1 text-xs text-slate-500">
          {t('Stok', 'Stock')}:{' '}
          <span
            className={`font-semibold ${
              product.stock_qty <= 0
                ? 'text-danger-700'
                : product.stock_qty <= product.low_stock_level
                  ? 'text-warn-700'
                  : 'text-slate-700'
            }`}
          >
            {formatQty(product.stock_qty, product.unit)}
          </span>
        </p>
      </div>
    </li>
  )
}

