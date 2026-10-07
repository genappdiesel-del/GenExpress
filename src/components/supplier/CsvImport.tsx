// ===================================================================
// Importing products from a spreadsheet
// ===================================================================
// WHY THIS SCREEN EXISTS
//
// A Supplier with 300 products already has them in a spreadsheet or in
// their old system. Making them type all 300 by hand is the single
// biggest reason a shop owner gives up on a new app in week one. So we
// meet them where their data already is.
//
// THE IMPORTANT DESIGN CHOICE
//
// We do not just say "import failed". We read the whole file first, show
// every bad row at once, and only save the rows that are fine.
//
// The alternative -- saving until something breaks -- means a 300-row
// file with 4 mistakes fails 300 times, and the person cannot tell which
// 4 to fix. Showing all 4 first turns an afternoon into thirty seconds.
// ===================================================================

import { useRef, useState } from 'react'

import { StatusBadge, Loading } from '../ui'
import { cleanNumber, parseProductCsv, productCsvTemplate, type ParsedRow } from '../../lib/csv'
import { importProducts } from '../../lib/products'
import type { ProductInput } from '../../types/database'
import { makeT } from '../../i18n'

export interface CsvImportProps {
  language: 'id' | 'en'
  onCancel: () => void
  onImported: (count: number) => void
}

