// ===================================================================
// Client portal home
// ===================================================================
// A Client only ever sees what their Supplier has switched on for them.
// In Phase 1 the shell is enough to prove the role split.
// ===================================================================

import type { Profile } from '../../types/database'
import { ComingSoon, PageHeader } from '../../components/ui'
import type { LanguageCode } from '../../i18n'

export function ClientHome({
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
        subtitle={language === 'id' ? 'Klien' : 'Client'}
      />

      <div className="card mb-4">
        <p className="text-sm text-slate-600">
          {language === 'id'
            ? 'Fitur yang Anda lihat ditentukan oleh Supplier Anda.'
            : 'What you can see is decided by your Supplier.'}
        </p>
      </div>

      <ComingSoon
        label={
          language === 'id'
            ? 'Katalog produk, pemesanan, pembayaran dan laporan dibangun pada tahap berikutnya.'
            : 'Product catalog, ordering, payments and reports arrive in later phases.'
        }
      />
    </div>
  )
}