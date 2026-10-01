/**
 * Client-side session store — the signed-in identity (name + email) is
 * persisted in localStorage so a page refresh lands straight on the
 * Dashboard.
 *
 * Implemented as a tiny external store so React can read it via
 * `useSyncExternalStore` (no setState-in-effect, no hydration mismatch:
 * the server snapshot is always `null`, the client snapshot is the
 * persisted session).
 *
 * NOTE: this is a UI session only. No secrets are stored.
 */

export type SessionUser = {
  name: string;
  email: string;
  /** Profile photo data URL (client-resized ≤256px) — optional. */
  avatar?: string;
};

const SESSION_KEY = 'gyanzo-session';

/* ── Snapshot cache (stable references between store reads) ────── */
let cacheRaw: string | null | undefined;
let cacheVal: SessionUser | null = null;

function parse(raw: string | null): SessionUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionUser>;
    if (typeof parsed?.email !== 'string' || !parsed.email) return null;
    const name =
      typeof parsed.name === 'string' && parsed.name
        ? parsed.name
        : parsed.email.split('@')[0];
    // Avatar is optional and sanitized: only sane-sized image data URLs.
    const avatar =
      typeof parsed.avatar === 'string' &&
      parsed.avatar.startsWith('data:image/') &&
      parsed.avatar.length <= 400_000
        ? parsed.avatar
        : undefined;
    return avatar ? { name, email: parsed.email, avatar } : { name, email: parsed.email };
  } catch {
    return null;
  }
}

/** Client snapshot for useSyncExternalStore. */
export function getSessionSnapshot(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (cacheRaw !== undefined && raw === cacheRaw) return cacheVal;
  cacheRaw = raw;
  cacheVal = parse(raw);
  return cacheVal;
}

/** Server snapshot — never signed in during SSR/hydration. */
export function getServerSessionSnapshot(): SessionUser | null {
  return null;
}

/* ── Subscriptions (same-tab emits + cross-tab storage events) ─── */
const listeners = new Set<() => void>();

export function subscribeSession(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SESSION_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function emit(): void {
  listeners.forEach((l) => l());
}

/** Sign in (persist) or sign out (clear). Notifies subscribers. */
export function setSession(user: SessionUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // storage unavailable (private mode) — session just won't persist
  }
  emit();
}

/** "Kalu rampal" → "Kalu" (used in the welcome heading). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/* ── Profile-setup pending flag (new Google accounts) ──────────────
 * Written by the OAuth bridge page (real flow) or the demo handler
 * right after a BRAND-NEW Google account is created. The app shell
 * reads it via useSyncExternalStore and shows the Profile Setup
 * onboarding on top of the Dashboard until it's completed/dismissed.
 * Server snapshot is always false (localStorage is client-only). */
const PROFILE_SETUP_KEY = 'gyanzo-profile-setup';

let profileSetupCache: boolean | null = null;
const profileSetupListeners = new Set<() => void>();

/** Client snapshot for useSyncExternalStore (cached — stable identity). */
export function getProfileSetupPending(): boolean {
  if (typeof window === 'undefined') return false;
  if (profileSetupCache === null) {
    try {
      profileSetupCache =
        window.localStorage.getItem(PROFILE_SETUP_KEY) === '1';
    } catch {
      profileSetupCache = false;
    }
  }
  return profileSetupCache;
}

/** Server snapshot — never pending during SSR/hydration. */
export function getProfileSetupServerSnapshot(): boolean {
  return false;
}

export function subscribeProfileSetup(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  profileSetupListeners.add(onChange);
  return () => {
    profileSetupListeners.delete(onChange);
  };
}

function emitProfileSetup(): void {
  profileSetupListeners.forEach((l) => l());
}

/** Flag a newly-created (Google) account as needing profile setup. */
export function markProfileSetupPending(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROFILE_SETUP_KEY, '1');
  } catch {
    // storage unavailable — the onboarding simply won't auto-show
  }
  if (profileSetupCache !== true) {
    profileSetupCache = true;
    emitProfileSetup();
  }
}

/** Profile setup completed (or dismissed) — drop the flag. */
export function clearProfileSetup(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PROFILE_SETUP_KEY);
  } catch {
    // ignore
  }
  if (profileSetupCache !== false) {
    profileSetupCache = false;
    emitProfileSetup();
  }
}

/** "Kalu rampal" → "KR" — avatar initials. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  const first = parts[0][0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + second).toUpperCase();
}
