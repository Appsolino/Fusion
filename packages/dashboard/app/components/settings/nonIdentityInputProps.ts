/**
 * FNXC:SettingsNonIdentityAutofill 2026-07-31-12:20:
 * ISS-UI-001 (expanded): Edge/Chrome password managers classified Settings Authentication
 * non-identity controls (Cursor CLI binary path, always-mounted API-key password inputs, and
 * the Settings search filter) as login username/password fields and injected saved credentials.
 * Shared props harden only those non-website-login inputs; do not apply to genuine site login forms.
 */
export const SETTINGS_NON_IDENTITY_TEXT_INPUT_PROPS = {
  autoComplete: "off",
  autoCapitalize: "none" as const,
  autoCorrect: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
};

/**
 * FNXC:SettingsNonIdentityAutofill 2026-07-31-12:20:
 * Replacement API-key fields use `new-password` so Chromium/Edge do not treat them as the
 * site's login password field, plus password-manager ignore markers for 1Password/LastPass/Bitwarden.
 */
export const SETTINGS_API_KEY_REPLACEMENT_INPUT_PROPS = {
  autoComplete: "new-password",
  autoCapitalize: "none" as const,
  autoCorrect: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
};
