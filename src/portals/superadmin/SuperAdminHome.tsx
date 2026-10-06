// ===================================================================
// Super Admin portal
// ===================================================================
// The platform owner's view. In Phase 1 this is a shell with navigation in
// place and a different home screen from the other three roles, which is
// exactly what the Phase 1 test asks for:
//   "I can log in as each role and see a different home screen."
// ===================================================================

import type { Profile } from '../../types/database'
import { ComingSoon, PageHeader, StatusBadge } from '../../components/ui'
import { formatDate, type LanguageCode } from '../../i18n'

export function SuperAdminHome({
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
        subtitle={language === 'id' ? 'Super Admin' : 'Super Admin'}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone="ok">
          {language === 'id' ? 'Akses penuh' : 'Full access'}
        </StatusBadge>
        <span className="text-xs text-slate-500">
          {language === 'id' ? 'Bergabung' : 'Joined'} {formatDate(profile.created_at, language)}
        </span>
      </div>

      {/* Phase 1 deliberately shows no fake numbers. Real counts arrive in
          Phase 2, once there is real data to count. */}
      <ComingSoon
        label={
          language === 'id'
            ? 'Ringkasan, Suppliers, Clients, Agents, dan log audit dibangun pada tahap berikutnya.'
            : 'Dashboard, Suppliers, Clients, Agents and the audit log arrive in the next phase.'
        }
      />
    </div>
  )
}