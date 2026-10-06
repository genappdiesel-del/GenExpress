// ===================================================================
// Agent portal home
// ===================================================================
// The prompt is explicit that this must be the simplest screen in the app:
// "Very simple, big buttons, works on cheap phones." So the shell here uses
// larger targets than the other portals and no dense tables.
// ===================================================================

import type { Profile } from '../../types/database'
import { ComingSoon, PageHeader } from '../../components/ui'
import type { LanguageCode } from '../../i18n'

export function AgentHome({
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
        subtitle={language === 'id' ? 'Agen' : 'Agent'}
      />

      <ComingSoon
        label={
          language === 'id'
            ? 'Target, permintaan barang dengan pindai kode, dana, dan pengiriman dibangun pada tahap berikutnya.'
            : 'Targets, barcode requests, funds and deliveries arrive in later phases.'
        }
      />
    </div>
  )
}