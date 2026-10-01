'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import LanguageSwitcher from '@/components/language-switcher';
import { useLanguage } from '@/lib/i18n';

/**
 * Gyanzo onboarding — shown when a user taps "Start learning free" /
 * "Get started". A full-screen dark experience with four slides:
 * Your Smart Study Companion → AI-Powered Learning → Track Your Progress →
 * Ready to Excel? (Get Started).
 * Skip (top-right) dismisses; the last slide's "Get Started" completes.
 * Fully localized via useLanguage(), with a language switcher so the
 * whole app can be translated before signing up.
 */

type SlideConfig = {
  id: string;
  icon: LucideIcon;
  circleClass: string;
  iconClass: string;
  decoClass: string;
  buttonClass: string;
  emoji?: string;
  /** Dictionary keys for the slide copy. */
  titleKey: 's1Title' | 's2Title' | 's3Title' | 's4Title';
  descKey: 's1Desc' | 's2Desc' | 's3Desc' | 's4Desc';
};

const SLIDES: SlideConfig[] = [
  {
    id: 'companion',
    icon: BookOpen,
    circleClass: 'bg-emerald-100',
    iconClass: 'text-emerald-600',
    decoClass: 'bg-emerald-500',
    buttonClass:
      'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25',
    titleKey: 's1Title',
    descKey: 's1Desc',
  },
  {
    id: 'ai',
    icon: Brain,
    circleClass: 'bg-purple-100',
    iconClass: 'text-purple-600',
    decoClass: 'bg-purple-500',
    buttonClass:
      'bg-gradient-to-r from-violet-600 to-purple-500 shadow-lg shadow-purple-500/25',
    titleKey: 's2Title',
    descKey: 's2Desc',
  },
  {
    id: 'progress',
    icon: Target,
    circleClass: 'bg-amber-100',
    iconClass: 'text-orange-500',
    decoClass: 'bg-orange-500',
    buttonClass:
      'bg-gradient-to-r from-amber-500 to-orange-600 shadow-lg shadow-orange-500/30',
    titleKey: 's3Title',
    descKey: 's3Desc',
  },
  {
    id: 'excel',
    icon: Sparkles,
    circleClass: 'bg-rose-100',
    iconClass: 'text-rose-500',
    decoClass: 'bg-rose-500',
    buttonClass:
      'bg-gradient-to-r from-rose-500 to-pink-600 shadow-lg shadow-rose-500/30',
    emoji: '🎓',
    titleKey: 's4Title',
    descKey: 's4Desc',
  },
];

const slideVariants = {
  enter: (d: number) => ({ x: d * 90, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d * -90, opacity: 0 }),
};

const EASE: [number, number, number, number] = [0.25, 0.6, 0.3, 1];

export default function OnboardingFlow({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  // Lock page scroll while the flow is open (component only mounts when open,
  // so index/dir always start fresh — no reset effects needed).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const slide = SLIDES[index];
  const Icon = slide.icon;
  const isLast = index === SLIDES.length - 1;

  const goNext = () => {
    if (!isLast) {
      setDir(1);
      setIndex((i) => i + 1);
    } else {
      onComplete();
    }
  };

  const goBack = () => {
    if (index > 0) {
      setDir(-1);
      setIndex((i) => i - 1);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.onboarding.ariaLabel}
      className="font-brand fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#0b0f17]"
    >
      {/* Language switcher + Skip */}
      <div className="flex w-full items-center justify-between px-5 pt-4 sm:px-8 sm:pt-6">
        <LanguageSwitcher variant="overlay" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm font-medium text-slate-400 transition hover:text-white"
        >
          {t.onboarding.skip}
        </button>
      </div>

      {/* animated slide content — centered in the remaining space */}
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={slide.id}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.32, ease: EASE }}
            className="flex flex-col items-center"
          >
            <div className="relative">
              <div
                className={`flex h-44 w-44 items-center justify-center rounded-full ${slide.circleClass}`}
              >
                <Icon
                  className={`h-16 w-16 ${slide.iconClass}`}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
              </div>
              {/* decorative dots — top-right of the circle */}
              <div
                className="absolute -right-4 -top-7 flex gap-2"
                aria-hidden="true"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${slide.decoClass}`} />
                <span className={`h-1.5 w-1.5 rounded-full opacity-50 ${slide.decoClass}`} />
                <span className={`h-1.5 w-1.5 rounded-full opacity-25 ${slide.decoClass}`} />
              </div>
            </div>

            <h2 className="mt-10 max-w-[440px] text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              {t.onboarding[slide.titleKey]}
            </h2>
            <p className="mt-4 max-w-[400px] text-sm leading-relaxed text-slate-400 sm:text-[15px]">
              {t.onboarding[slide.descKey]}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* progress dots — 4 slots */}
      <div className="flex items-center justify-center gap-2" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span
            key={s.id}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === index ? 'w-7 bg-emerald-500' : 'w-2 bg-slate-500'
            }`}
          />
        ))}
      </div>

      {/* controls */}
      <div className="mx-auto mt-6 w-full max-w-[400px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex w-full items-center gap-4">
          {index > 0 ? (
            <button
              type="button"
              onClick={goBack}
              aria-label={t.onboarding.back}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={goNext}
            className={`flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full text-[15px] font-semibold text-white transition hover:opacity-95 ${slide.buttonClass}`}
          >
            {isLast ? t.onboarding.getStarted : t.onboarding.next}
            {slide.emoji ? (
              <span aria-hidden="true">{slide.emoji}</span>
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
