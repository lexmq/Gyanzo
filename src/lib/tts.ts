/**
 * Sound + speech helpers shared by the AI features.
 *
 * - playAiSound: subtle two-tone chime when the AI finishes a response
 *   (Settings → Notifications → AI Response Sound).
 * - VOICE_PROFILES + pickSynthVoice: Voice Tutor voice personalities
 *   (Settings → Voice Tutor → Tutor voice / Speaking speed) mapped onto
 *   the browser's speechSynthesis voices + pitch shaping.
 */

import { loadPrefs, type TutorVoiceId } from './prefs';

export const VOICE_PROFILES: Record<
  TutorVoiceId,
  { pitch: number; prefer: RegExp }
> = {
  jam: { pitch: 0.92, prefer: /male|david|mark|alex|fred/i },
  aria: { pitch: 1.16, prefer: /female|samantha|karen|zira|victoria/i },
  leo: { pitch: 0.72, prefer: /male|daniel|george|google uk english male/i },
  mia: { pitch: 1.04, prefer: /female|moira|tessa|google us english/i },
};

/** Clamp the stored speaking speed into the slider's range. */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(2, Math.max(0.5, speed));
}

/** Play a gentle two-note chime if the user enabled AI Response Sound. */
export function playAiSound(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!loadPrefs(email).aiSound) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    gain.connect(ctx.destination);
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + i * 0.09);
      osc.stop(now + 0.42);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 600);
  } catch {
    /* audio unavailable — the chat reply still shows */
  }
}

/**
 * Pick a browser speech-synthesis voice matching the tutor profile and
 * the active UI language (falls back to the default voice gracefully).
 */
export function pickSynthVoice(
  prefer: RegExp,
  langTag: string
): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window))
    return null;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;
    const prefix = langTag.slice(0, 2).toLowerCase();
    const byLang = voices.filter((v) =>
      v.lang.replace('_', '-').toLowerCase().startsWith(prefix)
    );
    const pool = byLang.length > 0 ? byLang : voices;
    return pool.find((v) => prefer.test(v.name)) ?? pool[0] ?? null;
  } catch {
    return null;
  }
}
