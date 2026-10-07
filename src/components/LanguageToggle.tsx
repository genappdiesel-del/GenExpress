// ===================================================================
// Language switch: Bahasa Indonesia / English
// ===================================================================
// This was a dropdown box with two options. That was the wrong control.
//
// WHY A DROPDOWN IS WRONG HERE
// A dropdown hides the other choice until it is opened. This app is used
// on phones, often by people whose first language is not English, often
// one-handed while carrying stock. A control where the other language is
// invisible until you find and open it will be missed by exactly the
// people who most need it.
//
// So the two options are both on screen, all the time, side by side. One
// press, no opening, no hunting. The chosen one is marked in three ways
// at once -- colour, weight and a pressed state -- so it does not rely on
// colour alone to be readable.
//
// SIZE
// Both buttons are 44px tall. That is the smallest comfortable target on
// a touch screen, and it is the app-wide rule for anything you tap.
//
// ACCESSIBILITY
// This is a group of two buttons, not a dropdown, so a screen reader
// announces each language as its own button rather than as one
// "Language, collapsed, combo box" that has to be opened to be explored.
// The group is labelled, and the active button reports itself as pressed
// so its state is announced rather than only drawn.
// ===================================================================

import type { LanguageCode } from '../i18n'

export interface LanguageToggleProps {
  language: string
  onChange: (code: string) => void
  /**
   * How the control is sized.
   *
   *   'header'  sits in the portal header next to the logout button.
   *   'card'    stands on its own, used on the login and change-password
   *             screens where there is room to be generous.
   *
   * The card size is used on the two screens a person sees before they
   * have logged in, because that is where they are most likely to want to
   * switch to a language they read better.
   */
  size?: 'header' | 'card'
  /** Hides the visible "Bahasa" label. The accessible name stays. */
  hideLabel?: boolean
}

const OPTIONS: Array<{ code: LanguageCode; label: string; full: string }> = [
  { code: 'id', label: 'ID', full: 'Bahasa Indonesia' },
  { code: 'en', label: 'EN', full: 'English' },
]

export function LanguageToggle({
  language,
  onChange,
  size = 'header',
  hideLabel = false,
}: LanguageToggleProps) {
  const card = size === 'card'

  return (
    <div className="flex flex-col items-end gap-1">
      {!hideLabel && (
        <span
          className="text-xs font-medium text-slate-500"
          // The visible caption, and the group's accessible name. Both
          // read the same in either language, so this label never has to
          // be translated and never goes stale in one of them.
          id="language-toggle-label"
        >
          Bahasa
        </span>
      )}

      <div
        role="group"
        aria-labelledby={hideLabel ? undefined : 'language-toggle-label'}
        aria-label={hideLabel ? 'Language / Bahasa' : undefined}
        className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white"
      >
        {OPTIONS.map((option) => {
          const active = language === option.code

          return (
            <button
              key={option.code}
              type="button"
              onClick={() => onChange(option.code)}
              // aria-pressed is what a screen reader reads out. The colour
              // and the font weight are only there for people who can see.
              aria-pressed={active}
              title={option.full}
              className={[
                'font-semibold transition-colors',
                // 44px tall either way. This is the app-wide rule and it
                // is not relaxed just because this sits in a header.
                card ? 'min-h-11 px-6 text-base' : 'min-h-11 px-3.5 text-sm',
                active
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-100',
                // A hairline between the two, so they read as one control
                // rather than two loose buttons.
                option.code === 'en' ? 'border-l border-slate-300' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span aria-hidden="true">{option.label}</span>
              {/* Not aria-hidden: a screen reader gets the full name
                  ("English") rather than the two letters on screen. */}
              <span className="sr-only">{option.full}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}