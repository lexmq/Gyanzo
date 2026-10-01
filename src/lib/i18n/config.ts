/**
 * Gyanzo i18n — language metadata.
 *
 * Pure metadata only (no React, no dictionary imports) so both server
 * components (layout.tsx / page.tsx read the language cookie) and client
 * components can use it.
 */

export const LANGUAGES = [
  { code: 'en', short: 'EN', label: 'English' },
  { code: 'hi', short: 'HI', label: 'हिन्दी' },
  { code: 'mr', short: 'MR', label: 'मराठी' },
  { code: 'es', short: 'ES', label: 'Español' },
  { code: 'fr', short: 'FR', label: 'Français' },
  { code: 'de', short: 'DE', label: 'Deutsch' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANG: LangCode = 'en';

/** Cookie used to persist the chosen language (read server-side for SSR). */
export const LANG_COOKIE = 'gyanzo_lang';

/** Type guard for values read from the cookie / storage. */
export function isLangCode(value: string | undefined | null): value is LangCode {
  return LANGUAGES.some((l) => l.code === value);
}

export function getLanguageMeta(code: LangCode) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
