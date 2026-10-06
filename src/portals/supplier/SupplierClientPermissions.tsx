// ===================================================================
// Supplier: what each Client is allowed to see
// ===================================================================
// Nine switches per Client, and this screen is where they are set.
//
// WHY THIS IS NOT IN THE ACCOUNT LIST
//
// Because it is a different job. The account list answers "is this
// person still here". This screen answers "what may this person see".
// Keeping them together would be like putting the front door lock and
// the light switches on the same plate: both are about the house, and
// mixing them makes both harder to use.
//
// WHY FOUR ARE ALREADY ON AND FIVE ARE OFF
//
// A new Client arrives with prices, stock, availability and ordering
// already allowed, because without those four the account shows an
// empty screen and the Supplier has to find them to fix it. Order
// history, payments and the three reports are off, because they reveal
// how busy the business is and what it charges other people.
//
// The split is a business decision, recorded in DECISIONS.md section
// 5.7. This screen does not change it; it only lets a Supplier change
// the per-Client overrides.
//
// WHAT HAPPENS WHEN A SWITCH IS FLIPPED
//
// It takes effect on the Client's very next screen load. There is no
// delay and no "please refresh", because the data comes straight from
// the database on every load and the database has the new value.
//
// WHY NOTHING IS SAVED BY HAND
//
// Each switch saves the moment it is flipped. A form with one big Save
// button would leave nine switches looking changed while none of them
// were, and the person would only find out after walking away.
//
// THE `key` ON THE PANEL
// ----------------------
// SwitchPanel is keyed on the Client's id, so choosing a different Client
// throws the old panel away and builds a new one, already loading. Without
// that key, the previous Client's values would sit under the new name for
// a moment -- long enough for somebody to read them and believe them.
// ===================================================================

import { useEffect, useState } from 'react'

import {
  ErrorState,
  Loading,
  PageHeader,
  StatusBadge,
} from '../../components/ui'
import { getClientFeatures, setClientFeature } from '../../lib/permissions'
import { listSupplierAccounts, type Result } from '../../lib/accounts'
import {
  CLIENT_FEATURE_FLAGS,
  type AccountListRow,
  type ClientFeatureFlags,
  type FeatureFlagKey,
} from '../../types/database'
import { makeT } from '../../i18n'

/** The nine switches, in the order a Supplier thinks about them: what
 *  they can see, what they can do, what history they can read. */
const FLAGS = CLIENT_FEATURE_FLAGS

export interface SupplierClientPermissionsProps {
  supplierId: string
  language: 'id' | 'en'
}

