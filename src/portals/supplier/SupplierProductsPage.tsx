// ===================================================================
// Supplier: the products screen
// ===================================================================
// The busiest screen in the app for a Supplier. It has to work on a phone
// held in one hand, in a warehouse, possibly with dust on it.
//
// WHAT IS ON THIS SCREEN
//   - a search box that filters as you type
//   - one product per row, showing both prices and the margin
//   - buttons to add, edit, change stock, import a spreadsheet, and
//     print labels
//   - one page of 20 at a time, never an endless list
//
// WHY 20 AT A TIME
//
// A Supplier with 2,000 products must not download 2,000 rows to look at
// the first screen of results. It would be slow on a warehouse
// connection and might fail outright. Twenty rows is about one
// screenful on a phone, and the count tells them there is more.
//
// WHY THE LIST IS A SEPARATE COMPONENT
//
// Because the loading state belongs to whatever actually loaded the rows.
// This parent holds the search box and the panels; the child holds the
// data and starts life already loading. Two things fall out of that:
//
//   1. No "set loading" line runs before the fetch, so there is no extra
//      render pass at the start of every page.
//
//   2. Changing page or search throws the old child away completely.
//      React discards its state, so a slow response for page 1 can never
//      land on top of page 2 and overwrite what the user is looking at.
//      With one shared component holding all three pieces of state, that
//      race is real and happens on a slow phone connection.
// ===================================================================

import { useEffect, useMemo, useState } from 'react'

import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
} from '../../components/ui'
import { BarcodeLabels } from '../../components/supplier/BarcodeLabels'
import { CsvImport } from '../../components/supplier/CsvImport'
import { ProductForm } from '../../components/supplier/ProductForm'
import { StockAdjust } from '../../components/supplier/StockAdjust'
import { formatMoney, formatQty } from '../../lib/money'
import {
  getSupplierSettings,
  hasPriceWarning,
  listSupplierProducts,
  marginOf,
} from '../../lib/products'
import type { Currency, ProductRow } from '../../types/database'

/** Rows per page. A screenful on a phone. */
const PAGE_SIZE = 20

export interface SupplierProductsProps {
  supplierId: string
  language: 'id' | 'en'
}

