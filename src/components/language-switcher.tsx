'use client';

/**
 * Language switcher — a small dropdown used across the whole app.
 *
 * Variants:
 *  - 'header'  → landing page header (dark navy background)
 *  - 'overlay' → full-screen dark overlays (onboarding) — white pill so
 *               it stays readable on the navy backdrop
 *  - 'light'   → light surfaces (landing header / auth pages — solid white pill)
 *  - 'icon'    → bare globe button for light top bars (dashboard)
 *
 * The menu is portaled by Radix, so `z-[80]` keeps it above the
 * z-[70] auth/onboarding overlays.
 */

import { Check, ChevronDown, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/i18n/config';

type Variant = 'header' | 'overlay' | 'light' | 'icon';

const TRIGGER_STYLES: Record<Variant, string> = {
  header:
    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-300 transition hover:text-white',
  overlay:
    'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50',
  light:
    'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50',
  icon:
    'flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100',
};

const CONTENT_STYLES: Record<Variant, string> = {
  header: 'border-white/10 bg-[#151d2b] text-white',
  overlay: 'border-slate-200 bg-white text-slate-700',
  light: 'border-slate-200 bg-white text-slate-700',
  icon: 'border-slate-200 bg-white text-slate-700',
};

const ITEM_STYLES: Record<Variant, string> = {
  header: 'data-[highlighted]:bg-white/10 data-[highlighted]:text-white',
  overlay: 'data-[highlighted]:bg-emerald-50 data-[highlighted]:text-emerald-900',
  light: 'data-[highlighted]:bg-emerald-50 data-[highlighted]:text-emerald-900',
  icon: 'data-[highlighted]:bg-emerald-50 data-[highlighted]:text-emerald-900',
};

export default function LanguageSwitcher({
  variant = 'header',
}: {
  variant?: Variant;
}) {
  const { lang, setLang, t } = useLanguage();
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={`${t.lang.label}: ${current.label}`}
        className={`${TRIGGER_STYLES[variant]} outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60`}
        /* Radix derives this button's id from React useId. In dev, Next 16's
         * server-side dev wrappers shift the SSR useId slots, so the server
         * HTML carries a different (stale) id than the client computes — a
         * console-only, recoverable mismatch ("this won't be patched up").
         * The menu itself is fully functional (ids are re-wired client-side
         * when it opens), so we silence the attribute warning. Verified:
         * opening + switching languages works in every variant. */
        suppressHydrationWarning
      >
        <Globe
          className={`h-3.5 w-3.5 shrink-0 ${variant === 'icon' ? 'h-[18px] w-[18px]' : ''}`}
          aria-hidden="true"
        />
        {variant !== 'icon' && <span>{current.short}</span>}
        {variant !== 'icon' && (
          <ChevronDown
            className="h-3 w-3 shrink-0 opacity-60"
            aria-hidden="true"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={`z-[80] min-w-[190px] rounded-xl p-1.5 ${CONTENT_STYLES[variant]}`}
      >
        <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-50">
          {t.lang.label}
        </p>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => setLang(l.code)}
            className={`cursor-pointer gap-2 rounded-lg py-2 text-sm ${ITEM_STYLES[variant]}`}
            aria-current={l.code === lang ? 'true' : undefined}
          >
            <span className="flex-1">{l.label}</span>
            {l.code === lang && (
              <Check
                className="h-4 w-4 shrink-0 text-emerald-500"
                aria-hidden="true"
              />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
