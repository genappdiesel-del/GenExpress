// ===================================================================
// Client: browse what is on offer
// ===================================================================
// This is the screen that proves the security design works.
//
// THE IMPORTANT PART
//
// This screen does NOT read the products table. It reads a VIEW called
// client_products_view, and that view was written in the database without
// an agent_price column at all. So there is nothing here to hide -- the
// Supplier's cost price does not exist in the data this screen receives,
// even if somebody rewrote this file tomorrow to ask for it.
//
// Two prices are kept in this business on purpose: what an Agent pays,
// and what a Client pays. The gap between them is the Supplier's profit.
// A Client who could see both would know every margin, and could go
// around the Supplier or demand a better price. That is why the hiding is
// done by the database and not by this screen.
//
// THREE THINGS THAT CAN BE SWITCHED OFF
//
// The Supplier decides, per Client, what this person may see:
//   - the prices       (can_view_prices)
//   - how much is in stock (can_view_stock)
//   - whether an item is ready to buy (can_view_readiness)
//
// When a permission is off the view returns NULL for those columns --
// not a zero, not a hidden number. The screen says plainly "not
// available". Showing a fake zero would be worse than showing nothing: a
// Client would think the item is free, or out of stock.
// ===================================================================

import { useEffect, useState } from 'react'

import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
} from '../../components/ui'
import {
  getProductPhotoUrl,
  listClientProducts,
  readinessText,
  readinessTone,
} from '../../lib/products'
import { formatMoney, formatQty } from '../../lib/money'
import type { ClientProductRow, Currency } from '../../types/database'

/** Rows per page. Matches the Supplier's setting default. */
const PAGE_SIZE = 20

export interface ClientCatalogProps {
  /**
   * The Supplier's currency.
   *
   * A Client cannot read supplier_settings -- that table belongs to the
   * Supplier. So this comes from the profile the auth hook already loaded,
   * which the database fills in for each role. Getting it wrong here
   * would show a price in the wrong currency symbol, so it is passed in
   * rather than guessed.
   */
  currency: Currency
  language: 'id' | 'en'
}

export function ClientCatalog({ currency, language }: ClientCatalogProps) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)

  // Wait a moment after typing, so a fast typist sends one request
  // instead of one per letter.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      // A new search always starts at page one. Staying on page 3 of a
      // search that now fits on one page would show an empty list.
      setPage(0)
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <>
      <PageHeader
        title={t('Katalog', 'Catalog')}
        subtitle={t(
          'Harga dan ketersediaan mengikuti pengaturan pemasok.',
          'Prices and availability follow what the supplier has allowed.',
        )}
      />

      <div className="mb-4">
        <label className="sr-only" htmlFor="catalog-search">
          {t('Cari produk', 'Search products')}
        </label>
        <input
          id="catalog-search"
          className="field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Cari nama produk', 'Search by product name')}
        />
      </div>

      <CatalogList
        // Anything that changes what should be shown goes in the key.
        // Change it and this component is discarded and rebuilt, which is
        // what stops a slow reply for page 1 landing on top of page 2.
        key={`${debouncedSearch}|${page}`}
        search={debouncedSearch}
        page={page}
        currency={currency}
        language={language}
        onGoToPage={setPage}
      />
    </>
  )
}

// ===================================================================
// The list: loads one page and draws it
// ===================================================================
//
// Split out from the search box above for the same reason as the
// Supplier's list: this component owns the data it loaded, so it starts
// life already loading, and changing the page discards the old instance
// completely. A slow reply for page 1 can then never land on top of
// page 2.
function CatalogList({
  search,
  page,
  currency,
  language,
  onGoToPage,
}: {
  search: string
  page: number
  currency: Currency
  language: 'id' | 'en'
  onGoToPage: (page: number) => void
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<ClientProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  // Bumped by "Try again" so a retry asks the database again instead of
  // reloading the page, which would lose the search box and the scroll
  // position.
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    // Set when this component is discarded, so a reply that arrives after
    // the user has moved on is dropped rather than written into a
    // component that no longer exists.
    let cancelled = false

    void listClientProducts({ search, page }).then((result) => {
      if (cancelled) return

      setLoading(false)

      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      // The query returns the shared AnyProduct shape so one function can
      // serve every role. The view we just read is the Client's, so these
      // rows are Client rows.
      setRows(result.data.rows as ClientProductRow[])
      setTotal(result.data.total)
      setHasNextPage(result.data.hasNextPage)
    })

    return () => {
      cancelled = true
    }
  }, [search, page, retryToken])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1
  const rangeEnd = Math.min(total, page * PAGE_SIZE + rows.length)

  // --- The three states every list must handle -----------------------

  if (loading) {
    return <Loading label={t('Memuat katalog...', 'Loading catalog...')} />
  }

  if (loadError) {
    return (
      <ErrorState
        title={t('Gagal memuat katalog', 'Could not load the catalog')}
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
            : t('Katalog masih kosong', 'The catalog is still empty')
        }
        body={
          search
            ? t(
                `Tidak ada produk yang namanya mengandung "${search}".`,
                `No product contains "${search}".`,
              )
            : t(
                'Pemasok Anda belum menambahkan produk. Silakan cek lagi nanti.',
                'Your supplier has not added any products yet. Please check again later.',
              )
        }
      />
    )
  }

  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        {t(
          `Menampilkan ${rangeStart}-${rangeEnd} dari ${total} produk`,
          `Showing ${rangeStart}-${rangeEnd} of ${total} products`,
        )}
      </p>

      <ul className="space-y-2">
        {rows.map((product) => (
          <CatalogCard
            key={product.id}
            product={product}
            currency={currency}
            language={language}
          />
        ))}
      </ul>

      {pageCount > 1 && (
        <nav
          className="mt-4 flex items-center justify-between gap-3"
          aria-label={t('Halaman katalog', 'Catalog pages')}
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
    </>
  )
}