export function SupplierClientPermissions({
  supplierId,
  language,
}: SupplierClientPermissionsProps) {
  const t = makeT(language)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<AccountListRow[]>([])
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    void listSupplierAccounts(supplierId).then(
      (result: Result<AccountListRow[]>) => {
        if (cancelled) return
        setLoading(false)

        if (!result.ok) {
          setLoadError(result.error)
          return
        }

        // Only clients. An Agent has no settings of their own -- they are
        // given their permissions by the Supplier's pricing, not by
        // per-person switches.
        const onlyClients = result.data.filter(
          (account) => account.role === 'client',
        )

        setClients(onlyClients)

        // Open the first one by default, so the screen does not look
        // empty on arrival when there is somebody to show.
        setSelectedId((current) => {
          if (current && onlyClients.some((c) => c.id === current)) return current
          return onlyClients[0]?.id ?? null
        })
      },
    )

    return () => {
      cancelled = true
    }
  }, [supplierId, retryToken])

  if (loading) return <Loading label={t('Memuat Client...', 'Loading clients...')} />

  if (loadError) {
    return (
      <ErrorState
        title={t('Gagal memuat Client', 'Could not load clients')}
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

  if (clients.length === 0) {
    return (
      <>
        <PageHeader title={t('Izin Client', 'Client permissions')} />
        <p className="card text-sm text-slate-600">
          {t(
            'Belum ada Client. Buat akun Client terlebih dahulu.',
            'No clients yet. Create a client account first.',
          )}
        </p>
      </>
    )
  }

  const selected = clients.find((c) => c.id === selectedId) ?? clients[0]

  return (
    <>
      <PageHeader
        title={t('Izin Client', 'Client permissions')}
        subtitle={t(
          'Pilih Client, lalu nyalakan apa yang boleh dilihat.',
          'Pick a client, then switch on what they may see.',
        )}
      />

      {/* --- Pick a client ---------------------------------------- */}
      {/* A list of names rather than a dropdown: a Supplier with twenty
          clients cannot recognise "budi01" in a collapsed box, and this
          screen is used often enough to earn the space. */}
      <ul className="mb-4 space-y-1">
        {clients.map((client) => {
          const isSelected = client.id === selected.id

          return (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => setSelectedId(client.id)}
                aria-pressed={isSelected}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                  isSelected
                    ? 'border-primary-600 bg-primary-50 font-semibold'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <span className="truncate">{client.full_name}</span>
                {!client.is_active && (
                  <StatusBadge tone="danger">
                    {t('Nonaktif', 'Inactive')}
                  </StatusBadge>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <SwitchPanel
        // Keyed on the client, so switching client rebuilds the panel with
        // that person's values. Without it, a stale value could be shown
        // under the new name for a frame before the fetch lands.
        key={selected.id}
        client={selected}
        language={language}
      />
    </>
  )
}

// ===================================================================
// The nine switches for one Client
// ===================================================================
function SwitchPanel({
  client,
  language,
}: {
  client: AccountListRow
  language: 'id' | 'en'
}) {
  const t = (id: string, en: string) => (language === 'id' ? id : en)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [flags, setFlags] = useState<ClientFeatureFlags | null>(null)

  // Which switch is mid-save. Held per switch so one slow save does not
  // grey out the other eight.
  const [savingKey, setSavingKey] = useState<FeatureFlagKey | null>(null)
  const [failedKey, setFailedKey] = useState<FeatureFlagKey | null>(null)

  useEffect(() => {
    let cancelled = false

    void getClientFeatures(client.id).then(
      (result: Result<ClientFeatureFlags>) => {
        if (cancelled) return
        setLoading(false)

        if (!result.ok) {
          setLoadError(result.error)
          return
        }

        setFlags(result.data)
      },
    )

    return () => {
      cancelled = true
    }
  }, [client.id])

  async function flip(key: FeatureFlagKey, nextValue: boolean) {
    if (savingKey) return

    setSavingKey(key)
    setFailedKey(null)

    const result = await setClientFeature(client.id, { [key]: nextValue })

    setSavingKey(null)

    if (!result.ok) {
      // The switch is left where it was, not moved optimistically. A
      // switch that looks on but is off would be a lie about something
      // the Client depends on.
      setFailedKey(key)
      setLoadError(result.error)
      return
    }

    // Update from what the database now holds rather than from what was
    // asked for. If the database clamped or refused a value, the screen
    // tells the truth.
    setFlags(result.data)
  }

  if (loading) return <Loading label={t('Memuat izin...', 'Loading permissions...')} />

  if (loadError && !flags) {
    return (
      <ErrorState
        title={t('Gagal memuat izin', 'Could not load permissions')}
        body={loadError}
        retryLabel={t('Coba lagi', 'Try again')}
        onRetry={() => {
          setLoadError(null)
          setLoading(true)
        }}
      />
    )
  }

  if (!flags) return null

  return (
    <div className="card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            {client.full_name}
          </h2>
          <p className="truncate text-xs text-slate-500">
            {t('Level', 'Level')} {client.level}
          </p>
        </div>

        {/* How much this person can see, in one glance. Counting the
            switches is useful; reading nine of them is not. */}
        <StatusBadge
          tone={
            onCount(flags) === FLAGS.length
              ? 'ok'
              : onCount(flags) === 0
                ? 'neutral'
                : 'warn'
          }
        >
          {`${onCount(flags)}/${FLAGS.length}`}
        </StatusBadge>
      </div>

      {/* An error on one switch does not throw away the eight that are
          fine, so it sits above them rather than replacing the panel. */}
      {loadError && (
        <p className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
          {loadError}
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {FLAGS.map((flag) => {
          const checked = flags[flag.key]
          const isSaving = savingKey === flag.key
          const didFail = failedKey === flag.key

          return (
            <li key={flag.key} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <label
                  className="block text-sm font-medium text-slate-800"
                  htmlFor={`flag-${flag.key}`}
                >
                  {language === 'id' ? flag.labelId : flag.labelEn}
                </label>
                <p className="mt-0.5 text-xs text-slate-500">
                  {language === 'id' ? flag.helpId : flag.helpEn}
                </p>
              </div>

              {/*
                A real checkbox, not a styled div.
                That is what makes it work with a keyboard, be announced
                correctly by a screen reader, and be reachable by tapping.
                44px tall so it is a comfortable target on a phone.
              */}
              <input
                id={`flag-${flag.key}`}
                type="checkbox"
                checked={checked}
                disabled={isSaving}
                onChange={(e) => void flip(flag.key, e.target.checked)}
                aria-describedby={`flag-${flag.key}-status`}
                className="h-11 w-11 shrink-0 accent-primary-600"
              />

              {/* The saving and failed states are announced, because a
                  switch that quietly snaps back looks broken. */}
              <span
                id={`flag-${flag.key}-status`}
                className="sr-only"
                aria-live="polite"
              >
                {isSaving
                  ? t('Menyimpan', 'Saving')
                  : didFail
                    ? t('Gagal menyimpan', 'Could not save')
                    : checked
                      ? t('Aktif', 'On')
                      : t('Mati', 'Off')}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
        {t(
          'Setiap perubahan langsung berlaku. Client tidak perlu keluar-masuk.',
          'Each change takes effect straight away. The client does not need to sign out and back in.',
        )}
      </p>
    </div>
  )
}

/** How many of the nine are on. */
function onCount(flags: ClientFeatureFlags): number {
  return FLAGS.reduce(
    (total, flag) => total + (flags[flag.key] ? 1 : 0),
    0,
  )
}