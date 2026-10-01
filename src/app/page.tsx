import { cookies } from 'next/headers';
import AppShell from '@/components/app-shell';
import { DEFAULT_LANG, LANG_COOKIE, isLangCode } from '@/lib/i18n/config';

/**
 * Reads the persisted language cookie (set by the language switcher) so
 * the very first server-rendered paint already uses the user's language.
 */
export default async function Home() {
  const store = await cookies();
  const raw = store.get(LANG_COOKIE)?.value;
  const initialLang = isLangCode(raw) ? raw : DEFAULT_LANG;

  return <AppShell initialLang={initialLang} />;
}
