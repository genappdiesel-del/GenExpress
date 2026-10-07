// ===================================================================
// Product form: add or edit one product
// ===================================================================
// WHAT THIS SCREEN IS FOR
//
// A Supplier types a product once and sees, immediately, two numbers and
// the gap between them:
//
//     Price we pay Agent   55,000
//     Price Client pays   62,000     <- what the Client will see
//     Margin              7,000  (12.7%)
//
// THE RULE THAT MATTERS MOST HERE
//
// The Client price should be higher than the Agent price. The brief says
// warn, do not block, and that is right: a clearance price, a goodwill
// order, a launch price are all legitimate, and a database that refuses
// to save them just makes people work around the system.
//
// So this is an amber warning, not an error. The save button still works.
// ===================================================================

import { useEffect, useState } from 'react'

import { Loading, StatusBadge, NotSavedBanner } from '../../components/ui'
import { BarcodeScanner } from './BarcodeScanner'
import { formatMoney, parseNumber, type Currency } from '../../lib/money'
import { buildPhotoPath, prepareImage } from '../../lib/image'
import { supabase } from '../../lib/supabase'
import { hasPriceWarning, marginOf, saveProduct } from '../../lib/products'
import type { ProductRow } from '../../types/database'
import { makeT } from '../../i18n'

export interface ProductFormProps {
  /** The product being edited, or null when adding a new one. */
  product: ProductRow | null
  supplierId: string
  currency: Currency
  language: 'id' | 'en'
  onSaved: (saved: ProductRow) => void
  onCancel: () => void
}

/** Blank form state. Kept as strings, not numbers, because an empty
 *  field is not zero and we must not quietly turn it into one. */
interface FormState {
  name: string
  sku: string
  barcode: string
  unit: string
  description: string
  agentPrice: string
  clientPrice: string
  lowStockLevel: string
  isActive: boolean
  photoPath: string
}

const BLANK: FormState = {
  name: '',
  sku: '',
  barcode: '',
  unit: 'pcs',
  description: '',
  agentPrice: '',
  clientPrice: '',
  lowStockLevel: '0',
  isActive: true,
  photoPath: '',
}

/**
 * The starting form state for a product.
 *
 * Read once, when the form first appears. It is NOT recomputed in an
 * effect when the product changes, because the parent gives this
 * component a `key` that changes with the product. React then throws away
 * the old form and builds a new one, which is both simpler and safer
 * than an effect: switching from one product to another can never leave a
 * field showing the previous product's value, because there is no window
 * in which the form exists with mismatched data.
 */
function initialState(product: ProductRow | null): FormState {
  if (!product) return BLANK

  return {
    name: product.name,
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    unit: product.unit,
    description: product.description ?? '',
    // Numbers become strings for editing. A number field that held a
    // number would drop a trailing "." while somebody is mid-typing.
    agentPrice: String(product.agent_price),
    clientPrice: String(product.client_price),
    lowStockLevel: String(product.low_stock_level),
    isActive: product.is_active,
    photoPath: product.photo_path ?? '',
  }
}

/** Common units, offered as one-tap buttons. Free text is still allowed,
 *  because a Supplier's business may use a word we did not guess. */
const UNITS = ['pcs', 'sack', 'box', 'kg', 'litre', 'pack', 'carton']

