'use client';

import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { GraduationCap } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

const EASE_OUT: [number, number, number, number] = [0.22, 0.8, 0.3, 1];

/** Brand splash gradient — sampled straight from the Gyanzo splash art:
 *  deeper emerald at the top-left melting into teal at the bottom-right.
 *  Shared with AppShell so the fade-out overlay never flashes navy. */
export const INTRO_GRADIENT =
  'linear-gradient(135deg, #009c68 0%, #00b87b 52%, #00bba4 100%)';

/**
 * Gyanzo app intro — simple & short (~2.6s before handoff).
 * The brand logo pops in on the green→teal brand gradient canvas, the
 * wordmark and tagline fade up with a white underline sweep, then
 * `onDone` fires.
 *
 * Nothing else on screen: no header, no buttons, no skip.
 */
export default function GyanzoIntro({ onDone }: { onDone: () => void }) {
  const reducedMotion = useReducedMotion();
  const { t } = useLanguage();

  // Hold just long enough to read, then hand off to the landing page.
  useEffect(() => {
    const timer = window.setTimeout(onDone, reducedMotion ? 900 : 2600);
    return () => window.clearTimeout(timer);
  }, [onDone, reducedMotion]);

  return (
    <div
      className="relative h-dvh w-full select-none overflow-hidden text-white"
      style={{ background: INTRO_GRADIENT }}
    >
      {/* splash-art décor: soft lighter circles + white glow behind brand */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-[12vmin] -top-[16vmin] h-[48vmin] w-[48vmin] rounded-full bg-white/[0.07]" />
        <div className="absolute -bottom-[10vmin] -left-[8vmin] h-[30vmin] w-[30vmin] rounded-full bg-white/[0.06]" />
        <div className="absolute left-[18vmin] top-[36vmin] h-[16vmin] w-[16vmin] rounded-full bg-white/[0.05]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reducedMotion ? 0 : 1.3, ease: 'easeOut' }}
            className="h-[72vmin] w-[72vmin] rounded-full"
            style={{
              background:
                'radial-gradient(closest-side, rgba(255,255,255,0.2), transparent 72%)',
            }}
          />
        </div>
      </div>

      <main className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        {/* logo pop */}
        <motion.div
          initial={{
            opacity: 0,
            scale: reducedMotion ? 1 : 0.55,
            y: reducedMotion ? 0 : 12,
          }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 18,
            delay: reducedMotion ? 0 : 0.15,
          }}
          className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_18px_50px_rgba(0,90,60,0.45)] ring-1 ring-white/25 sm:h-24 sm:w-24"
        >
          <GraduationCap
            className="h-10 w-10 text-white sm:h-12 sm:w-12"
            strokeWidth={2.1}
          />
        </motion.div>

        {/* wordmark */}
        <motion.h1
          initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: reducedMotion ? 0 : 0.5 }}
          className="font-brand mt-6 text-4xl font-bold tracking-tight sm:text-5xl"
        >
          Gyanzo
        </motion.h1>

        {/* green underline sweep */}
        <motion.div
          aria-hidden="true"
          initial={{ scaleX: reducedMotion ? 1 : 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, ease: EASE_OUT, delay: reducedMotion ? 0 : 0.85 }}
          className="mt-4 h-1 w-24 origin-center rounded-full bg-gradient-to-r from-white via-white/85 to-white/45 sm:w-28"
        />

        {/* tagline */}
        <motion.p
          initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: reducedMotion ? 0 : 1.1 }}
          className="mt-5 text-sm leading-relaxed text-white/85 sm:text-base"
        >
          {t.intro.tagline}
        </motion.p>
      </main>

      <span className="sr-only" aria-live="polite">
        Gyanzo — {t.intro.tagline}
      </span>
    </div>
  );
}
