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

import { useState } from 'react'

import { NotSavedBanner } from '../ui'
import {
  checkUsername,
  createAccount,
  passwordStrength,
  type FieldErrors,
  type NewAccount,
} from '../../lib/accounts'
import type { Profile } from '../../types/database'

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
  const t = (id: string, en: string) => (language === 'id' ? id : en)

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

  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const strength = passwordStrength(password)

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