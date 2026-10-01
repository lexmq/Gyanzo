'use client';

/**
 * Gyanzo i18n — React provider.
 *
 * The chosen language is persisted in a cookie (`gyanzo_lang`) which the
 * server reads in layout.tsx / page.tsx, so the first server-rendered
 * paint already uses the right language (no hydration mismatch, no flash).
 * Switching languages updates the whole app instantly through context.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { DEFAULT_LANG, LANG_COOKIE, type LangCode } from './config';
import type { Dict } from './en';
import en from './en';
import hi from './hi';
import mr from './mr';
import es from './es';
import fr from './fr';
import de from './de';

export const DICTS: Record<LangCode, Dict> = { en, hi, mr, es, fr, de };

type LanguageContextValue = {
  /** Currently active language code. */
  lang: LangCode;
  /** Switch the app language (re-renders everything, persists the choice). */
  setLang: (lang: LangCode) => void;
  /** Translation dictionary for the active language. */
  t: Dict;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initialLang = DEFAULT_LANG,
  children,
}: {
  initialLang?: LangCode;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<LangCode>(initialLang);

  const setLang = useCallback((next: LangCode) => {
    setLangState(next);
    // Persist for the next server-rendered visit (cookie, 1 year).
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // Keep <html lang> in sync for screen readers / a11y (plain DOM write).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t: DICTS[lang] }),
    [lang, setLang]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used inside <LanguageProvider>');
  }
  return ctx;
}

export type { LangCode, Dict };
