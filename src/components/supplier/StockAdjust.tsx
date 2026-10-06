// ===================================================================
// Changing how much stock a product has
// ===================================================================
// WHY THIS IS A SPECIAL SCREEN AND NOT A TEXT BOX ON THE PRODUCT
//
// A stock number with no explanation is a number nobody can check later.
// "We had 40" and "we have 40" look identical until something goes
// wrong, and then there is no way to find out whether the shelf was
// miscounted, a van broke down, or somebody typed 400 instead of 40.
//
// So every change asks two questions: how much, and why. The reason is
// not optional. The database records it either way, but a blank reason
// makes the log useless to the person who has to read it at 2am.
//
// The database does the arithmetic. This screen never changes the number
// itself; it asks the database to, and the database writes down why.
// ===================================================================

import { useState } from 'react'

import { NotSavedBanner, StatusBadge } from '../ui'
import { adjustStock } from '../../lib/products'
import { formatQty } from '../../lib/money'
import type { ProductRow, StockMovementReason } from '../../types/database'

export interface StockAdjustProps {
  product: ProductRow
  language: 'id' | 'en'
  onClose: () => void
  onSaved: (newStock: number) => void
}

/** Reasons a Supplier would change stock, in the order they happen most.
 *  Each one has a sentence, because "adjustment" on its own is jargon. */
const REASONS: Array<{
  value: StockMovementReason
  labelId: string
  labelEn: string
  helpId: string
  helpEn: string
}> = [
  {
    value: 'purchase',
    labelId: 'Pembelian',
    labelEn: 'Purchase',
    helpId: 'Barang masuk dari supplier',
    helpEn: 'Goods bought in',
  },
  {
    value: 'delivery_out',
    labelId: 'Pengiriman keluar',
    labelEn: 'Sent out',
    helpId: 'Barang dikirim ke Client atau Agent',
    helpEn: 'Goods sent to a Client or Agent',
  },
  {
    value: 'delivery_in',
    labelId: 'Retur masuk',
    labelEn: 'Returned',
    helpId: 'Barang kembali dari Client atau Agent',
    helpEn: 'Goods coming back',
  },
  {
    value: 'sale',
    labelId: 'Penjualan',
    labelEn: 'Sale',
    helpId: 'Barang terjual langsung',
    helpEn: 'Goods sold directly',
  },
  {
    value: 'adjustment',
    labelId: 'Koreksi hasil hitung',
    labelEn: 'Count correction',
    helpId: 'Hasil hitung fisik berbeda dari catatan',
    helpEn: 'The physical count did not match the record',
  },
]

