'use client';

/**
 * Mobile bottom tab bar — the fast switcher for the five core study
 * surfaces: Dashboard, Quiz, Voice Tutor, Flashcards, Revision Notes.
 *
 * Visible below the lg breakpoint (the same breakpoint where the sidebar
 * collapses into the hamburger drawer); on desktop the full sidebar is
 * always on screen, so the bar would be redundant. Sits above the content
 * (fixed bottom), below the mobile drawer (z-50) and dialogs so overlays
 * always cover it, and respects the iOS home-indicator safe area.
 *
 * Labels come from the dedicated short `tab*` i18n keys (full sidebar
 * labels like "Wiederholungsnotizen" would not fit a 5-tab bar).
 */

import {
  HelpCircle,
  Layers,
  LayoutGrid,
  Mic,
  NotebookText,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

export default function MobileTabBar({
  active,
  onNavigate,
}: {
  /** Currently active nav id (same ids as the sidebar). */
  active: string;
  /** Navigate to a tab's view (wired to the dashboard's handleNav). */
  onNavigate: (id: string) => void;
}) {
  const { t } = useLanguage();
  const d = t.dashboard;

  const tabs = [
    { id: 'dashboard', icon: LayoutGrid, label: d.tabDashboard },
    { id: 'quiz', icon: HelpCircle, label: d.tabQuiz },
    { id: 'voice-tutor', icon: Mic, label: d.tabVoice },
    { id: 'flashcards', icon: Layers, label: d.tabFlashcards },
    { id: 'revision-notes', icon: NotebookText, label: d.tabNotes },
  ];

  return (
    <nav
      aria-label={d.a11yDashboard}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onNavigate(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full flex-col items-center gap-1 px-0.5 pb-1.5 pt-2 transition ${
                  isActive
                    ? 'text-emerald-600'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span
                  className={`flex h-7 w-11 items-center justify-center rounded-full transition ${
                    isActive ? 'bg-emerald-100/80' : ''
                  }`}
                >
                  <tab.icon
                    className="h-[18px] w-[18px] shrink-0"
                    strokeWidth={isActive ? 2.2 : 2}
                    aria-hidden="true"
                  />
                </span>
                <span className="max-w-full truncate text-[10px] font-medium leading-none">
                  {tab.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
