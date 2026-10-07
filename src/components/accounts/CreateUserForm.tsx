// ===================================================================
// Creating an account, for a Super Admin or a Supplier
// ===================================================================
// One form for both, because the two differ only in which roles they may
// pick and whether they choose a Supplier. Splitting it into two nearly
// identical forms would mean fixing the same mistake in two places.
//
// WHO SEES THIS
//
//   - Super Admin: anybody, and picks which Supplier a Client or Agent
//     belongs to.
//   - Supplier: only a Client or an Agent, always their own. The form
//     does not even offer the choice, because the answer is already
//     decided and offering it would only invite the wrong click.
//   - Client or Agent: nobody. They are refused by the server function,
//     and the navigation never offers them this screen.
//
// THE LAST POINT MATTERS
//
// Hiding the screen is a convenience, not a security measure. The real
// check is in the server function, which reads who is asking from their
// signed-in session and ignores anything the form claims. Someone who
// edits the page in their browser's developer tools can call the
// function directly, and it will still refuse them.
// ===================================================================

import { useEffect, useState } from 'react'

import { NotSavedBanner } from '../ui'
import {
  checkUsername,
  createAccount,
  listTeam,
  passwordStrength,
  type FieldErrors,
  type NewAccount,
  type TeamMember,
} from '../../lib/accounts'
import type { Profile } from '../../types/database'
import { makeT } from '../../i18n'

/** The deepest level anybody may sit at. Matches the depth rule in
 *  supabase/migrations/014_supply_chain_levels.sql. A person at level 4
 *  is not offered as a manager, because the database would refuse them
 *  and a form that offers an impossible choice is a form that lies. */
const MAX_LEVELS = 4

export interface CreateUserFormProps {
  /** The person doing the creating. Decides which roles are offered. */
  caller: Profile
  /**
   * The Suppliers this Super Admin may assign people to.
   *
   * Empty for a Supplier, who can only ever use themselves. Read from a
   * list the Super Admin's screen already loaded, rather than fetched
   * again here: one list, one source of truth, and it cannot disagree
   * with itself.
   */
  suppliers: Array<{ id: string; name: string }>
  language: 'id' | 'en'
  onCancel: () => void
  onCreated: (username: string) => void
}

