// ===================================================================
// Force a password change on first login
// ===================================================================
// Shown when must_change_password is true, which happens for every account
// its creator set up. The reason: when a Supplier creates an Agent, they
// must choose an initial password to hand over. Forcing a change means the
// Agent picks their own and the Supplier never learns it.
// ===================================================================

import { useState, type FormEvent } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import { LanguageToggle } from '../components/LanguageToggle'

export function ChangePasswordPage({
  onSubmit,
  error,
  busy,
  userName,
}: {
  onSubmit: (newPassword: string) => Promise<boolean>
  error: string | null
  busy: boolean
  userName: string
}) {
  const { t, language, setLanguage } = useLanguage()

  const [fieldError, setFieldError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const data = new FormData(e.currentTarget as HTMLFormElement)
    const newPassword = String(data.get('newPassword') ?? '')
    const confirmPassword = String(data.get('confirmPassword') ?? '')

    // Validate here for a fast, clear message. The server enforces length
    // again -- a browser check can always be bypassed.
    if (newPassword.length < 8) {
      setFieldError(t('passwordTooShort'))
      return
    }
    if (newPassword !== confirmPassword) {
      setFieldError(t('passwordMismatch'))
      return
    }
    if (newPassword === String(data.get('oldPassword') ?? '')) {
      setFieldError(t('passwordSameAsOld'))
      return
    }

    setFieldError(null)
    await onSubmit(newPassword)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        {/* The switch sits above the card because this is the first thing
            a brand-new person sees after signing in for the first time.
            If the wording on this screen is not in the language they read
            fastest, this is where they change it, before they are asked
            to type a password. */}
        <div className="mb-4 flex justify-end">
          <LanguageToggle language={language} onChange={setLanguage} size="card" />
        </div>

        <div className="card space-y-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t('changePasswordTitle')}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {t('changePasswordIntro')}
            </p>
            <p className="mt-2 text-sm font-medium text-brand-700">{userName}</p>
          </div>

          {error && (
            <div
              className="rounded-lg border border-danger-600/30 bg-danger-50 p-3"
              role="alert"
            >
              <p className="text-sm font-medium text-danger-700">{error}</p>
            </div>
          )}

          {fieldError && (
            <div
              className="rounded-lg border border-danger-600/30 bg-danger-50 p-3"
              role="alert"
            >
              <p className="text-sm font-medium text-danger-700">{fieldError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label className="label" htmlFor="newPassword">
                {t('newPassword')}
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                className="field"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="confirmPassword">
                {t('confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                className="field"
                required
              />
            </div>

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? t('saving') : t('save')}
            </button>
          </form>

          {/* The old password is never asked for. The person already proved
              who they are by logging in. Asking again only trains users to
              type passwords into more places than necessary. */}
        </div>
      </div>
    </div>
  )
}