export function SupplierProducts({ supplierId, language }: SupplierProductsProps) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)

  const [currency, setCurrency] = useState<Currency>('IDR')
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [stockFor, setStockFor] = useState<ProductRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Bumped after a save to make the list fetch again. It is part of the
  // child's key, so changing it rebuilds the child, which reloads. This
  // is the way a parent asks a keyed child to refresh, without either
  // side knowing anything about the other's internals.
  const [refreshToken, setRefreshToken] = useState(0)
  const refresh = () => setRefreshToken((n) => n + 1)

  // Wait a moment after typing before searching. Without this, every
  // keystroke sends a request, and on a slow connection several arrive
  // out of order and the list flickers between results.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      // A new search always starts at the first page. Staying on page 4
      // of a result that now has two pages would show an empty list with
      // no obvious way back.
      setPage(0)
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  // Currency comes from the Supplier's settings and affects every price
  // on this screen, so it is read once and kept.
  useEffect(() => {
    let cancelled = false
    void getSupplierSettings().then((result) => {
      if (cancelled) return
      if (result.ok) setCurrency(result.data.currency)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(product: ProductRow) {
    setEditing(product)
    setFormOpen(true)
  }

  return (
    <>
      <PageHeader
        title={t('Produk', 'Products')}
        action={
          <button type="button" onClick={openNew} className="btn-primary px-3 text-sm">
            <span aria-hidden="true">＋</span>
            <span className="hidden sm:inline">{t('Tambah', 'Add')}</span>
          </button>
        }
      />

      {/* --- Search ------------------------------------------------- */}
      <div className="mb-3">
        <label className="sr-only" htmlFor="product-search">
          {t('Cari produk', 'Search products')}
        </label>
        <input
          id="product-search"
          className="field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Cari nama, kode, atau barcode', 'Search name, code, or barcode')}
        />
      </div>

      {/* --- Tools ------------------------------------------------- */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="btn-secondary w-full text-sm"
        >
          <span aria-hidden="true">📥</span>
          {t('Impor CSV', 'Import CSV')}
        </button>
      </div>

      <ProductListBody
        // Anything that changes what the list should show goes in the
        // key. Change it and this component is thrown away and rebuilt,
        // which is what cancels an in-flight request for the old page.
        key={`${debouncedSearch}|${page}|${refreshToken}`}
        search={debouncedSearch}
        page={page}
        currency={currency}
        language={language}
        onEdit={openEdit}
        onAdjustStock={setStockFor}
        onGoToPage={setPage}
      />

      {/* --- Full-screen panels ------------------------------------ */}

      {formOpen && (
        <ProductForm
          // The key is what makes this form safe to reuse. Changing it
          // makes React discard the old form and build a new one with the
          // new product's values, so there is never a moment where the
          // form shows one product's details while editing another.
          key={editing?.id ?? 'new'}
          product={editing}
          supplierId={supplierId}
          currency={currency}
          language={language}
          onCancel={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSaved={() => {
            setFormOpen(false)
            setEditing(null)
            refresh()
          }}
        />
      )}

      {stockFor && (
        <StockAdjust
          key={stockFor.id}
          product={stockFor}
          language={language}
          onClose={() => setStockFor(null)}
          onSaved={() => {
            setStockFor(null)
            refresh()
          }}
        />
      )}

      {importOpen && (
        <CsvImport
          language={language}
          onCancel={() => setImportOpen(false)}
          onImported={() => refresh()}
        />
      )}
    </>
  )
}

// ===================================================================
// The list itself: loads one page and draws it
// ===================================================================

function ProductListBody({
  search,
  page,
  currency,
  language,
  onEdit,
  onAdjustStock,
  onGoToPage,
}: {
  search: string
  page: number
  currency: Currency
  language: 'id' | 'en'
  onEdit: (product: ProductRow) => void
  onAdjustStock: (product: ProductRow) => void
  onGoToPage: (page: number) => void
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  // This component is created fresh for every search term and page, so it
  // starts already loading. There is no window in which it looks empty
  // while it is actually asking for data.
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  // Which products to show labels for. Held here because it must survive
  // opening the label screen without refetching the list.
  const [labelSource, setLabelSource] = useState<ProductRow[]>([])
  const [labelsOpen, setLabelsOpen] = useState(false)
  // Bumped by the "Try again" button. It is in the fetch effect's
  // dependencies, so retrying runs the request again instead of reloading
  // the page -- which would throw away the search box and the scroll
  // position, and feel like the app had crashed.
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    // Set when this component is torn down or its inputs change, so a
    // response arriving after the user has moved on is discarded instead
    // of written into a component that no longer exists.
    let cancelled = false

    void listSupplierProducts({ search, page }).then((result) => {
      if (cancelled) return

      setLoading(false)

      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      // The query function returns AnyProduct because the same shape
      // serves the Client and Agent views. Here we know these are the
      // Supplier's own full product rows.
      const loaded = result.data.rows as ProductRow[]
      setRows(loaded)
      setTotal(result.data.total)
      setHasNextPage(result.data.hasNextPage)
      // Only offer labels for what is actually on screen, so the count on
      // the button always matches what gets printed.
      setLabelSource(loaded)
    })

    return () => {
      cancelled = true
    }
  }, [search, page, retryToken])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1
  const rangeEnd = Math.min(total, page * PAGE_SIZE + rows.length)

  const labelCount = useMemo(
    () => labelSource.filter((p) => p.barcode && p.barcode.trim() !== '').length,
    [labelSource],
  )

  // --- The three states every list must handle -----------------------
  if (loading) {
    return <Loading label={t('Memuat produk...', 'Loading products...')} />
  }

  if (loadError) {
    return (
      <ErrorState
        title={t('Gagal memuat produk', 'Could not load products')}
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
        title={
          search
            ? t('Produk tidak ditemukan', 'No products found')
            : t('Belum ada produk', 'No products yet')
        }
        body={
          search
            ? t(
                `Tidak ada produk yang namanya mengandung "${search}".`,
                `No product contains "${search}".`,
              )
            : t(
                'Tambahkan produk pertama Anda, atau impor dari file CSV yang sudah Anda punya.',
                'Add your first product, or import from a CSV file you already have.',
              )
        }
      />
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {t(
            `Menampilkan ${rangeStart}-${rangeEnd} dari ${total}`,
            `Showing ${rangeStart}-${rangeEnd} of ${total}`,
          )}
        </p>
        <button
          type="button"
          onClick={() => setLabelsOpen(true)}
          disabled={labelCount === 0}
          className="btn-secondary px-3 text-sm"
        >
          <span aria-hidden="true">🏷️</span>
          {t('Cetak label', 'Print labels')}
          {labelCount > 0 && <span className="text-slate-500">({labelCount})</span>}
        </button>
      </div>

      <ul className="space-y-2">
        {rows.map((product) => (
          <ProductRowCard
            key={product.id}
            product={product}
            currency={currency}
            language={language}
            onEdit={() => onEdit(product)}
            onAdjustStock={() => onAdjustStock(product)}
          />
        ))}
      </ul>

      {pageCount > 1 && (
        <nav
          className="mt-4 flex items-center justify-between gap-3"
          aria-label={t('Halaman produk', 'Product pages')}
        >
          <button
            type="button"
            onClick={() => onGoToPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="btn-secondary px-3 text-sm"
          >
            ← {t('Sebelumnya', 'Previous')}
          </button>

          <span className="text-sm text-slate-500">
            {t(`Halaman ${page + 1} / ${pageCount}`, `Page ${page + 1} of ${pageCount}`)}
          </span>

          <button
            type="button"
            onClick={() => onGoToPage(page + 1)}
            disabled={!hasNextPage}
            className="btn-secondary px-3 text-sm"
          >
            {t('Berikutnya', 'Next')} →
          </button>
        </nav>
      )}

      {labelsOpen && (
        <BarcodeLabels
          products={labelSource}
          currencyLabel={currency === 'IDR' ? 'Rp' : currency}
          language={language}
          onClose={() => setLabelsOpen(false)}
        />
      )}
    </>
  )
}

// ===================================================================
// One product in the list
// ===================================================================
function ProductRowCard({
  product,
  currency,
  language,
  onEdit,
  onAdjustStock,
}: {
  product: ProductRow
  currency: Currency
  language: 'id' | 'en'
  onEdit: () => void
  onAdjustStock: () => void
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const margin = marginOf(product)
  const warn = hasPriceWarning(product)
  const lowStock =
    product.low_stock_level > 0 && product.stock_qty <= product.low_stock_level

  return (
    <li className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{product.name}</p>

          {product.sku && (
            <p className="truncate text-xs text-slate-500">
              {t('Kode', 'Code')}: {product.sku}
            </p>
          )}

          {product.barcode && (
            <p className="truncate font-mono text-xs text-slate-400">{product.barcode}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {!product.is_active && (
            <StatusBadge tone="neutral">{t('Nonaktif', 'Inactive')}</StatusBadge>
          )}
          {lowStock && (
            <StatusBadge tone={product.stock_qty <= 0 ? 'danger' : 'warn'}>
              {product.stock_qty <= 0
                ? t('Stok habis', 'Out of stock')
                : t('Stok menipis', 'Low stock')}
            </StatusBadge>
          )}
        </div>
      </div>

      {/* --- Prices and margin ------------------------------------- */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-sm">
        <div>
          <p className="text-xs text-slate-500">{t('Harga agent', 'Agent price')}</p>
          <p className="font-semibold text-slate-800">
            {formatMoney(product.agent_price, currency, language)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t('Harga client', 'Client price')}</p>
          <p className="font-semibold text-slate-800">
            {formatMoney(product.client_price, currency, language)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t('Margin', 'Margin')}</p>
          <p className={`font-semibold ${warn ? 'text-warn-700' : 'text-ok-700'}`}>
            {formatMoney(margin.units, currency, language)}
          </p>
          {margin.percent > 0 && (
            <p className="text-xs text-slate-400">{margin.percent.toFixed(1)}%</p>
          )}
        </div>
      </div>

      {warn && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warn-700">
          <span aria-hidden="true">⚠️</span>
          {t(
            'Harga client tidak lebih tinggi dari harga agent.',
            'The client price is not higher than the agent price.',
          )}
        </p>
      )}

      {/* --- Stock ------------------------------------------------- */}
      <p className="mt-2 text-xs text-slate-500">
        {t('Stok', 'Stock')}:{' '}
        <span
          className={`font-semibold ${
            product.stock_qty <= 0
              ? 'text-danger-700'
              : lowStock
                ? 'text-warn-700'
                : 'text-slate-700'
          }`}
        >
          {formatQty(product.stock_qty, product.unit)}
        </span>
      </p>

      {/* --- Actions ----------------------------------------------- */}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onAdjustStock} className="btn-secondary flex-1 text-sm">
          {t('Ubah stok', 'Adjust stock')}
        </button>
        <button type="button" onClick={onEdit} className="btn-secondary flex-1 text-sm">
          {t('Ubah', 'Edit')}
        </button>
      </div>
    </li>
  )
}