export function CsvImport({ language, onCancel, onImported }: CsvImportProps) {
  const t = makeT(language)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ saved: number; failed: number } | null>(null)

  const good = rows?.filter((r) => !r.error) ?? []
  const bad = rows?.filter((r) => r.error) ?? []

  async function handleFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setFatal(null)
    setReading(true)

    try {
      const text = await file.text()
      const parsed = parseProductCsv(text, language)
      setRows(parsed.rows)
      setFatal(parsed.fatal ?? null)
    } catch {
      setFatal(
        t(
          'File tidak bisa dibaca. Pastikan itu file CSV biasa (.csv).',
          'The file could not be read. Make sure it is a normal CSV file (.csv).',
        ),
      )
      setRows(null)
    } finally {
      setReading(false)
    }
  }

  async function handleImport() {
    if (good.length === 0) return
    setSaving(true)

    const items: ProductInput[] = good.map((r) => ({
      name: r.values.name,
      sku: r.values.sku || null,
      barcode: r.values.barcode || null,
      unit: r.values.unit || 'pcs',
      description: r.values.description || null,
      low_stock_level: cleanNumber(r.values.low_stock_level),
      agent_price: cleanNumber(r.values.agent_price),
      client_price: cleanNumber(r.values.client_price),
      is_active: true,
    }))

    const response = await importProducts(items)
    setSaving(false)

    if (response.ok) {
      setResult({ saved: response.data.saved, failed: response.data.failed.length })
      if (response.data.saved > 0) {
        // Refresh the list behind us but keep this screen open, so the
        // person sees the number they just imported.
        onImported(response.data.saved)
      }
    } else {
      setFatal(response.error)
    }
  }

  function downloadTemplate() {
    const text = productCsvTemplate(language)
    // A Blob in memory, turned into a file the browser downloads. No
    // server, no cost, works offline.
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = language === 'id' ? 'contoh-produk.csv' : 'product-template.csv'
    link.click()
    // Release the memory. Skipped on old browsers that lack the function.
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="truncate text-base font-bold text-slate-900">
          {t('Impor dari file CSV', 'Import from a CSV file')}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-slate-600"
        >
          {t('Tutup', 'Close')}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {result && (
          <div
            className="mb-4 rounded-lg border border-ok-600/30 bg-ok-50 p-4"
            role="status"
          >
            <p className="text-sm font-bold text-ok-700">
              {t(
                `${result.saved} produk berhasil diimpor`,
                `${result.saved} products imported`,
              )}
            </p>
            {result.failed > 0 && (
              <p className="mt-1 text-sm text-ok-700/80">
                {t(
                  `${result.failed} produk gagal dan tidak disimpan.`,
                  `${result.failed} products failed and were not saved.`,
                )}
              </p>
            )}
            <button type="button" onClick={onCancel} className="btn-secondary mt-3">
              {t('Selesai', 'Done')}
            </button>
          </div>
        )}

        {!rows && !result && (
          <>
            <div className="card space-y-3">
              <p className="text-sm text-slate-600">
                {t(
                  'Pilih file CSV dari komputer atau telepon Anda. Isi kolom "name" saja sudah cukup, sisanya boleh kosong.',
                  'Choose a CSV file from your computer or phone. Filling in the "name" column is enough; the rest may be left empty.',
                )}
              </p>

              <label className="btn-secondary w-full cursor-pointer">
                <span aria-hidden="true">📄</span>
                {t('Pilih file CSV', 'Choose a CSV file')}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
              </label>

              <button
                type="button"
                onClick={downloadTemplate}
                className="btn-secondary w-full"
              >
                <span aria-hidden="true">⬇️</span>
                {t('Unduh contoh file', 'Download a template file')}
              </button>

              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">
                  {t('Kolom apa saja yang dibutuhkan?', 'Which columns are needed?')}
                </summary>
                <ul className="mt-2 space-y-1 text-slate-600">
                  {(
                    language === 'id'
                      ? [
                          ['name', 'wajib: nama produk', 'required: the product name'],
                          ['sku', 'kode internal Anda', 'your own internal code'],
                          ['barcode', 'angka barcode, boleh kosong', 'barcode digits, may be empty'],
                          ['unit', 'pcs, sak, box. Default: pcs', 'pcs, sack, box. Default: pcs'],
                          ['description', 'keterangan singkat', 'a short note'],
                          ['agent_price', 'harga yang Anda bayar agent', 'the price you pay the agent'],
                          ['client_price', 'harga yang bayar client', 'the price the client pays'],
                          ['stock_qty', 'jumlah stok awal', 'the opening stock'],
                          ['low_stock_level', 'batas stok menipis. Default: 0', 'low stock warning level. Default: 0'],
                        ]
                      : [
                          ['name', 'required: the product name', 'required: the product name'],
                          ['sku', 'your own internal code', 'your own internal code'],
                          ['barcode', 'barcode digits, may be empty', 'barcode digits, may be empty'],
                          ['unit', 'pcs, sack, box. Default: pcs', 'pcs, sack, box. Default: pcs'],
                          ['description', 'a short note', 'a short note'],
                          ['agent_price', 'the price you pay the agent', 'the price you pay the agent'],
                          ['client_price', 'the price the client pays', 'the price the client pays'],
                          ['stock_qty', 'the opening stock', 'the opening stock'],
                          ['low_stock_level', 'low stock warning level. Default: 0', 'low stock warning level. Default: 0'],
                        ]
                  ).map(([col, desc]) => (
                    <li key={col}>
                      <code className="rounded bg-slate-100 px-1 text-xs">{col}</code>{' '}
                      <span className="text-xs">{desc}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {reading && <Loading label={t('Membaca file...', 'Reading the file...')} />}
          </>
        )}

        {fatal && (
          <div className="mb-4 rounded-lg border border-danger-600/30 bg-danger-50 p-4" role="alert">
            <p className="text-sm font-semibold text-danger-700">{fatal}</p>
          </div>
        )}

        {/* --- The preview ------------------------------------------ */}
        {rows && !result && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone="neutral">
                {t(`${fileName ?? 'File'}: ${good.length + bad.length} baris`, `${fileName ?? 'File'}: ${good.length + bad.length} rows`)}
              </StatusBadge>
              {good.length > 0 && (
                <StatusBadge tone="ok">
                  {t(`${good.length} siap`, `${good.length} ready`)}
                </StatusBadge>
              )}
              {bad.length > 0 && (
                <StatusBadge tone="danger">
                  {t(`${bad.length} bermasalah`, `${bad.length} with problems`)}
                </StatusBadge>
              )}
            </div>

            {bad.length > 0 && (
              <div className="mb-4 rounded-lg border border-danger-600/30 bg-danger-50 p-4">
                <p className="text-sm font-bold text-danger-700">
                  {t(
                    `${bad.length} baris tidak bisa diimpor`,
                    `${bad.length} rows cannot be imported`,
                  )}
                </p>
                <p className="mt-1 text-xs text-danger-700/80">
                  {t(
                    'Baris ini akan dilewati. Yang lain tetap bisa diimpor.',
                    'These rows will be skipped. The rest can still be imported.',
                  )}
                </p>
                <ul className="mt-3 space-y-2">
                  {bad.slice(0, 10).map((row) => (
                    <li key={row.line} className="text-xs">
                      <span className="font-semibold text-danger-700">
                        {t(`Baris ${row.line}`, `Line ${row.line}`)}
                      </span>
                      {row.values.name && (
                        <span className="text-danger-700/70"> — {row.values.name}</span>
                      )}
                      <span className="block text-danger-700/90">{row.error}</span>
                    </li>
                  ))}
                  {bad.length > 10 && (
                    <li className="text-xs text-danger-700/70">
                      {t(
                        `...dan ${bad.length - 10} baris lainnya.`,
                        `...and ${bad.length - 10} more.`,
                      )}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {good.length > 0 && (
              <>
                <p className="mb-2 text-sm font-semibold text-slate-700">
                  {t('Contoh baris yang akan diimpor:', 'A sample of what will be imported:')}
                </p>
                <ul className="mb-4 space-y-2">
                  {good.slice(0, 5).map((row) => (
                    <li key={row.line} className="card py-2 text-sm">
                      <span className="font-semibold text-slate-800">
                        {row.values.name}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {t('baris', 'line')} {row.line}
                      </span>
                      <div className="mt-1 text-xs text-slate-600">
                        {t('harga agent', 'agent price')} {row.values.agent_price || '0'}
                        {' · '}
                        {t('harga client', 'client price')} {row.values.client_price || '0'}
                        {row.values.barcode && (
                          <>
                            {' · '}
                            {row.values.barcode}
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                  {good.length > 5 && (
                    <li className="text-xs text-slate-500">
                      {t(`...dan ${good.length - 5} lainnya.`, `...and ${good.length - 5} more.`)}
                    </li>
                  )}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {!result && (
        <div className="flex gap-3 border-t border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            {t('Batal', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={good.length === 0 || saving}
            className="btn-primary flex-1"
          >
            {saving
              ? t('Mengimpor...', 'Importing...')
              : t(`Impor ${good.length} produk`, `Import ${good.length} products`)}
          </button>
        </div>
      )}
    </div>
  )
}