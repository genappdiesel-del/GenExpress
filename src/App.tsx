// ===================================================================
// App -- role dispatch
// ===================================================================
// One file decides which portal a person sees. There is no router library
// on purpose: this app has four sections plus a login screen, and routing
// that hand-rolled is a few lines instead of a dependency that can break a
// major version. The prompt's stack table does not list a router, and
// adding one nobody asked for is scope creep.
//
// The most important thing in this file: the role check. Someone typing
// /admin while logged in as a Client must not see the admin screen.
//
// IMPORTANT: this check is CONVENIENCE, not security. The real security
// lives in the database's Row Level Security policies. If someone deleted
// every line of routing logic in this file, they would still see zero rows
// of anyone else's data, because the database refuses to return them. That
// is the whole design: never trust the screen to keep a secret.
// ===================================================================

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from './hooks/useAuth'
import { useLanguage } from './hooks/useLanguage'
import { isConfigured } from './lib/supabase'
import { getMyCurrency } from './lib/accounts'
import type { TranslationKey } from './i18n'
import type { Currency, Profile, UserRole } from './types/database'

import { LoginPage } from './pages/LoginPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { PortalShell, Loading, type NavItem } from './components/ui'

import { SuperAdminHome } from './portals/superadmin/SuperAdminHome'
import { SuperAdminAccounts } from './portals/superadmin/SuperAdminAccountsPage'
import { SupplierHome } from './portals/supplier/SupplierHome'
import { SupplierProducts } from './portals/supplier/SupplierProductsPage'
import { SupplierClientPermissions } from './portals/supplier/SupplierClientPermissions'
import { ClientHome } from './portals/client/ClientHome'
import { ClientCatalog } from './portals/client/ClientCatalogPage'
import { AgentHome } from './portals/agent/AgentHome'
import { AgentProducts } from './portals/agent/AgentProductsPage'
import { ComingSoon } from './components/ui'

/** Which path prefixes each role may reach. '/' is allowed for all so a
 *  signed-in person landing on a bare URL is not bounced to an error. */
const ALLOWED_ROUTES: Record<UserRole, readonly string[]> = {
  super_admin: ['/admin', '/'],
  supplier: ['/supplier', '/'],
  client: ['/client', '/'],
  agent: ['/agent', '/'],
}

function homePathForRole(role: UserRole): string {
  return `/${role === 'super_admin' ? 'admin' : role}`
}

/** Navigation items per role, in display order. */
function navForRole(role: UserRole, language: 'id' | 'en'): NavItem[] {
  const id = language === 'id'
  switch (role) {
    case 'super_admin':
      return [
        { to: '/admin', label: id ? 'Beranda' : 'Home', icon: '🏠' },
        { to: '/admin/accounts', label: id ? 'Akun' : 'Accounts', icon: '👥' },
        { to: '/admin/suppliers', label: id ? 'Pemasok' : 'Suppliers', icon: '🏭' },
        { to: '/admin/audit', label: id ? 'Log' : 'Audit log', icon: '📋' },
      ]
    case 'supplier':
      return [
        { to: '/supplier', label: id ? 'Beranda' : 'Home', icon: '🏠' },
        { to: '/supplier/products', label: id ? 'Produk' : 'Products', icon: '📦' },
        { to: '/supplier/clients', label: id ? 'Izin Client' : 'Client access', icon: '🔑' },
        { to: '/supplier/requests', label: id ? 'Permintaan' : 'Requests', icon: '📥' },
        { to: '/supplier/orders', label: id ? 'Pesanan' : 'Orders', icon: '🧾' },
      ]
    case 'client':
      return [
        { to: '/client', label: id ? 'Beranda' : 'Home', icon: '🏠' },
        { to: '/client/catalog', label: id ? 'Katalog' : 'Catalog', icon: '🛒' },
        { to: '/client/orders', label: id ? 'Pesanan' : 'Orders', icon: '🧾' },
        { to: '/client/pay', label: id ? 'Bayar' : 'Pay', icon: '💳' },
      ]
    case 'agent':
      return [
        { to: '/agent', label: id ? 'Beranda' : 'Home', icon: '🏠' },
        { to: '/agent/products', label: id ? 'Cari' : 'Find', icon: '🔍' },
        { to: '/agent/request', label: id ? 'Minta' : 'Request', icon: '📷' },
        { to: '/agent/funds', label: id ? 'Dana' : 'Funds', icon: '💰' },
      ]
  }
}