// ===================================================================
// One product in the catalogue
// ===================================================================
function CatalogCard({
  product,
  currency,
  language,
}: {
  product: ClientProductRow
  currency: Currency
  language: 'id' | 'en'
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  // A null price means the Supplier has not allowed this Client to see
  // prices. That is different from a price of zero, and it is shown
  // differently: asking for a quote is a real next step, where "free"
  // would just be wrong.
  const priceHidden = product.client_price === null

  const stockHidden = product.stock_qty === null
  const readinessHidden = product.readiness === null

  return (
    <li className="card">
      <ProductPhoto product={product} language={language} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{product.name}</p>
          {product.description && (
            <p className="mt-0.5 text-sm text-slate-500">{product.description}</p>
          )}
        </div>

        {!readinessHidden && (
          <StatusBadge tone={readinessTone(product.readiness)}>
            {readinessText(product.readiness, language)}
          </StatusBadge>
        )}
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        {priceHidden ? (
          <p className="text-sm text-slate-500">
            {t(
              'Harga tidak ditampilkan. Hubungi pemasok untuk meminta penawaran.',
              'Price not shown. Ask the supplier for a quote.',
            )}
          </p>
        ) : (
          <p className="text-lg font-bold text-slate-900">
            {formatMoney(product.client_price as number, currency, language)}
            <span className="ml-1 text-sm font-normal text-slate-400">
              / {product.unit}
            </span>
          </p>
        )}

        {/* Stock and readiness are separate permissions. Showing one
            while the other is hidden is correct -- a Client allowed to
            see "ready to order" need not also see the exact count. */}
        {!stockHidden && (
          <p className="mt-1 text-xs text-slate-500">
            {t('Stok', 'Stock')}:{' '}
            <span className="font-semibold text-slate-700">
              {formatQty(product.stock_qty as number, product.unit)}
            </span>
          </p>
        )}
      </div>
    </li>
  )
}

// ===================================================================
// The photo
// ===================================================================
//
// Photos live in a private bucket, so each one needs a short-lived link.
// Fetching all of them while loading the list would mean a dozen
// round-trips and a page that jumps around as images arrive one by one,
// so each photo fetches its own link only once that card is on screen.
//
// There is no photo slot at all for a product without a photo, because
// most products have none. An empty grey box per row would be noise.
// Deciding that BEFORE any hook runs is also what keeps the hook list
// stable: the two kinds of product never share one component instance.
function ProductPhoto({
  product,
  language,
}: {
  product: ClientProductRow
  language: 'id' | 'en'
}) {
  if (!product.photo_path) return null
  return <SignedPhoto photoPath={product.photo_path} name={product.name} language={language} />
}

function SignedPhoto({
  photoPath,
  name,
  language,
}: {
  photoPath: string
  name: string
  language: 'id' | 'en'
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  // Starts as "still loading". There is no window in which this shows an
  // error before it has even asked for the link.
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  })

  useEffect(() => {
    // Set when this component goes away, so a late reply is dropped
    // instead of written into a component that no longer exists.
    let cancelled = false

    void getProductPhotoUrl(photoPath).then((signed) => {
      if (cancelled) return
      // A refusal here is normal. The Supplier may allow this Client to
      // see the product but not its picture, and we show a placeholder
      // rather than an error the Client cannot act on.
      setState({ url: signed, failed: !signed })
    })

    return () => {
      cancelled = true
    }
  }, [photoPath])

  return (
    <div className="mb-3">
      {state.url ? (
        <img
          src={state.url}
          alt={name}
          loading="lazy"
          decoding="async"
          // A fixed height keeps the list from jumping as images load.
          className="h-40 w-full rounded-lg border border-slate-100 bg-slate-50 object-cover"
        />
      ) : (
        <div
          className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400"
          // Only a placeholder that is still working is announced. A photo
          // that failed is decoration as far as a screen reader is
          // concerned, and announcing it would interrupt whatever the
          // person was actually reading.
          role={state.failed ? undefined : 'status'}
        >
          {state.failed
            ? t('Foto tidak dapat ditampilkan', 'Photo unavailable')
            : t('Memuat foto...', 'Loading photo...')}
        </div>
      )}
    </div>
  )
}

