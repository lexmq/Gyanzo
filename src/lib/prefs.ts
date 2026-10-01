/**
 * Gyanzo user preferences — small client-side settings persisted in
 * localStorage per signed-in user (Settings section writes them, the
 * dashboard bell, AI chat, Voice Tutor and the app shell read them).
 *
 * Key: `gyanzo.prefs.<email>` → JSON GyanzoPrefs
 * Safe to call on the server (returns defaults, no-ops on write).
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type TutorVoiceId = 'jam' | 'aria' | 'leo' | 'mia';

export type GyanzoPrefs = {
  /** Show the welcome notification badge in the top bar. */
  notifications: boolean;
  /** Voice Tutor automatically speaks each answer aloud. */
  autoSpeak: boolean;
  /** Appearance → Theme (light / dark / follow the system). */
  theme: ThemeChoice;
  /** Appearance → Compact Mode (denser layout). */
  compact: boolean;
  /** Appearance → Reduce Animations (disable motion). */
  reduceAnimations: boolean;
  /** Notifications → remind about pending quizzes (bell item). */
  quizReminders: boolean;
  /** Notifications → alert when study goals are at risk (Progress). */
  studyGoalAlerts: boolean;
  /** Notifications → subtle sound when the AI finishes a response. */
  aiSound: boolean;
  /** Notifications → weekly email digest opt-in. */
  emailDigest: boolean;
  /** Voice Tutor → tutor voice personality. */
  tutorVoice: TutorVoiceId;
  /** Voice Tutor → speaking speed (0.5× – 2×). */
  tutorSpeed: number;
};

export const DEFAULT_PREFS: GyanzoPrefs = {
  notifications: true,
  autoSpeak: true,
  theme: 'system',
  compact: false,
  reduceAnimations: false,
  quizReminders: true,
  studyGoalAlerts: true,
  aiSound: false,
  emailDigest: false,
  tutorVoice: 'jam',
  tutorSpeed: 1,
};

export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];
export const TUTOR_VOICES: TutorVoiceId[] = ['jam', 'aria', 'leo', 'mia'];

const keyFor = (email: string): string =>
  `gyanzo.prefs.${email.trim().toLowerCase()}`;

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

/** Read the user's stored preferences (defaults when missing/corrupt). */
export function loadPrefs(email: string): GyanzoPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(keyFor(email));
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      notifications: bool(p.notifications, DEFAULT_PREFS.notifications),
      autoSpeak: bool(p.autoSpeak, DEFAULT_PREFS.autoSpeak),
      theme: THEME_CHOICES.includes(p.theme as ThemeChoice)
        ? (p.theme as ThemeChoice)
        : DEFAULT_PREFS.theme,
      compact: bool(p.compact, DEFAULT_PREFS.compact),
      reduceAnimations: bool(
        p.reduceAnimations,
        DEFAULT_PREFS.reduceAnimations
      ),
      quizReminders: bool(p.quizReminders, DEFAULT_PREFS.quizReminders),
      studyGoalAlerts: bool(p.studyGoalAlerts, DEFAULT_PREFS.studyGoalAlerts),
      aiSound: bool(p.aiSound, DEFAULT_PREFS.aiSound),
      emailDigest: bool(p.emailDigest, DEFAULT_PREFS.emailDigest),
      tutorVoice: TUTOR_VOICES.includes(p.tutorVoice as TutorVoiceId)
        ? (p.tutorVoice as TutorVoiceId)
        : DEFAULT_PREFS.tutorVoice,
      tutorSpeed:
        typeof p.tutorSpeed === 'number' &&
        Number.isFinite(p.tutorSpeed) &&
        p.tutorSpeed >= 0.5 &&
        p.tutorSpeed <= 2
          ? p.tutorSpeed
          : DEFAULT_PREFS.tutorSpeed,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Event name dispatched on `window` whenever preferences are saved. */
export const PREFS_EVENT = 'gyanzo:prefs-changed';

/** Persist the user's preferences (best-effort — private mode tolerated). */
export function savePrefs(email: string, prefs: GyanzoPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(email), JSON.stringify(prefs));
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
  // Same-tab subscribers (dashboard bell, Voice Tutor, theme) update live.
  window.dispatchEvent(
    new CustomEvent(PREFS_EVENT, { detail: { email, prefs } })
  );
}
