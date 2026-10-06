// ===================================================================
// Shared UI pieces
// ===================================================================
// Small building blocks reused by every portal. Keeping them in one file
// means a button looks and behaves the same everywhere, and a fix to one
// fixes all of them.
//
// Every component here handles its own three states: loading, empty, error.
// The prompt requires that every list does this, so it is built into the
// components rather than repeated (and forgotten) on each screen.
// ===================================================================

import type { ReactNode } from 'react'

// --- Loading -------------------------------------------------------
export function Loading({ label = 'Memuat...' }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-12 text-slate-500"
      role="status"
      aria-live="polite"
    >
      {/* A simple pulsing bar. No spinner library needed. */}
      <div className="h-2 w-24 animate-pulse overflow-hidden rounded-full bg-slate-200">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-500" />
      </div>
      <span className="text-sm">{label}</span>
    </div>
  )
}

// --- Empty ---------------------------------------------------------
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="card flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

// --- Error ---------------------------------------------------------
export function ErrorState({
  title = 'Gagal memuat',
  body = 'Terjadi kesalahan. Silakan coba lagi.',
  onRetry,
  retryLabel = 'Coba lagi',
}: {
  title?: string
  body?: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div
      className="card flex flex-col items-center gap-2 border-danger-600/20 bg-danger-50 py-10 text-center"
      role="alert"
    >
      <p className="text-base font-semibold text-danger-700">{title}</p>
      <p className="max-w-sm text-sm text-danger-700/80">{body}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          {retryLabel}
        </button>
      )}
    </div>
  )
}

// --- "Not saved yet" warning ---------------------------------------
// Used when the connection drops mid-save. The user must never think their
// work went through when it did not.
export function NotSavedBanner({
  message = 'Belum tersimpan. Data Anda aman di layar ini.',
  onRetry,
  retryLabel = 'Coba lagi',
}: {
  message?: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-warn-600/30 bg-warn-50 p-3"
      role="alert"
      aria-live="assertive"
    >
      <p className="text-sm font-medium text-warn-700">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary shrink-0">
          {retryLabel}
        </button>
      )}
    </div>
  )
}

// --- Status badge --------------------------------------------------
// One place that decides what colour a status gets, so "paid" is green
// on every screen. Learning colour once is what makes a status readable
// at a glance.
export type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral'

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-ok-50 text-ok-700',
  warn: 'bg-warn-50 text-warn-700',
  danger: 'bg-danger-50 text-danger-700',
  neutral: 'bg-slate-100 text-slate-700',
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone
  children: ReactNode
}) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>
}

// --- Page heading --------------------------------------------------
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}

// --- Navigation ----------------------------------------------------
// Bottom bar on phones (thumb reach), side menu on desktop. The same
// items in both places so nobody has to learn two layouts.
export interface NavItem {
  to: string
  label: string
  /** Emoji instead of an icon library: zero extra download, works offline. */
  icon: string
}

export function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="nav-bottom" aria-label="Navigasi utama">
      <ul className="mx-auto flex max-w-2xl">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <a
              href={item.to}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1
                         py-2 text-xs font-medium text-slate-600 hover:text-brand-700
                         focus-visible:text-brand-700"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                {item.icon}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function SideNav({ items, title }: { items: NavItem[]; title: string }) {
  return (
    <nav className="nav-side" aria-label="Navigasi utama">
      <p className="mb-4 px-2 text-sm font-bold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <a
              href={item.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                         text-slate-700 hover:bg-slate-100 hover:text-brand-800"
            >
              <span aria-hidden="true" className="text-base">
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// --- Portal shell --------------------------------------------------
// The frame every portal page sits in: side menu on the left on desktop,
// bottom bar on phones, language switch and logout always reachable.
export function PortalShell({
  title,
  userName,
  language,
  onLanguageChange,
  languages,
  onLogout,
  navItems,
  logoutLabel,
  children,
}: {
  title: string
  userName: string
  language: string
  onLanguageChange: (code: string) => void
  languages: Array<{ code: string; label: string }>
  onLogout: () => void
  navItems: NavItem[]
  logoutLabel: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh">
      <SideNav items={navItems} title={title} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-brand-800">{title}</p>
              <p className="truncate text-xs text-slate-500">{userName}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <label className="sr-only" htmlFor="language-select">
                Language
              </label>
              <select
                id="language-select"
                value={language}
                onChange={(e) => onLanguageChange(e.target.value)}
                className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>

              <button type="button" onClick={onLogout} className="btn-secondary min-h-9 px-3 text-sm">
                {logoutLabel}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-4 pb-safe-nav lg:pb-6">{children}</main>
      </div>

      <BottomNav items={navItems} />
    </div>
  )
}

// --- "Coming soon" placeholder -------------------------------------
// Phase 1 shows the navigation and role separation but the working screens
// arrive later. Saying so plainly is better than showing a fake number.
export function ComingSoon({ label }: { label: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-16 text-center">
      <span aria-hidden="true" className="text-4xl">🚧</span>
      <p className="text-base font-semibold text-slate-800">{label}</p>
      <p className="max-w-sm text-sm text-slate-500">
        Fitur ini akan dibangun pada tahap berikutnya.
      </p>
    </div>
  )
}