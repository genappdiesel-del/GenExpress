// ===================================================================
// Super Admin: the account list
// ===================================================================
// Who is in the system, and switching anyone off.
//
// WHY DEACTIVATING IS THE ONLY REMOVAL
//
// Nobody is ever deleted. If somebody leaves the business, their orders
// and history have to survive, because a business that keeps records for
// tax cannot throw them away when a person changes job. So "off" means
// they cannot sign in and their access ends, while their history stays
// exactly where it is.
//
// WHY THIS PAGE IS SUPER ADMIN ONLY
//
// Two reasons. The list shows everybody at once, across all Suppliers,
// which is nobody else's business. And the button that switches an
// account off is guarded in the database as well, so even somebody who
// typed this page's address by hand would be refused. The screen keeps
// them from trying; the database stops them.
//
// WHY THE CREATE BUTTON LIVES HERE
//
// Because the person creating accounts is the one who should decide who
// they are. It opens a form on this page rather than jumping away, so
// they come back to the list they were looking at and see the new person
// on it.
// ===================================================================

import { useEffect, useState } from 'react'

import { CreateUserForm } from '../../components/accounts/CreateUserForm'
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
} from '../../components/ui'
import { formatDate } from '../../i18n'
import { listAccounts, setAccountActive, type Result } from '../../lib/accounts'
import type { AccountListRow, Profile, UserRole } from '../../types/database'

export interface SuperAdminAccountsProps {
  profile: Profile
  language: 'id' | 'en'
}

export function SuperAdminAccounts({
  profile,
  language,
}: SuperAdminAccountsProps) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title={t('Akun', 'Accounts')}
        subtitle={t(
          'Semua orang yang punya akses ke aplikasi ini.',
          'Everybody with access to this app.',
        )}
        action={
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setFormOpen(true)
            }}
            className="btn-primary px-3 text-sm"
          >
            <span aria-hidden="true">＋</span>
            <span className="hidden sm:inline">{t('Akun baru', 'New account')}</span>
          </button>
        }
      />

      {/* A confirmed action is said out loud, not left as a silent
          change. The person who pressed the button may not remember what
          they pressed ten seconds later. */}
      {notice && (
        <p
          className="mb-3 rounded-lg bg-ok-50 px-3 py-2 text-sm text-ok-700"
          role="status"
        >
          {notice}
        </p>
      )}

      {formOpen && (
        <div className="mb-4">
          <CreateUserForm
            caller={profile}
            // Empty here because the Super Admin's own list is the only
            // source of Supplier names, and it has not loaded yet. The
            // form tells them to create a supplier first if there are
            // none, rather than sending a form they cannot complete.
            suppliers={[]}
            language={language}
            onCancel={() => setFormOpen(false)}
            onCreated={(username) => {
              setFormOpen(false)
              setNotice(
                t(
                  `Akun "${username}" dibuat. Orang itu harus mengganti kata sandinya saat masuk pertama kali.`,
                  `Account "${username}" created. They must change their password the first time they sign in.`,
                ),
              )
            }}
          />
        </div>
      )}

      <AccountList
        key={`accounts:${formOpen}`}
        profile={profile}
        language={language}
        onChanged={(message) => setNotice(message)}
      />
    </>
  )
}