export function StockAdjust({ product, language, onClose, onSaved }: StockAdjustProps) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [reason, setReason] = useState<StockMovementReason>('purchase')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Stock movements are split into "more" and "less" rather than a signed
  // number. Nobody types "-5" correctly on a phone keyboard, and a
  // missing minus sign would add 5 instead of removing it.
  const [direction, setDirection] = useState<'add' | 'remove'>('add')

  const parsed = Number.parseFloat(amount.replace(/[,\s]/g, ''))
  const validAmount = Number.isFinite(parsed) && parsed > 0

  // The stock after this change, shown before it is saved. Purely to let
  // the person check their arithmetic -- the database does the real sum.
  const projected = validAmount
    ? product.stock_qty + (direction === 'add' ? parsed : -parsed)
    : product.stock_qty

  async function handlePrimary() {
    setError(null)
    setBanner(null)

    if (!validAmount) {
      setError(
        t(
          'Masukkan jumlah yang lebih besar dari nol.',
          'Enter a number greater than zero.',
        ),
      )
      return
    }

    // Two taps, on purpose. The first shows what is about to happen and
    // the second does it. A stock change that is easy to make by accident
    // is a stock change somebody will make by accident.
    if (!confirming) {
      setConfirming(true)
      return
    }

    setSaving(true)
    const delta = direction === 'add' ? parsed : -parsed

    const result = await adjustStock({
      productId: product.id,
      delta,
      reason,
      note,
    })

    setSaving(false)

    if (result.ok) {
      // onSaved closes this screen.
      onSaved(result.data)
      return
    }

    // The change did not go through. Stay open with the number still in
    // the box so the person can correct one thing and try again, rather
    // than typing it all a second time.
    setBanner(result.error)
    setConfirming(false)
  }

  const selectedReason = REASONS.find((r) => r.value === reason)
  // "Count correction" is the one reason where the number can go either
  // way, so we stop guessing which way they meant.
  const reasonIsCount = reason === 'adjustment'

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="truncate text-base font-bold text-slate-900">
          {t('Ubah stok', 'Adjust stock')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-slate-600"
        >
          {t('Tutup', 'Close')}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="card mb-4">
          <p className="text-sm font-semibold text-slate-800">{product.name}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">{t('Stok saat ini', 'Current stock')}</span>
            <span className="text-lg font-bold text-slate-800">
              {formatQty(product.stock_qty, product.unit)}
            </span>
          </div>
        </div>

        {banner && (
          <div className="mb-4">
            <NotSavedBanner message={banner} onRetry={() => setConfirming(false)} />
          </div>
        )}

        <div className="space-y-4">
          {/* --- Direction ------------------------------------------- */}
          <div>
            <span className="label">{t('Stok bertambah atau berkurang?', 'Is stock going up or down?')}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setDirection('add')
                  setConfirming(false)
                }}
                className={`min-h-11 rounded-lg border font-semibold ${
                  direction === 'add'
                    ? 'border-ok-600 bg-ok-50 text-ok-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {t('Bertambah', 'Adding')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirection('remove')
                  setConfirming(false)
                }}
                className={`min-h-11 rounded-lg border font-semibold ${
                  direction === 'remove'
                    ? 'border-danger-600 bg-danger-50 text-danger-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {t('Berkurang', 'Removing')}
              </button>
            </div>
          </div>

          {/* --- Amount ---------------------------------------------- */}
          <div>
            <label className="label" htmlFor="stock-amount">
              {t('Jumlah', 'Amount')}
            </label>
            <input
              id="stock-amount"
              className="field"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setError(null)
                setConfirming(false)
              }}
              inputMode="decimal"
              placeholder="0"
            />
            <p className="mt-1 text-xs text-slate-500">{product.unit}</p>
            {error && (
              <p className="mt-1 text-xs font-medium text-danger-700" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* --- Reason ----------------------------------------------- */}
          <div>
            <span className="label">
              {t('Alasannya apa?', 'Why?')}
            </span>
            <div className="space-y-2">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    reason === r.value
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="stock-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => {
                      setReason(r.value)
                      setConfirming(false)
                    }}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">
                      {t(r.labelId, r.labelEn)}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t(r.helpId, r.helpEn)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* --- Note ------------------------------------------------- */}
          <div>
            <label className="label" htmlFor="stock-note">
              {t('Catatan (opsional)', 'Note (optional)')}
            </label>
            <input
              id="stock-note"
              className="field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder={t(
                'Contoh: van mogok di jalan',
                'Example: the van broke down on the road',
              )}
            />
          </div>

          {/* --- Confirmation ---------------------------------------- */}
          {confirming && validAmount && (
            <div
              className="rounded-lg border border-brand-600/30 bg-brand-50 p-4"
              role="alert"
            >
              <p className="text-sm font-bold text-brand-800">
                {t('Periksa sekali lagi', 'Check this once more')}
              </p>
              <p className="mt-1 text-sm text-brand-800">
                {direction === 'add'
                  ? t(
                      `Stok ${product.name} akan bertambah ${parsed} ${product.unit}, dari ${product.stock_qty} menjadi ${projected}.`,
                      `Stock of ${product.name} will go up by ${parsed} ${product.unit}, from ${product.stock_qty} to ${projected}.`,
                    )
                  : t(
                      `Stok ${product.name} akan berkurang ${parsed} ${product.unit}, dari ${product.stock_qty} menjadi ${projected}.`,
                      `Stock of ${product.name} will go down by ${parsed} ${product.unit}, from ${product.stock_qty} to ${projected}.`,
                    )}
              </p>
              <p className="mt-1 text-sm text-brand-800/80">
                {t('Alasan:', 'Reason:')}{' '}
                {selectedReason ? t(selectedReason.labelId, selectedReason.labelEn) : ''}
              </p>
              <p className="mt-2 text-xs text-brand-800/70">
                {t(
                  'Perubahan ini tidak bisa dihapus. Jika salah, buat koreksi baru.',
                  'This change cannot be deleted. If it is wrong, post a correcting entry.',
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {reasonIsCount && confirming && (
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-600">
            <StatusBadge tone="warn">{t('Koreksi', 'Correction')}</StatusBadge>
            {t(
              'Untuk koreksi hasil hitung, pastikan arahnya benar.',
              'For a count correction, check the direction is right.',
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void handlePrimary()}
          disabled={saving}
          className={`w-full ${confirming ? 'btn-primary' : 'btn-secondary'}`}
        >
          {saving
            ? t('Menyimpan...', 'Saving...')
            : confirming
              ? t('Ya, simpan perubahan', 'Yes, save this change')
              : t('Lanjutkan', 'Continue')}
        </button>
      </div>
    </div>
  )
}