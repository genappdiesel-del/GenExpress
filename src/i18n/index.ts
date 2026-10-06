// ===================================================================
// i18n -- English and Bahasa Indonesia
// ===================================================================
// Bahasa Indonesia is the default, because the people using this app are
// in Indonesia. Every key must exist in BOTH files; the TypeScript type
// below enforces that. If someone adds a word to one language and forgets
// the other, the build fails rather than showing a blank label.
// ===================================================================

export const LANGUAGES = {
  id: 'Bahasa Indonesia',
  en: 'English',
} as const

export type LanguageCode = keyof typeof LANGUAGES

export const DEFAULT_LANGUAGE: LanguageCode = 'id'

const id = {
  // --- App shell ---
  appName: 'Trade Tracker',
  loading: 'Memuat...',
  language: 'Bahasa',
  logout: 'Keluar',
  logoutConfirm: 'Apakah Anda yakin ingin keluar?',
  notSavedYet: 'Belum tersimpan',
  retry: 'Coba lagi',
  save: 'Simpan',
  saving: 'Menyimpan...',
  cancel: 'Batal',
  close: 'Tutup',
  back: 'Kembali',
  next: 'Lanjut',
  yes: 'Ya',
  no: 'Tidak',
  confirm: 'Konfirmasi',
  search: 'Cari',
  searchPlaceholder: 'Ketik untuk mencari...',
  all: 'Semua',
  none: 'Tidak ada',
  emptyTitle: 'Belum ada data',
  emptyBody: 'Data akan muncul di sini setelah ada yang masuk.',
  errorTitle: 'Gagal memuat',
  errorBody: 'Terjadi kesalahan. Silakan coba lagi.',
  // --- Login ---
  login: 'Masuk',
  logoutWord: 'Keluar',
  username: 'Nama pengguna',
  usernamePlaceholder: 'mis. ali',
  password: 'Kata sandi',
  passwordPlaceholder: 'Masukkan kata sandi',
  signingIn: 'Sedang masuk...',
  loginError: 'Gagal masuk',
  changePasswordTitle: 'Ganti kata sandi',
  changePasswordIntro:
    'Ini adalah pertama kali Anda masuk. Silakan buat kata sandi baru yang hanya Anda yang tahu.',
  newPassword: 'Kata sandi baru',
  confirmPassword: 'Ulangi kata sandi baru',
  passwordMismatch: 'Kata sandi tidak sama',
  passwordTooShort: 'Kata sandi harus minimal 8 karakter',
  passwordChanged: 'Kata sandi berhasil diganti. Silakan masuk.',
  // --- Roles ---
  role: 'Peran',
  roleSuperAdmin: 'Super Admin',
  roleSupplier: 'Pemasok',
  roleClient: 'Klien',
  roleAgent: 'Agen',
  // --- Portals ---
  home: 'Beranda',
  dashboard: 'Ringkasan',
  // Super Admin
  saTitle: 'Super Admin',
  saWelcome: 'Selamat datang,',
  saComingSoon: 'Fitur ini akan hadir di tahap berikutnya.',
  // Supplier
  supTitle: 'Pemasok',
  supWelcome: 'Selamat datang,',
  // Client
  cliTitle: 'Klien',
  cliWelcome: 'Selamat datang,',
  // Agent
  agTitle: 'Agen',
  agWelcome: 'Selamat datang,',
  // --- Errors ---
  notConfiguredTitle: 'Belum dikonfigurasi',
  notConfiguredBody:
    'Kunci Supabase belum diisi. Salin .env.example menjadi .env, lalu isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.',
  notAuthorizedTitle: 'Halaman tidak tersedia',
  notAuthorizedBody: 'Akun Anda tidak punya akses ke halaman ini.',
  goHome: 'Kembali ke beranda',
} as const

export type TranslationKey = keyof typeof id

const en: Record<TranslationKey, string> = {
  appName: 'Trade Tracker',
  loading: 'Loading...',
  language: 'Language',
  logout: 'Log out',
  logoutConfirm: 'Are you sure you want to log out?',
  notSavedYet: 'Not saved yet',
  retry: 'Try again',
  save: 'Save',
  saving: 'Saving...',
  cancel: 'Cancel',
  close: 'Close',
  back: 'Back',
  next: 'Next',
  yes: 'Yes',
  no: 'No',
  confirm: 'Confirm',
  search: 'Search',
  searchPlaceholder: 'Type to search...',
  all: 'All',
  none: 'None',
  emptyTitle: 'Nothing here yet',
  emptyBody: 'Data will appear here once it is added.',
  errorTitle: 'Could not load',
  errorBody: 'Something went wrong. Please try again.',
  login: 'Log in',
  logoutWord: 'Log out',
  username: 'Username',
  usernamePlaceholder: 'e.g. ali',
  password: 'Password',
  passwordPlaceholder: 'Enter your password',
  signingIn: 'Logging in...',
  loginError: 'Could not log in',
  changePasswordTitle: 'Change your password',
  changePasswordIntro:
    'This is your first time logging in. Please make a new password that only you know.',
  newPassword: 'New password',
  confirmPassword: 'Repeat new password',
  passwordMismatch: 'Passwords do not match',
  passwordTooShort: 'Password must be at least 8 characters',
  passwordChanged: 'Password changed. Please log in.',
  role: 'Role',
  roleSuperAdmin: 'Super Admin',
  roleSupplier: 'Supplier',
  roleClient: 'Client',
  roleAgent: 'Agent',
  home: 'Home',
  dashboard: 'Overview',
  saTitle: 'Super Admin',
  saWelcome: 'Welcome,',
  saComingSoon: 'This feature arrives in a later phase.',
  supTitle: 'Supplier',
  supWelcome: 'Welcome,',
  cliTitle: 'Client',
  cliWelcome: 'Welcome,',
  agTitle: 'Agent',
  agWelcome: 'Welcome,',
  notConfiguredTitle: 'Not configured yet',
  notConfiguredBody:
    'Supabase keys are empty. Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  notAuthorizedTitle: 'Page not available',
  notAuthorizedBody: 'Your account does not have access to this page.',
  goHome: 'Back to home',
}

export const translations: Record<LanguageCode, Record<TranslationKey, string>> = {
  id,
  en,
}

// --- Money and dates ----------------------------------------------------
// Money formatting used to live here as well as in src/lib/money.ts. Two
// copies of the same function is a trap: they drift, and a fix applied to
// one leaves the other showing different numbers on a different screen.
// The only copy now lives in lib/money.ts, which also owns the rules
// that matter for this app: currencies with no usable minor unit, and
// converting to whole small units for arithmetic without float drift.
//
// These are re-exported rather than deleted so existing imports keep
// working and there is still exactly one way to format a number.
export { formatMoney, formatQty, parseNumber, toUnits, fromUnits } from '../lib/money'
export type { Currency } from '../lib/money'

export function formatDate(iso: string, language: LanguageCode = 'id'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat(language === 'id' ? 'id-ID' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}