// ===================================================================
// The list
// ===================================================================
// Split out so it owns the data it loaded. It starts already loading,
// and changing a switch refreshes it without a page reload.
function AccountList({
  profile,
  language,
  onChanged,
}: {
  profile: Profile
  language: 'id' | 'en'
  onChanged: (message: string) => void
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<AccountListRow[]>([])
  const [retryToken, setRetryToken] = useState(0)
  // Which account is mid-switch, so only that row shows a spinner and the
  // other rows stay usable. One person's click should not freeze the
  // list for everybody.
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void listAccounts().then((result: Result<AccountListRow[]>) => {
      if (cancelled) return
      setLoading(false)

      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      setRows(result.data)
    })

    return () => {
      cancelled = true
    }
  }, [retryToken])

  async function toggleActive(account: AccountListRow) {
    if (busyId) return

    // Switching off is the direction that locks somebody out, so it asks
    // first. Switching on does not, because nobody is waiting outside
    // for a confirmation dialog to let them back in.
    if (account.is_active) {
      const confirmed = window.confirm(
        t(
          `Nonaktifkan akun "${account.full_name}"?\n\nOrang ini tidak akan bisa masuk lagi. Riwayat pesanannya tetap tersimpan.`,
          `Deactivate "${account.full_name}"?\n\nThey will not be able to sign in again. Their order history stays saved.`,
        ),
      )
      if (!confirmed) return
    }

    setBusyId(account.id)

    const result = await setAccountActive(account.id, !account.is_active)

    setBusyId(null)

    if (!result.ok) {
      setLoadError(result.error)
      return
    }

    // Read the list again rather than editing the row in place. The
    // database may have refused in a way that changes other things (a
    // trigger, a side effect), and a fresh read is the only version we
    // can be sure matches what is really stored.
    const refreshed = await listAccounts()

    if (refreshed.ok) {
      setRows(refreshed.data)
      onChanged(
        account.is_active
          ? t(
              `Akun "${account.full_name}" dinonaktifkan.`,
              `Account "${account.full_name}" deactivated.`,
            )
          : t(
              `Akun "${account.full_name}" diaktifkan kembali.`,
              `Account "${account.full_name}" reactivated.`,
            ),
      )
    }
  }

  if (loading) return <Loading label={t('Memuat akun...', 'Loading accounts...')} />

  if (loadError) {
    return (
      <ErrorState
        title={t('Gagal memuat akun', 'Could not load accounts')}
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
        title={t('Belum ada akun lain', 'No other accounts yet')}
        body={t(
          'Buat akun untuk pemasok, client, atau agent.',
          'Create an account for a supplier, client or agent.',
        )}
      />
    )
  }

  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        {t(`Total ${rows.length} akun`, `${rows.length} accounts in total`)}
      </p>

      <ul className="space-y-2">
        {rows.map((account) => {
          const isYou = account.id === profile.id

          return (
            <li key={account.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    {account.full_name}
                    {isYou && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {t('(anda)', '(you)')}
                      </span>
                    )}
                  </p>

                  <p className="truncate text-xs text-slate-500">
                    @{account.username}
                  </p>

                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                    <StatusBadge tone={roleTone(account.role)}>
                      {roleLabel(account.role, language)}
                    </StatusBadge>

                    {account.supplier_name && (
                      <span className="truncate">
                        {t('dari', 'from')} {account.supplier_name}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!account.is_active && (
                    <StatusBadge tone="danger">
                      {t('Nonaktif', 'Inactive')}
                    </StatusBadge>
                  )}

                  {account.must_change_password && account.is_active && (
                    <span className="text-xs text-warn-700">
                      {t('Ganti sandi', 'Must change password')}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-400">
                  {t('Bergabung', 'Joined')} {formatDate(account.created_at, language)}
                </span>

                {/* Nobody may switch off their own account. The database
                    refuses it, because otherwise the last administrator
                    could lock the whole system out with one tap. Saying
                    so here, and hiding the button, saves them a
                    pointless error. */}
                {!isYou && (
                  <button
                    type="button"
                    onClick={() => void toggleActive(account)}
                    disabled={busyId === account.id}
                    className={
                      account.is_active
                        ? 'btn-secondary px-3 py-1 text-xs text-danger-700'
                        : 'btn-secondary px-3 py-1 text-xs'
                    }
                  >
                    {busyId === account.id
                      ? t('Menyimpan...', 'Saving...')
                      : account.is_active
                        ? t('Nonaktifkan', 'Deactivate')
                        : t('Aktifkan', 'Reactivate')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ===================================================================
// Role wording and colours
// ===================================================================
function roleLabel(role: UserRole, language: 'id' | 'en'): string {
  switch (role) {
    case 'super_admin':
      return language === 'id' ? 'Super Admin' : 'Super Admin'
    case 'supplier':
      return language === 'id' ? 'Pemasok' : 'Supplier'
    case 'client':
      return 'Client'
    case 'agent':
      return 'Agent'
  }
}

function roleTone(role: UserRole): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (role) {
    // The platform owner is the most powerful role, so it gets the
    // strongest colour. Anyone can see this list is not one of theirs.
    case 'super_admin':
      return 'ok'
    case 'supplier':
      return 'warn'
    case 'client':
    case 'agent':
      return 'neutral'
  }
}