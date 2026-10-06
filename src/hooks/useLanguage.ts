// ===================================================================
// Language hook
// ===================================================================
// The chosen language is kept in localStorage so it survives a page reload
// and so each person on a shared phone keeps their own choice.
//
// Default is Bahasa Indonesia, because that is who uses this app.
// ===================================================================

import { useCallback, useEffect, useState } from 'react'
import {
  translations,
  DEFAULT_LANGUAGE,
  LANGUAGES,
  type LanguageCode,
  type TranslationKey,
} from '../i18n'

const STORAGE_KEY = 'trade-tracker-language'

function readStoredLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'id' || saved === 'en') return saved
  } catch {
    // Private browsing mode can make localStorage throw. Not worth crashing
    // over -- just fall back to the default.
  }
  return DEFAULT_LANGUAGE
}

export function useLanguage() {
  const [language, setLanguageState] = useState<LanguageCode>(readStoredLanguage)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language)
      // Keep the html lang attribute in sync. Screen readers use it to pick
      // the right pronunciation, so this is not cosmetic.
      document.documentElement.lang = language
    } catch {
      // Ignore: a missing preference is not a reason to break the app.
    }
  }, [language])

  const setLanguage = useCallback((code: string) => {
    if (code === 'id' || code === 'en') setLanguageState(code)
  }, [])

  /** Translate a key into the current language. */
  const t = useCallback(
    (key: TranslationKey) => translations[language][key],
    [language],
  )

  return {
    language,
    setLanguage,
    t,
    languages: Object.entries(LANGUAGES).map(([code, label]) => ({ code, label })),
  }
}