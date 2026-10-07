// ===================================================================
// Login screen
// ===================================================================
// Deliberately simple: two boxes and one button. Most of this app's users
// are on cheap phones with slow connections and may be typing with one
// thumb, so nothing here is clever.
//
// The person types a username like "ali". Behind the scenes we send
// "ali@tracker.local" to Supabase, because Supabase requires an email
// address. They never see or type that part. See hooks/useAuth.ts.
// ===================================================================

import { useState, type FormEvent } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import { LanguageToggle } from '../components/LanguageToggle'

export function LoginPage({
  onSubmit,
  error,
  busy,
}: {
  onSubmit: (username: string, password: string) => Promise<boolean>
  error: string | null
  busy: boolean
}) {
  const { t, language, setLanguage } = useLanguage()

  const [username, setUsername] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})

  // Basic checks before we bother the server. The server checks again --
  // never trust a check that only runs in the browser.
  function validate(password: string): boolean {
    const errs: { username?: string; password?: string } = {}
    const trimmed = username.trim()
    if (!trimmed) {
      errs.username = 'Nama pengguna wajib diisi.'
    } else if (trimmed.length < 3) {
      errs.username = 'Nama pengguna minimal 3 karakter.'
    }
    if (!password) {
      errs.password = 'Kata sandi wajib diisi.'
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    // Read the password straight from the form rather than holding it in
    // React state. It is never stored in a variable that could end up in a
    // log, an error report, or a component tree dump.
    const data = new FormData(e.currentTarget as HTMLFormElement)
    const password = String(data.get('password') ?? '')

    if (!validate(password)) return
    await onSubmit(username.trim(), password)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex justify-end p-4">
        <LanguageToggle language={language} onChange={setLanguage} size="card" />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div
              aria-hidden="true"
              className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-2xl"
            >
              📦
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{t('appName')}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {language === 'id'
                ? 'Masuk untuk melanjutkan'
                : 'Log in to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="card space-y-4">
            {/* Server-side error, e.g. wrong password. Announced to screen
                readers because it appears after the form is submitted. */}
            {error && (
              <div
                className="rounded-lg border border-danger-600/30 bg-danger-50 p-3"
                role="alert"
                aria-live="assertive"
              >
                <p className="text-sm font-medium text-danger-700">{error}</p>
              </div>
            )}

            <div>
              <label className="label" htmlFor="username">
                {t('username')}
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                placeholder={t('usernamePlaceholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="field"
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={fieldErrors.username ? 'username-error' : undefined}
              />
              {fieldErrors.username && (
                <p id="username-error" className="mt-1 text-sm text-danger-600">
                  {fieldErrors.username}
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="password">
                {t('password')}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={t('passwordPlaceholder')}
                className="field"
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              />
              {fieldErrors.password && (
                <p id="password-error" className="mt-1 text-sm text-danger-600">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? (
                <>
                  <span className="sr-only">{t('signingIn')}</span>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                  />
                  {t('signingIn')}
                </>
              ) : (
                t('login')
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}