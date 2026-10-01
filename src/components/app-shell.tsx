'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import GyanzoIntro, { INTRO_GRADIENT } from '@/components/gyanzo/ganzo-intro';
import LandingPage from '@/components/landing/landing-page';
import Dashboard from '@/components/dashboard/dashboard';
import ProfileSetup, { type ProfileSetupResult } from '@/components/onboarding/profile-setup';
import { LanguageProvider, type LangCode } from '@/lib/i18n';
import { DEFAULT_LANG } from '@/lib/i18n/config';
import {
  getSessionSnapshot,
  getServerSessionSnapshot,
  setSession,
  subscribeSession,
  getProfileSetupPending,
  getProfileSetupServerSnapshot,
  subscribeProfileSetup,
  clearProfileSetup,
} from '@/lib/session';
import { loadPrefs, PREFS_EVENT } from '@/lib/prefs';
import {
  applyAppearance,
  clearAppearance,
  watchSystemScheme,
} from '@/lib/theme';

/**
 * Flow: the short intro plays full-screen on top of the (already mounted)
 * landing page. After ~2.6s it fades away and the landing page takes
 * over — one seamless redirect, nothing else on screen.
 *
 * Signed-in users (session in localStorage — created when a new account
 * verifies its email, or via sign-in) skip intro + landing entirely and
 * land straight on the Dashboard. Logging out returns to the landing page.
 *
 * LanguageProvider wraps everything so the intro, landing page, dashboard
 * and the flows they open all render — and switch live — in the user's
 * language.
 */
/** Subscribe to nothing — used by the client-only "is hydrated" probe. */
const emptySubscribe = () => () => {};

export default function AppShell({
  initialLang = DEFAULT_LANG,
}: {
  initialLang?: LangCode;
}) {
  // The intro mounts CLIENT-SIDE ONLY (after hydration). It is the only
  // framer-motion UI in the first-paint tree, and framer-motion forces a
  // client re-render during hydration — which regenerates React useId
  // slots and leaves the Radix language dropdown holding a stale server
  // id ("radix-_R_…" hydration mismatch). Rendering it after mount keeps
  // the hydration tree intro-free and error-free; the intro still plays
  // on every signed-out visit, just one tick later.
  // useSyncExternalStore is the lint-safe "is hydrated" probe: the server
  // snapshot is always false, the client snapshot true after hydration.
  const introMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [introVisible, setIntroVisible] = useState(true);
  const user = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot
  );
  // Set by the OAuth bridge page (real Google sign-in) or the demo
  // handler right after a BRAND-NEW Google account is created — shows
  // the Profile Setup onboarding on top of the Dashboard until done.
  const profileSetupPending = useSyncExternalStore(
    subscribeProfileSetup,
    getProfileSetupPending,
    getProfileSetupServerSnapshot
  );

  // Separate dismissal flag: the hydration probe above can't be written,
  // so "intro done / logged out" is tracked here ("never replay").
  const [introDismissed, setIntroDismissed] = useState(false);

  const handleIntroDone = useCallback(() => {
    // Fade the intro away, revealing the dark landing page beneath.
    setIntroVisible(false);
    window.setTimeout(() => setIntroDismissed(true), 750);
  }, []);

  const handleVerified = useCallback((next: { name: string; email: string }) => {
    setSession(next);
  }, []);

  /** Profile-completion onboarding finished — persist what was collected
   *  (college/semester/goals/photo + the profileCompletedAt stamp) so
   *  future sign-ins skip the onboarding, then drop the pending flag so
   *  the Dashboard shows through. The PATCH is best-effort: a network
   *  hiccup must never trap the user inside the onboarding. */
  const handleProfileSetupDone = useCallback(
    (result: ProfileSetupResult) => {
      const mail = user?.email;
      if (mail) {
        void fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: mail,
            avatar: result.avatar,
            college: result.college,
            semester: result.semester,
            goals: result.goals,
            profileComplete: true,
          }),
        }).catch(() => {});
      }
      // Show the picked photo in the header/profile straight away.
      if (user && result.avatar) {
        setSession({ name: user.name, email: user.email, avatar: result.avatar });
      }
      clearProfileSetup();
    },
    [user]
  );

  /** Profile-completion onboarding dismissed WITHOUT finishing (Escape) —
   *  drop the flag only. It will reappear on the next sign-in until the
   *  profile is actually completed. */
  const handleProfileSetupDismiss = useCallback(() => {
    clearProfileSetup();
  }, []);

  const handleLogout = useCallback(() => {
    setSession(null);
    // Never replay the intro after logging out within the same visit.
    setIntroDismissed(true);
    setIntroVisible(false);
  }, []);

  // Lock scrolling while the intro covers the screen.
  useEffect(() => {
    if (introMounted && !introDismissed && !user) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [introMounted, introDismissed, user]);

  // Appearance (Settings → Theme / Compact / Reduce Animations) applies
  // app-wide: on sign-in, whenever the prefs change, and when the OS
  // scheme flips while on "System". Signed-out → clean light defaults.
  const email = user?.email;
  useEffect(() => {
    if (!email) {
      clearAppearance();
      return;
    }
    const apply = () => applyAppearance(loadPrefs(email));
    apply();
    window.addEventListener(PREFS_EVENT, apply);
    const unwatch = watchSystemScheme(apply);
    return () => {
      window.removeEventListener(PREFS_EVENT, apply);
      unwatch();
    };
  }, [email]);

  return (
    <LanguageProvider initialLang={initialLang}>
      {user ? (
        <>
          <Dashboard user={user} onLogout={handleLogout} />
          {profileSetupPending && (
            <ProfileSetup
              user={{ name: user.name, email: user.email }}
              onClose={handleProfileSetupDismiss}
              onComplete={handleProfileSetupDone}
            />
          )}
        </>
      ) : (
        <>
          <div inert={introMounted && !introDismissed ? true : undefined}>
            <LandingPage onVerified={handleVerified} />
          </div>

          {introMounted && !introDismissed && (
            <div
              aria-hidden={!introVisible}
              className={`fixed inset-0 z-50 transition-opacity duration-700 ease-out ${
                introVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              style={{ background: INTRO_GRADIENT }}
            >
              <GyanzoIntro onDone={handleIntroDone} />
            </div>
          )}
        </>
      )}
    </LanguageProvider>
  );
}
