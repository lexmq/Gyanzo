/**
 * Appearance engine — applies the user's Settings → Appearance prefs
 * (theme / compact mode / reduced animations) to <html> as classes that
 * the global CSS in globals.css responds to.
 *
 * Called from the app shell (on sign-in + whenever prefs change) and
 * directly from the Settings section for instant feedback.
 */

import { DEFAULT_PREFS, type GyanzoPrefs } from './prefs';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const media = (): MediaQueryList | null =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY)
    : null;

/** Does the OS currently prefer dark mode? */
export function systemPrefersDark(): boolean {
  return media()?.matches ?? false;
}

/** Resolved theme for a stored choice (used for labels too). */
export function resolveTheme(choice: GyanzoPrefs['theme']): 'light' | 'dark' {
  if (choice === 'dark') return 'dark';
  if (choice === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

/** Apply theme / compact / reduce-motion classes to <html>. */
export function applyAppearance(prefs: GyanzoPrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolveTheme(prefs.theme) === 'dark');
  root.classList.toggle('gyanzo-compact', prefs.compact);
  root.classList.toggle('gyanzo-reduce-motion', prefs.reduceAnimations);
}

/** Reset to defaults (used on sign-out so the landing stays light). */
export function clearAppearance(): void {
  applyAppearance({ ...DEFAULT_PREFS });
}

/**
 * Re-apply appearance when the OS scheme changes while on "System".
 * Returns a cleanup function.
 */
export function watchSystemScheme(onChange: () => void): () => void {
  const m = media();
  if (!m) return () => {};
  const handler = () => onChange();
  m.addEventListener('change', handler);
  return () => m.removeEventListener('change', handler);
}