function portalTitleForRole(role: UserRole, t: (k: TranslationKey) => string): string {
  switch (role) {
    case 'super_admin': return t('saTitle')
    case 'supplier': return t('supTitle')
    case 'client': return t('cliTitle')
    case 'agent': return t('agTitle')
  }
}

/**
 * The currency a person's money is shown in.
 *
 * This used to be a hardcoded `return 'IDR'`, with a note admitting that
 * every price on a Client's and an Agent's screen was labelled by
 * assumption rather than by reading it. Migration 015 closed that: a
 * database function returns the caller's OWN Supplier's currency, so the
 * value the app shows is the value the Supplier chose.
 *
 * It is loaded rather than computed, because it comes from the database.
 * Until it arrives the app shows Rupiah, which is the confirmed default
 * for this business, so a slow network never shows an empty symbol on a
 * price.
 */

export default function App() {
  const { state, error, clearError, signIn, signOut, changePassword } = useAuth()
  const { t, language, setLanguage } = useLanguage()
  const [busy, setBusy] = useState(false)

  // The currency comes from the database, once per signed-in person.
  // Two things are being guarded here rather than just fetched:
  //
  //  - It must not be looked up before there is a session, because the
  //    function answers for whoever is signed in and there is nobody yet.
  //  - It must be looked up again when a DIFFERENT person signs in on the
  //    same phone, because in a shop one device gets passed around and
  //    two Suppliers may not share a currency.
  //
  // Until it arrives the app shows Rupiah, which is the confirmed default
  // for this business, so a slow network never blanks the symbol on a
  // price.
  const signedInId = state.status === 'signed_in' ? state.profile.id : null
  const [currency, setCurrency] = useState<Currency>('IDR')
  useEffect(() => {
    if (signedInId === null) return
    let cancelled = false
    getMyCurrency(signedInId).then((value) => {
      if (!cancelled) setCurrency(value as Currency)
    })
    return () => {
      cancelled = true
    }
  }, [signedInId])

  // Hash routing. We only ever deal with a handful of fixed paths, so this
  // stays simple and dependency-free. Using the hash means the app works on
  // any static host without needing URL rewriting rules.
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/')

  // React to the browser Back button and any hash change.
  useEffect(() => {
    const onHashChange = () => setPath(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((to: string) => {
    window.location.hash = to
    setPath(to)
  }, [])

  // --- States before the app can render ----------------------------

  if (!isConfigured) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="card max-w-md text-center">
          <span aria-hidden="true" className="mb-3 block text-3xl">🔧</span>
          <h1 className="text-lg font-bold text-slate-900">{t('notConfiguredTitle')}</h1>
          <p className="mt-2 text-sm text-slate-600">{t('notConfiguredBody')}</p>
        </div>
      </div>
    )
  }

  if (state.status === 'loading') {
    return <Loading label={t('loading')} />
  }

  if (state.status === 'signed_out') {
    return (
      <LoginPage
        onSubmit={async (username, password) => {
          clearError()
          setBusy(true)
          const ok = await signIn(username, password)
          setBusy(false)
          // On success the auth hook loads the profile and this component
          // re-renders into the signed-in branch below, which sorts out the
          // correct home screen for whatever role this person has. There is
          // no need to guess the role here.
          if (ok) navigate('/')
          return ok
        }}
        error={error}
        busy={busy}
      />
    )
  }

  if (state.status === 'needs_password_change') {
    return (
      <ChangePasswordPage
        onSubmit={async (newPassword) => {
          clearError()
          setBusy(true)
          const ok = await changePassword(newPassword)
          setBusy(false)
          // Sign out after the change so the next sign-in starts clean with
          // the new password.
          if (ok) await signOut()
          return ok
        }}
        error={error}
        busy={busy}
        userName={state.profile.username}
      />
    )
  }

  // `unconfigured` is already handled above, so this branch is signed_in.
  if (state.status !== 'signed_in') {
    return <Loading label={t('loading')} />
  }

  // --- Signed in ----------------------------------------------------

  const { profile } = state
  const allowed = ALLOWED_ROUTES[profile.role]
  const isAllowed = allowed.some((r) => path === r || path.startsWith(r + '/'))

  // If someone lands on a path their role may not use, quietly send them to
  // their own home rather than showing an error. Being lost is worse than
  // being redirected.
  if (!isAllowed) {
    navigate(homePathForRole(profile.role))
  }

  return (
    <PortalShell
      title={portalTitleForRole(profile.role, t)}
      userName={profile.full_name}
      language={language}
      onLanguageChange={setLanguage}
      onLogout={() => {
        if (window.confirm(t('logoutConfirm'))) {
          void signOut()
          navigate('/')
        }
      }}
      navItems={navForRole(profile.role, language)}
      logoutLabel={t('logout')}
    >
      <Screen path={path} profile={profile} language={language} currency={currency} />
    </PortalShell>
  )
}

// ===================================================================
// Which screen for this path and this role
// ===================================================================
// Split out from the component above so the switch can be read on its own.
// It is one function rather than a map because each case needs different
// props, and a map of functions would hide that behind indirection.
//
// Falling through to the role's home screen is deliberate. An
// unrecognised path inside a section someone is allowed to be in should
// show their home, not a blank page.
function Screen({
  path,
  profile,
  language,
  currency,
}: {
  path: string
  profile: Profile
  language: 'id' | 'en'
  currency: Currency
}) {
  // A Supplier's own profile IS the supplier id, because the database
  // keys everything on it. Clients and Agents have one too, naming the
  // Supplier they trade with. So one value covers every screen that needs
  // to know who the Supplier is.
  const supplierId = profile.supplier_id ?? profile.id
  const id = language === 'id'

  switch (profile.role) {
    case 'super_admin':
      if (path === '/admin') {
        return <SuperAdminHome profile={profile} language={language} />
      }
      if (path === '/admin/accounts') {
        return <SuperAdminAccounts profile={profile} language={language} />
      }
      // The remaining admin screens are Phase 3. Saying so plainly beats
      // a blank screen: it shows the app is working and this part is
      // still to come.
      return <ComingSoon label={id ? 'Layar ini belum dibuat' : 'This screen is not built yet'} />

    case 'supplier':
      if (path === '/supplier/products') {
        return <SupplierProducts supplierId={supplierId} language={language} />
      }
      if (path === '/supplier/clients') {
        return (
          <SupplierClientPermissions supplierId={supplierId} language={language} />
        )
      }
      if (path === '/supplier/requests' || path === '/supplier/orders') {
        return <ComingSoon label={id ? 'Layar ini belum dibuat' : 'This screen is not built yet'} />
      }
      return <SupplierHome profile={profile} language={language} />

    case 'client':
      if (path === '/client/catalog') {
        return <ClientCatalog currency={currency} language={language} />
      }
      if (path === '/client/orders' || path === '/client/pay') {
        return <ComingSoon label={id ? 'Layar ini belum dibuat' : 'This screen is not built yet'} />
      }
      return <ClientHome profile={profile} language={language} />

    case 'agent':
      if (path === '/agent/products') {
        return <AgentProducts currency={currency} language={language} />
      }
      if (path === '/agent/request' || path === '/agent/funds') {
        return <ComingSoon label={id ? 'Layar ini belum dibuat' : 'This screen is not built yet'} />
      }
      return <AgentHome profile={profile} language={language} />
  }
}