// ===================================================================
// Supplier portal home
// ===================================================================
// The Supplier is the main working area of this app: they run the business.
// Phase 1 shows the shell and role identity. The cash-in / cash-out /
// profit dashboard arrives in Phase 3 once stock movements and payments
// exist to summarise.
// ===================================================================

import type { Profile } from '../../types/database'
import { ComingSoon, PageHeader } from '../../components/ui'
import type { LanguageCode } from '../../i18n'

export function SupplierHome({
  profile,
  language,
}: {
  profile: Profile
  language: LanguageCode
}) {
  return (
    <div>
      <PageHeader
        title={`${language === 'id' ? 'Selamat datang' : 'Welcome'}, ${profile.full_name}`}
        subtitle={language === 'id' ? 'Pemasok' : 'Supplier'}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: language === 'id' ? 'Uang masuk' : 'Cash in', value: '—', tone: 'text-ok-700' },
          { label: language === 'id' ? 'Uang keluar' : 'Cash out', value: '—', tone: 'text-danger-700' },
          { label: language === 'id' ? 'Permintaan Agen' : 'Agent requests', value: '—', tone: 'text-warn-700' },
          { label: language === 'id' ? 'Pesanan belum bayar' : 'Unpaid orders', value: '—', tone: 'text-warn-700' },
        ].map((item) => (
          // Dashes, not zeroes. We have no data yet, and showing 0 would
          // look like a real measurement.
          <div key={item.label} className="card">
            <p className="text-xs font-medium text-slate-500">{item.label}</p>
            <p className={`mt-1 text-xl font-bold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <ComingSoon
        label={
          language === 'id'
            ? 'Produk, permintaan agen, penerimaan barang, pesanan klien dan laporan dibangun pada tahap berikutnya.'
            : 'Products, agent requests, goods receiving, client orders and reports arrive in later phases.'
        }
      />
    </div>
  )
}