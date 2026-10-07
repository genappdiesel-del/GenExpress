// ===================================================================
// Barcode labels, ready to print
// ===================================================================
// A Supplier with 400 products needs to print 400 labels and stick them
// on 400 shelves. So the label page has to do three things well:
//
//   1. Print the barcode as SCANNABLE BARS, not as text. A label with
//      the number typed on it but no bars cannot be scanned, and the
//      whole point is scanning.
//   2. Fit the paper. A4 is what nearly every office printer takes.
//   3. Look the same in the browser and on paper. Everything meant only
//      for the screen is hidden with print-specific CSS, and everything
//      meant only for paper is hidden until printing.
//
// WHY A LIBRARY
//
// Turning digits into the pattern of black and white bars is not
// something to write by hand -- each barcode format has a published
// table of bar and space widths, and getting one wrong produces a
// barcode that looks fine and will not scan. JsBarcode is MIT licensed,
// free, and about 30 KB.
//
// THE ONE THING THAT MATTERS: size and height
//
// A barcode that is printed too small, or with bars too short, is the
// most common reason a scanner fails on a label that "looks right".
// The defaults below are deliberately generous: wide bars, tall height.
// ===================================================================

import { useEffect, useMemo, useRef, useState } from 'react'

import type { ProductRow } from '../../types/database'
import { makeT } from '../../i18n'

export interface BarcodeLabelsProps {
  products: ProductRow[]
  currencyLabel?: string
  language: 'id' | 'en'
  onClose: () => void
}

export function BarcodeLabels({
  products,
  currencyLabel = 'Rp',
  language,
  onClose,
}: BarcodeLabelsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [drawFailed, setDrawFailed] = useState<string | null>(null)

  const t = makeT(language)

  // Products that actually have a barcode. A product without one cannot
  // be labelled, and showing an empty box would just confuse.
  const labelable = useMemo(
    () => products.filter((p) => p.barcode && p.barcode.trim() !== ''),
    [products],
  )

  // The message shown if the barcodes cannot be drawn.
  //
  // Computed here, outside the effect, rather than inside it. The `t`
  // helper is rebuilt on every render, so using it inside the effect would
  // mean listing it as a dependency -- and that would restart the drawing
  // on every render, forever. Deriving the string here gives the effect
  // a stable value to depend on.
  const drawFailedMessage =
    language === 'id'
      ? 'Barcode tidak bisa digambar. Labels tetap bisa dicetak, tetapi angkanya saja.'
      : 'The barcodes could not be drawn. The labels will still print, but as numbers only.'

  // Draw every barcode once the list is on screen.
  useEffect(() => {
    if (!containerRef.current || labelable.length === 0) return

    let cancelled = false

    async function draw() {
      try {
        const JsBarcode = (await import('jsbarcode')).default
        if (cancelled || !containerRef.current) return

        const nodes = containerRef.current.querySelectorAll<SVGSVGElement>(
          '[data-barcode]',
        )

        for (const node of nodes) {
          const value = node.getAttribute('data-barcode')
          if (!value) continue
          try {
            JsBarcode(node, value, {
              format: 'auto',
              // Wide bars and a tall height. A scanner needs both, and
              // this is where labels fail quietly.
              width: 2,
              height: 60,
              // No text under the bars: the product name and price are
              // already printed underneath in a readable font, and the
              // built-in text at this width is too small to read.
              displayValue: false,
              margin: 0,
              background: '#ffffff',
              lineColor: '#000000',
            })
          } catch {
            // One unreadable barcode must not stop the other 399 labels
            // from printing. JsBarcode throws on some malformed codes.
          }
        }
      } catch {
        if (!cancelled) setDrawFailed(drawFailedMessage)
      }
    }

    void draw()
    return () => {
      cancelled = true
    }
  }, [labelable, drawFailedMessage])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      {/* This bar is for the screen only. It does not print. */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 print:hidden">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-slate-900">
            {t('Cetak label barcode', 'Print barcode labels')}
          </h2>
          <p className="text-sm text-slate-500">
            {t(
              `${labelable.length} label siap dicetak`,
              `${labelable.length} labels ready to print`,
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => window.print()} className="btn-primary min-h-11 px-4">
            {t('Cetak', 'Print')}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary min-h-11 px-4">
            {t('Tutup', 'Close')}
          </button>
        </div>
      </header>

      {drawFailed && (
        <div className="border-b border-warn-600/30 bg-warn-50 px-4 py-2 text-sm text-warn-700 print:hidden">
          {drawFailed}
        </div>
      )}

      {/* The printable area. print:hidden everywhere else means the phone
          or screen shows only labels; the printer gets only labels. */}
      <div className="flex-1 overflow-y-auto p-4">
        {labelable.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-base font-semibold text-slate-800">
              {t(
                'Belum ada produk yang punya barcode',
                'No products have a barcode yet',
              )}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
              {t(
                'Buka satu produk dan isi kolom barcode, lalu ulangi. Label hanya bisa dicetak untuk produk yang punya barcode.',
                'Open a product and fill in the barcode field, then come back. Labels can only be printed for products that have a barcode.',
              )}
            </p>
            <button type="button" onClick={onClose} className="btn-secondary mt-4">
              {t('Kembali ke produk', 'Back to products')}
            </button>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="grid grid-cols-2 gap-2 print:grid-cols-3 print:gap-0"
          >
            {labelable.map((product) => (
              <LabelCard
                key={product.id}
                product={product}
                currencyLabel={currencyLabel}
                language={language}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LabelCard({
  product,
  currencyLabel,
  language,
}: {
  product: ProductRow
  currencyLabel: string
  language: 'id' | 'en'
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  return (
    <div
      className="flex flex-col items-center break-inside-avoid border
                 border-slate-300 bg-white p-2 text-center
                 print:break-inside-avoid print:border-0 print:p-1"
    >
      {/* The product name, in a size that can be read from a shelf. */}
      <p className="line-clamp-2 text-xs font-bold leading-tight text-black">
        {product.name}
      </p>

      {/* The bars. JsBarcode fills this in. The element starts empty, so
          a printer that somehow gets the page before the drawing runs
          prints the number below rather than a blank space. */}
      <svg
        data-barcode={product.barcode ?? ''}
        className="my-1 h-[60px] w-full"
        role="img"
        aria-label={`Barcode ${product.barcode}`}
      />

      {/* The number in plain digits, always printed. This is what a
          person reads when the scanner fails, and what somebody types
          into the search box. */}
      <p className="font-mono text-[11px] tracking-wide text-black">
        {product.barcode}
      </p>

      <p className="mt-0.5 text-[11px] text-slate-700">
        {t('Harga', 'Price')}: {currencyLabel}
        {new Intl.NumberFormat(language === 'id' ? 'id-ID' : 'en-US').format(
          product.client_price,
        )}
      </p>
    </div>
  )
}