export function CreateUserForm({
  caller,
  suppliers,
  language,
  onCancel,
  onCreated,
}: CreateUserFormProps) {
  const t = makeT(language)

  const isSuperAdmin = caller.role === 'super_admin'

  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  // Defaulted to the only role this caller may pick, so the common case
  // needs no thought at all.
  const [role, setRole] = useState<NewAccount['role']>('client')
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')

  // ------------------------------------------------------------------
  // Who recruited this person
  // ------------------------------------------------------------------
  // Left empty, the new account sits at level 2 straight under the
  // Supplier. Choosing somebody makes it level 3 or 4.
  //
  // The list is loaded here rather than passed in, because a Super Admin
  // has to load the team of whichever Supplier they just picked in the
  // box above -- there is no single team to pass in advance.
  const [parentId, setParentId] = useState('')
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)

  // Which Supplier's team applies: the one the Super Admin picked, or the
  // caller's own. A Supplier never sends an id, the server uses theirs.
  const effectiveSupplierId =
    role === 'supplier' ? '' : isSuperAdmin ? supplierId : caller.id

  useEffect(() => {
    // A Supplier account has no manager and no team, so nothing to load.
    if (effectiveSupplierId === '') {
      setTeam(null)
      setTeamError(null)
      return
    }

    let cancelled = false
    setTeam(null)
    setTeamError(null)

    listTeam(effectiveSupplierId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setTeamError(result.error)
          return
        }
        setTeam(result.data)
      })
      .catch(() => {
        if (!cancelled) setTeamError(t('Gagal memuat daftar tim.', 'Could not load the team list.'))
      })

    return () => {
      cancelled = true
    }
    // t is rebuilt every render, so it must not be a dependency. The
    // message it produces does not depend on anything else here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSupplierId, language])

  // Anyone already chosen as somebody's manager must not suddenly become a
  // manager of somebody else too, so the box resets when the Supplier or
  // the role changes. Silently keeping a stale id would create the account
  // at the wrong level with no warning.
  useEffect(() => {
    setParentId('')
  }, [effectiveSupplierId, role])

  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const strength = passwordStrength(password)

  // Only people who can still have somebody under them. A Supplier
  // (level 1) counts, because that is exactly the level-2 default.
  const possibleManagers = (team ?? []).filter((m) => m.level < MAX_LEVELS)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return

    setBanner(null)

    // Check the fields we can check instantly, so the person is not made
    // to wait for a round trip to be told about a blank box.
    const nextErrors: FieldErrors = {}

    const usernameProblem = checkUsername(username)
    if (usernameProblem) nextErrors.username = t(usernameProblem, usernameProblem)

    if (fullName.trim().length < 2) {
      nextErrors.fullName = t('Masukkan nama lengkap', 'Enter the full name')
    }
    if (password.length < 8) {
      nextErrors.password = t(
        'Kata sandi minimal 8 karakter',
        'Password must be at least 8 characters',
      )
    }
    if (isSuperAdmin && role !== 'supplier' && supplierId === '') {
      nextErrors.supplierId = t(
        'Pilih pemasok untuk pengguna ini',
        'Choose a Supplier for this user',
      )
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setErrors({})
    setSaving(true)

    const result = await createAccount({
      username: username.trim(),
      password,
      fullName: fullName.trim(),
      role,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      // Only a Super Admin sends this. A Supplier leaves it out and the
      // function uses their own id from the session instead, which is
      // the only way that cannot be tampered with.
      supplierId: isSuperAdmin && role !== 'supplier' ? supplierId : null,
      // Sent only when a manager was actually chosen. Leaving it out is
      // not the same as sending null: the server checks a named manager
      // carefully, and there is nothing to check when there is no name.
      parentId: parentId || null,
    })

    setSaving(false)

    if (!result.ok) {
      // Field problems go next to their box. Anything else goes in the
      // banner at the top, because it is about the whole request.
      if (Object.keys(result.fieldErrors).length > 0) {
        setErrors(result.fieldErrors)
      } else {
        setBanner(result.error)
      }
      return
    }

    onCreated(result.data.username)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">
        {t('Buat akun baru', 'Create a new account')}
      </h2>

      <p className="text-sm text-slate-600">
        {isSuperAdmin
          ? t(
              'Buat akun untuk pemasok, client, atau agent. Orang baru harus mengganti kata sandinya saat masuk pertama kali.',
              'Create an account for a supplier, client or agent. The new person must change their password the first time they sign in.',
            )
          : t(
              'Buat akun untuk client atau agent Anda. Orang baru harus mengganti kata sandinya saat masuk pertama kali.',
              'Create an account for your own clients or agents. The new person must change their password the first time they sign in.',
            )}
      </p>

      {banner && <NotSavedBanner message={banner} />}

      {/* --- Name -------------------------------------------------- */}
      <div>
        <label className="label" htmlFor="new-full-name">
          {t('Nama lengkap', 'Full name')} <span aria-hidden="true">*</span>
        </label>
        <input
          id="new-full-name"
          className="field"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="off"
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? 'err-new-full-name' : undefined}
        />
        {errors.fullName && (
          <p id="err-new-full-name" className="mt-1 text-sm text-danger-700">
            {errors.fullName}
          </p>
        )}
      </div>

      {/* --- Username ---------------------------------------------- */}
      <div>
        <label className="label" htmlFor="new-username">
          {t('Nama pengguna', 'Username')} <span aria-hidden="true">*</span>
        </label>
        <input
          id="new-username"
          className="field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={errors.username ? true : undefined}
          aria-describedby={
            errors.username ? 'err-new-username' : 'help-new-username'
          }
        />
        {errors.username ? (
          <p id="err-new-username" className="mt-1 text-sm text-danger-700">
            {errors.username}
          </p>
        ) : (
          <p id="help-new-username" className="mt-1 text-xs text-slate-500">
            {t(
              'Huruf, angka, titik, tanda hubung. Ini yang dipakai untuk masuk.',
              'Letters, numbers, dot or dash. This is what they sign in with.',
            )}
          </p>
        )}
      </div>

      {/* --- Role -------------------------------------------------- */}
      <fieldset>
        <legend className="label">{t('Peran', 'Role')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(isSuperAdmin ? (['supplier', 'client', 'agent'] as const) : (['client', 'agent'] as const)).map(
            (option) => (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  role === option
                    ? 'border-primary-600 bg-primary-50 font-semibold'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                  className="h-4 w-4"
                />
                {roleLabel(option, language)}
              </label>
            ),
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {roleHelp(role, language)}
        </p>
      </fieldset>

      {/* --- Supplier, only for a Super Admin ------------------------ */}
      {isSuperAdmin && role !== 'supplier' && (
        <div>
          <label className="label" htmlFor="new-supplier">
            {t('Pemasok', 'Supplier')} <span aria-hidden="true">*</span>
          </label>
          {suppliers.length === 0 ? (
            <p className="text-sm text-warn-700">
              {t(
                'Belum ada pemasok. Buat akun pemasok terlebih dahulu.',
                'There are no suppliers yet. Create a supplier account first.',
              )}
            </p>
          ) : (
            <select
              id="new-supplier"
              className="field"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              aria-invalid={errors.supplierId ? true : undefined}
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          )}
          {errors.supplierId && (
            <p className="mt-1 text-sm text-danger-700">{errors.supplierId}</p>
          )}
        </div>
      )}

      {/* --- Manager, which is how level 3 and 4 exist ----------------- */}
      {role !== 'supplier' && (
        <div>
          <label className="label" htmlFor="new-manager">
            {t('Melapor kepada (opsional)', 'Reports to (optional)')}
          </label>

          {teamError ? (
            // This box is optional, so a failure to load the team must not
            // block creating the account. It says what happened and what
            // still works.
            <p className="text-sm text-warn-700">
              {t(
                'Daftar tim tidak bisa dimuat, jadi atasan tidak bisa dipilih. Akun tetap bisa dibuat sebagai level 2.',
                'The team list could not be loaded, so a manager cannot be chosen. The account can still be created at level 2.',
              )}
            </p>
          ) : team === null ? (
            // Deliberately a small inline note, not the full-page Loading
            // block. This box is optional, so it should not blank out the
            // rest of the form while it waits.
            <p className="text-sm text-slate-500">
              {t('Memuat tim...', 'Loading the team...')}
            </p>
          ) : possibleManagers.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t(
                'Belum ada orang lain di tim ini. Akun ini akan menjadi level 2.',
                'Nobody else is in this team yet. This account will be level 2.',
              )}
            </p>
          ) : (
            <>
              <select
                id="new-manager"
                className="field"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">
                  {t(
                    'Tidak ada (langsung ke pemasok)',
                    'Nobody (straight to the Supplier)',
                  )}
                </option>
                {possibleManagers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name} — {t(`Level ${member.level}`, `Level ${member.level}`)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  `Kosongkan bila orang ini bekerja langsung dengan pemasok. Pilih atasan bila ini agent di bawah agent. Maksimal ${MAX_LEVELS} tingkat.`,
                  `Leave empty if this person deals with the Supplier directly. Pick a manager if this agent works under another agent. Up to ${MAX_LEVELS} levels.`,
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* --- Password ---------------------------------------------- */}
      <div>
        <label className="label" htmlFor="new-password">
          {t('Kata sandi sementara', 'Temporary password')} <span aria-hidden="true">*</span>
        </label>
        <input
          id="new-password"
          type="password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={
            errors.password ? 'err-new-password' : 'help-new-password'
          }
        />
        {errors.password ? (
          <p id="err-new-password" className="mt-1 text-sm text-danger-700">
            {errors.password}
          </p>
        ) : (
          <div id="help-new-password" className="mt-1">
            {/* A strength bar is advice, not a rule. It says nothing about
                whether the server will accept it, and it must not imply
                that a "weak" password is refused when it is not. */}
            {strength.score > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      strength.score === 3
                        ? 'bg-ok-600'
                        : strength.score === 2
                          ? 'bg-warn-500'
                          : 'bg-danger-600'
                    }`}
                    style={{ width: `${(strength.score / 3) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500">
                  {strength.label[language]}
                </span>
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {t(
                'Minimal 8 karakter. Orang ini harus menggantinya saat masuk pertama kali.',
                'At least 8 characters. They must change it when they first sign in.',
              )}
            </p>
          </div>
        )}
      </div>

      {/* --- Optional ---------------------------------------------- */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          {t('Telepon dan alamat (opsional)', 'Phone and address (optional)')}
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="label" htmlFor="new-phone">
              {t('Telepon', 'Phone')}
            </label>
            <input
              id="new-phone"
              type="tel"
              className="field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
              inputMode="tel"
            />
          </div>
          <div>
            <label className="label" htmlFor="new-address">
              {t('Alamat', 'Address')}
            </label>
            <textarea
              id="new-address"
              className="field"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      </details>

      {/* --- Buttons ----------------------------------------------- */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary flex-1"
          disabled={saving}
        >
          {t('Batal', 'Cancel')}
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? t('Membuat...', 'Creating...') : t('Buat akun', 'Create account')}
        </button>
      </div>
    </form>
  )
}

// ===================================================================
// The small pieces of wording
// ===================================================================
function roleLabel(role: NewAccount['role'], language: 'id' | 'en'): string {
  if (role === 'supplier') return language === 'id' ? 'Pemasok' : 'Supplier'
  if (role === 'client') return language === 'id' ? 'Client' : 'Client'
  return language === 'id' ? 'Agent' : 'Agent'
}

function roleHelp(role: NewAccount['role'], language: 'id' | 'en'): string {
  if (role === 'supplier') {
    return language === 'id'
      ? 'Menjual produk. Tidak ada atasan di atasnya.'
      : 'Sells products. No owner above them.'
  }
  if (role === 'client') {
    return language === 'id'
      ? 'Membeli dari pemasok. Hanya bisa melihat katalog.'
      : 'Buys from a supplier. Can only see the catalog.'
  }
  return language === 'id'
    ? 'Mewakili client. Melihat harga agent, bukan harga client.'
    : 'Acts for clients. Sees agent prices, not client prices.'
}