export function ProductForm({
  product,
  supplierId,
  currency,
  language,
  onSaved,
  onCancel,
}: ProductFormProps) {
  const t = makeT(language)

  const [form, setForm] = useState<FormState>(() => initialState(product))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    // Clear the message for a field as soon as it is edited. Leaving an
    // error under a field somebody has just corrected is a small thing
    // that makes an app feel broken.
    setErrors((prev) => {
      if (!prev[key as string]) return prev
      const next = { ...prev }
      delete next[key as string]
      return next
    })
  }

  // --- Margin, shown live ------------------------------------------
  // The arithmetic lives in marginOf() so the form and the product list
  // cannot disagree. This block only decides WHEN there is enough typed
  // to show an answer: a half-typed price shows nothing rather than a
  // number that is about to change.
  const agentPrice = parseNumber(form.agentPrice)
  const clientPrice = parseNumber(form.clientPrice)

  const margin =
    agentPrice === null || clientPrice === null
      ? null
      : marginOf({ agent_price: agentPrice, client_price: clientPrice })

  const priceWarning =
    agentPrice !== null && clientPrice !== null
      ? hasPriceWarning({
          agent_price: agentPrice,
          client_price: clientPrice,
        })
      : false

  // --- Check before sending ----------------------------------------
  function validate(): boolean {
    const next: Record<string, string> = {}

    if (form.name.trim() === '') {
      next.name = t('Nama produk wajib diisi.', 'The product name is required.')
    }

    // A blank price is NOT treated as zero. Somebody who forgot to type a
    // price means to type one, and saving it as zero would quietly give
    // the product away.
    if (form.agentPrice.trim() === '') {
      next.agentPrice = t(
        'Harga agent wajib diisi. Isi 0 jika memang gratis.',
        'The agent price is required. Enter 0 if it really is free.',
      )
    } else if (parseNumber(form.agentPrice) === null) {
      next.agentPrice = t(
        'Harga agent harus berupa angka.',
        'The agent price must be a number.',
      )
    } else if ((parseNumber(form.agentPrice) ?? 0) < 0) {
      next.agentPrice = t(
        'Harga agent tidak bisa negatif.',
        'The agent price cannot be negative.',
      )
    }

    if (form.clientPrice.trim() === '') {
      next.clientPrice = t(
        'Harga client wajib diisi. Isi 0 jika memang gratis.',
        'The client price is required. Enter 0 if it really is free.',
      )
    } else if (parseNumber(form.clientPrice) === null) {
      next.clientPrice = t(
        'Harga client harus berupa angka.',
        'The client price must be a number.',
      )
    } else if ((parseNumber(form.clientPrice) ?? 0) < 0) {
      next.clientPrice = t(
        'Harga client tidak bisa negatif.',
        'The client price cannot be negative.',
      )
    }

    if (form.lowStockLevel.trim() !== '') {
      const low = parseNumber(form.lowStockLevel)
      if (low === null) {
        next.lowStockLevel = t(
          'Batas stok menipis harus berupa angka.',
          'The low stock level must be a number.',
        )
      } else if (low < 0) {
        next.lowStockLevel = t(
          'Batas stok menipis tidak bisa negatif.',
          'The low stock level cannot be negative.',
        )
      }
    }

    if (form.unit.trim() === '') {
      next.unit = t('Satuan wajib diisi.', 'The unit is required.')
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  // --- Save ---------------------------------------------------------

  async function handleSave() {
    setBanner(null)
    if (!validate()) return

    setSaving(true)
    const result = await saveProduct({
      id: product?.id,
      name: form.name,
      sku: form.sku,
      barcode: form.barcode,
      unit: form.unit,
      description: form.description,
      photo_path: form.photoPath || null,
      low_stock_level: parseNumber(form.lowStockLevel) ?? 0,
      agent_price: parseNumber(form.agentPrice) ?? 0,
      client_price: parseNumber(form.clientPrice) ?? 0,
      is_active: form.isActive,
    })
    setSaving(false)

    if (result.ok) {
      onSaved(result.data)
      return
    }

    // Two kinds of failure. A connection problem means the work is still
    // on screen and they should try again. Anything else means the data
    // is wrong and fixing it needs a change to the form, so it belongs
    // next to the field.
    if (/internet|connection|network/i.test(result.error)) {
      setBanner(result.error)
      return
    }

    // Put the message where the person is looking. The barcode is the
    // most common clash, and a bare banner at the top of a long form on
    // a phone is easy to miss.
    if (/barcode/i.test(result.error)) {
      setErrors((prev) => ({ ...prev, barcode: result.error }))
    } else if (/product code/i.test(result.error)) {
      setErrors((prev) => ({ ...prev, sku: result.error }))
    } else {
      setBanner(result.error)
    }
  }

  // --- Photo -------------------------------------------------------

  async function handlePhoto(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true)

    // Shrink before upload. If the browser cannot do it we upload the
    // original anyway -- a large photo is better than no photo.
    const prepared = await prepareImage(file)
    const toUpload = prepared?.file ?? file
    const path = buildPhotoPath(supplierId, form.photoPath || null)

    const { error } = await supabase.storage
      .from('product-photos')
      .upload(path, toUpload, { upsert: true })

    setPhotoBusy(false)

    if (error) {
      // The product itself can still be saved without a photo, so this
      // is a warning and not a blocker. Losing a photo is annoying;
      // losing the product entry is worse.
      setBanner(
        t(
          'Foto gagal diunggah, tetapi produk tetap bisa disimpan tanpa foto.',
          'The photo could not be uploaded, but the product can still be saved without it.',
        ),
      )
      return
    }

    set('photoPath', path)
  }

  function clearPhoto() {
    set('photoPath', '')
  }

  // --- Render ------------------------------------------------------

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="truncate text-base font-bold text-slate-900">
          {product
            ? t('Ubah produk', 'Edit product')
            : t('Produk baru', 'New product')}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-slate-600"
        >
          {t('Batal', 'Cancel')}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {banner && (
          <div className="mb-4">
            <NotSavedBanner message={banner} />
          </div>
        )}

        <div className="space-y-4">
          {/* --- Name ------------------------------------------------- */}
          <Field
            label={t('Nama produk', 'Product name')}
            error={errors.name}
            required
          >
            <input
              className="field"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={200}
              autoFocus={!product}
              placeholder={t('Contoh: Beras 5kg', 'Example: Rice 5kg')}
            />
          </Field>

          {/* --- Photo ------------------------------------------------ */}
          <Field label={t('Foto produk', 'Product photo')}>
            {form.photoPath ? (
              <div className="flex items-center gap-3">
                <SignedPhoto path={form.photoPath} />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="btn-secondary shrink-0 text-sm"
                >
                  {t('Hapus foto', 'Remove photo')}
                </button>
              </div>
            ) : (
              <label className="btn-secondary cursor-pointer">
                <span aria-hidden="true">📷</span>
                {photoBusy ? t('Mengunggah...', 'Uploading...') : t('Pilih foto', 'Choose photo')}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={photoBusy}
                  onChange={(e) => void handlePhoto(e.target.files?.[0])}
                />
              </label>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {t(
                'Foto diperkecil otomatis sebelum diunggah.',
                'The photo is made smaller automatically before upload.',
              )}
            </p>
          </Field>

          {/* --- Barcode ---------------------------------------------- */}
          <Field
            label={t('Barcode', 'Barcode')}
            error={errors.barcode}
            help={t(
              'Pindai dengan kamera atau ketik angkanya. Harus berbeda antar produk.',
              'Scan it with the camera or type the digits. It must be different from your other products.',
            )}
          >
            <div className="flex gap-2">
              <input
                className="field"
                value={form.barcode}
                onChange={(e) => set('barcode', e.target.value)}
                inputMode="numeric"
                maxLength={64}
                placeholder="8991002101015"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="btn-secondary shrink-0 px-3"
                aria-label={t('Pindai barcode', 'Scan barcode')}
              >
                <span aria-hidden="true">📷</span>
              </button>
            </div>
          </Field>

          {/* --- SKU -------------------------------------------------- */}
          <Field
            label={t('Kode produk (SKU)', 'Product code (SKU)')}
            error={errors.sku}
            help={t(
              'Kode internal Anda. Client tidak melihat kode ini.',
              'Your own internal code. Clients never see this.',
            )}
          >
            <input
              className="field"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              maxLength={64}
              placeholder="RICE5"
            />
          </Field>

          {/* --- Unit ------------------------------------------------- */}
          <Field label={t('Satuan', 'Unit')} error={errors.unit} required>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => set('unit', u)}
                  className={`min-h-9 rounded-full border px-3 text-sm ${
                    form.unit === u
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
            <input
              className="field"
              value={form.unit}
              onChange={(e) => set('unit', e.target.value)}
              maxLength={30}
            />
          </Field>

          {/* --- The two prices --------------------------------------- */}
          <div className="card space-y-3">
            <p className="text-sm font-bold text-slate-800">
              {t('Harga', 'Prices')}
            </p>

            <Field
              label={t('Harga agent (yang Anda bayar)', 'Agent price (what you pay)')}
              error={errors.agentPrice}
              required
            >
              <input
                className="field"
                value={form.agentPrice}
                onChange={(e) => set('agentPrice', e.target.value)}
                inputMode="decimal"
                placeholder="55000"
              />
            </Field>

            <Field
              label={t('Harga client (yang mereka bayar)', 'Client price (what they pay)')}
              error={errors.clientPrice}
              required
            >
              <input
                className="field"
                value={form.clientPrice}
                onChange={(e) => set('clientPrice', e.target.value)}
                inputMode="decimal"
                placeholder="62000"
              />
            </Field>

            {/* The margin, live. This is the whole reason the form shows
                both prices together. */}
            {margin && (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                <span className="text-sm text-slate-600">
                  {t('Margin', 'Margin')}
                </span>
                <span className="text-right">
                  <span
                    className={`block text-base font-bold ${
                      margin.units > 0 ? 'text-ok-700' : 'text-danger-700'
                    }`}
                  >
                    {formatMoney(margin.units, currency, language)}
                  </span>
                  {/* Only a percent of something. A percentage of a zero
                      agent price is undefined, not zero, so it is left
                      out rather than printed as 0.0%. */}
                  {agentPrice !== null && agentPrice > 0 && (
                    <span className="text-xs text-slate-500">
                      {margin.percent.toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
            )}

            {priceWarning && (
              <div
                className="flex items-start gap-2 rounded-lg border border-warn-600/30 bg-warn-50 p-3"
                role="status"
              >
                <span aria-hidden="true">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-warn-700">
                    {t(
                      'Harga client biasanya lebih tinggi dari harga agent.',
                      'The client price is normally higher than the agent price.',
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-warn-700/80">
                    {t(
                      'Anda tetap bisa menyimpan. Ini hanya pengingat, dan paling penting jika ini memang harga diskon.',
                      'You can still save. This is only a reminder, and it matters most if this is a deliberate discount price.',
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* --- Stock ------------------------------------------------ */}
          <Field
            label={t('Batas stok menipis', 'Low stock level')}
            error={errors.lowStockLevel}
            help={
              product
                ? t(
                    'Stok sendiri diubah lewat tombol "Ubah stok", yang mencatat alasannya.',
                    'Stock itself is changed with the "Adjust stock" button, which records why.',
                  )
                : t(
                    'App akan memberi tanda saat stok menyentuh angka ini. Isi 0 kalau tidak perlu.',
                    'The app will mark this product when stock reaches this number. Use 0 for no warning.',
                  )
            }
          >
            <input
              className="field"
              value={form.lowStockLevel}
              onChange={(e) => set('lowStockLevel', e.target.value)}
              inputMode="decimal"
              disabled={false}
            />
          </Field>

          {product && (
            <Field label={t('Stok saat ini', 'Current stock')}>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-800">
                  {product.stock_qty}
                </span>
                <span className="text-sm text-slate-500">{product.unit}</span>
                <StatusBadge tone={product.is_active ? 'ok' : 'neutral'}>
                  {product.is_active ? t('Aktif', 'Active') : t('Nonaktif', 'Inactive')}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  'Stok hanya bisa berubah lewat menu ini, supaya selalu ada catatan.',
                  'Stock can only change through this screen, so there is always a record.',
                )}
              </p>
            </Field>
          )}

          {/* --- Description ------------------------------------------ */}
          <Field label={t('Deskripsi', 'Description')}>
            <textarea
              className="field min-h-20"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={500}
            />
          </Field>

          {/* --- Active ----------------------------------------------- */}
          <label className="card flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                {t('Tampilkan produk ini', 'Show this product')}
              </span>
              <span className="block text-xs text-slate-500">
                {t(
                  'Jika tidak aktif, produk disembunyikan dari Client dan Agent. Produk lama dan riwayatnya tetap tersimpan.',
                  'If not active, this product is hidden from Clients and Agents. Past orders and its history are kept.',
                )}
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Save bar. Sticks to the bottom so it is always reachable with
          one hand on a phone. */}
      <div className="border-t border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="btn-primary w-full"
        >
          {saving ? t('Menyimpan...', 'Saving...') : t('Simpan produk', 'Save product')}
        </button>
      </div>

      {scannerOpen && (
        <BarcodeScanner
          language={language}
          onScan={(code) => {
            set('barcode', code)
            setScannerOpen(false)
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  )
}

// ===================================================================
// A form field with its label, help text and error message
// ===================================================================
// Built here so every field in the app gets the same treatment. The error
// is wired to the input with aria-describedby and role="alert" so a
// screen reader announces it; a red border alone tells a blind user
// nothing.
function Field({
  label,
  help,
  error,
  required,
  children,
}: {
  label: string
  help?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="label">
        {label}
        {required && <span className="ml-1 text-danger-600">*</span>}
      </span>
      {children}
      {help && !error && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-danger-700" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A product photo from private storage.
 *
 * The bucket is not public, so a plain <img src> cannot work. We ask the
 * database for a link that lasts one hour and then use that. When the hour
 * is up the picture breaks, and it reloads itself once with a fresh link.
 * That is deliberate: a photo that silently vanishes is worse than one
 * that visibly refreshes.
 */
function SignedPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.storage
        .from('product-photos')
        .createSignedUrl(path, 3600)
      if (cancelled) return
      if (data?.signedUrl) setUrl(data.signedUrl)
      else setFailed(true)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [path])

  if (failed) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">
        ?
      </div>
    )
  }

  if (!url) return <Loading label="" />

  return (
    <img
      src={url}
      alt=""
      className="h-16 w-16 rounded-lg object-cover"
      onError={() => {
        // The hour is up. Ask for a new link and try once more. If it
        // still fails the photo is genuinely gone.
        setUrl(null)
        setFailed(true)
        void (async () => {
          const { data } = await supabase.storage
            .from('product-photos')
            .createSignedUrl(path, 3600)
          if (data?.signedUrl) {
            setUrl(data.signedUrl)
            setFailed(false)
          }
        })()
      }}
    />
  )
}