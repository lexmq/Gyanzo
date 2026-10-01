'use client';

/**
 * Settings section — 1:1 with the design and fully functional:
 *
 *   Appearance      → Theme (System / Light / Dark, live), Compact Mode,
 *                     Reduce Animations (applied instantly via lib/theme)
 *   Language        → app-wide live language switch (6 languages)
 *   Notifications   → Quiz Reminders (bell), Study Goal Alerts (Progress),
 *                     AI Response Sound (chat chime), Email Digest
 *   Privacy         → Session Management + Log out
 *   About Gyanzo    → version, resolved theme, account, email
 *   Voice Tutor     → tutor voice personality + speaking speed, consumed
 *                     live by the Voice Tutor section via prefs
 *
 * Everything persists per user in localStorage (lib/prefs) and survives
 * reloads.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Accessibility,
  Bell,
  CalendarDays,
  Globe,
  LogOut,
  Mail,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Shrink,
  SlidersHorizontal,
  Sun,
  Target,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/i18n/config';
import {
  DEFAULT_PREFS,
  loadPrefs,
  PREFS_EVENT,
  savePrefs,
  type GyanzoPrefs,
  type ThemeChoice,
  type TutorVoiceId,
} from '@/lib/prefs';
import { applyAppearance, resolveTheme } from '@/lib/theme';

/* ── Small building blocks ─────────────────────────────────────────── */

function SectionCard({
  icon: Icon,
  chipClass,
  title,
  desc,
  children,
}: {
  icon: LucideIcon;
  chipClass: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex items-center gap-3.5 px-5 py-5 sm:px-6">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${chipClass}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{desc}</p>
        </div>
      </div>
      <div className="border-t border-slate-100 px-5 py-1.5 sm:px-6">
        {children}
      </div>
    </section>
  );
}

function Row({
  icon: Icon,
  label,
  desc,
  control,
  stacked,
}: {
  icon: LucideIcon;
  label: string;
  desc: string;
  control: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            {desc}
          </p>
        </div>
      </div>
      <div
        className={
          stacked
            ? 'w-full shrink-0 sm:max-w-md'
            : 'shrink-0 self-end sm:self-center'
        }
      >
        {control}
      </div>
    </div>
  );
}

/* ── The view ──────────────────────────────────────────────────────── */

export default function SettingsView({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => void;
}) {
  const { toast } = useToast();
  const { t, lang, setLang } = useLanguage();
  const d = t.dashboard;

  const [prefs, setPrefs] = useState<GyanzoPrefs | null>(null);
  const [speed, setSpeed] = useState(1); // slider thumb (persisted on commit)

  /* Load persisted preferences (client-only, SSR-safe) + live-sync
     when another surface changes the same prefs. */
  useEffect(() => {
    const sync = () => {
      const p = loadPrefs(email);
      setPrefs(p);
      setSpeed(p.tutorSpeed);
    };
    sync();
    window.addEventListener(PREFS_EVENT, sync);
    return () => window.removeEventListener(PREFS_EVENT, sync);
  }, [email]);

  /* Merge + persist + apply instantly. */
  const update = useCallback(
    (patch: Partial<GyanzoPrefs>, silent = false) => {
      const base = prefs ?? { ...DEFAULT_PREFS };
      const next = { ...base, ...patch };
      setPrefs(next);
      savePrefs(email, next);
      if ('theme' in patch || 'compact' in patch || 'reduceAnimations' in patch)
        applyAppearance(next);
      if (!silent) toast({ title: d.stSaved });
    },
    [prefs, email, d.stSaved, toast]
  );

  /* Theme segmented control (SSR-safe labels come from prefs post-mount). */
  const themeOptions: {
    value: ThemeChoice;
    label: string;
    icon: LucideIcon;
  }[] = [
    { value: 'system', label: d.stSystem, icon: Monitor },
    { value: 'light', label: d.stLight, icon: Sun },
    { value: 'dark', label: d.stDark, icon: Moon },
  ];

  const resolved = prefs ? resolveTheme(prefs.theme) : null;
  const resolvedLabel = resolved === 'dark' ? d.stDark : d.stLight;

  const voices: { value: TutorVoiceId; label: string }[] = [
    { value: 'jam', label: d.stVoiceJam },
    { value: 'aria', label: d.stVoiceAria },
    { value: 'leo', label: d.stVoiceLeo },
    { value: 'mia', label: d.stVoiceMia },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {d.stTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.stSubtitle}</p>

      <div className="mt-6 space-y-6">
        {/* ── Appearance ─────────────────────────────────────────── */}
        <SectionCard
          icon={Palette}
          chipClass="bg-violet-50 text-violet-600"
          title={d.stAppearance}
          desc={d.stAppearanceDesc}
        >
          <Row
            icon={Sun}
            label={d.stTheme}
            desc={prefs ? d.stThemeDesc(resolvedLabel) : ''}
            stacked
            control={
              <div
                role="group"
                aria-label={d.stTheme}
                className="flex w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto"
              >
                {themeOptions.map((o) => {
                  const active = (prefs?.theme ?? 'system') === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => update({ theme: o.value })}
                      aria-pressed={active}
                      className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition sm:flex-none sm:text-sm ${
                        active
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <o.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            }
          />
          <Row
            icon={Shrink}
            label={d.stCompact}
            desc={d.stCompactDesc}
            control={
              <Switch
                checked={prefs?.compact ?? false}
                onCheckedChange={(v) => update({ compact: v })}
                aria-label={d.stCompact}
                className="data-[state=checked]:bg-emerald-600"
              />
            }
          />
          <Row
            icon={Accessibility}
            label={d.stReduceAnim}
            desc={d.stReduceAnimDesc}
            control={
              <Switch
                checked={prefs?.reduceAnimations ?? false}
                onCheckedChange={(v) => update({ reduceAnimations: v })}
                aria-label={d.stReduceAnim}
                className="data-[state=checked]:bg-emerald-600"
              />
            }
          />
        </SectionCard>

        {/* ── Language ───────────────────────────────────────────── */}
        <SectionCard
          icon={Globe}
          chipClass="bg-emerald-50 text-emerald-600"
          title={d.stLanguage}
          desc={d.stLanguageSectionDesc}
        >
          <Row
            icon={Globe}
            label={d.stAppLanguage}
            desc={d.stAppLanguageDesc}
            control={
              <Select
                value={lang}
                onValueChange={(v) => setLang(v as typeof lang)}
              >
                <SelectTrigger
                  aria-label={d.stAppLanguage}
                  className="h-10 w-full rounded-lg border-slate-200 text-sm sm:w-52"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200">
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      <span className="flex items-center gap-2">
                        <span>{l.label}</span>
                        <span className="text-xs font-medium text-slate-400">
                          {l.short}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </SectionCard>

        {/* ── Notifications ──────────────────────────────────────── */}
        <SectionCard
          icon={Bell}
          chipClass="bg-amber-50 text-amber-600"
          title={d.stNotifications}
          desc={d.stNotifSectionDesc}
        >
          <Row
            icon={Target}
            label={d.stQuizReminders}
            desc={d.stQuizRemindersDesc}
            control={
              <Switch
                checked={prefs?.quizReminders ?? true}
                onCheckedChange={(v) => update({ quizReminders: v })}
                aria-label={d.stQuizReminders}
                className="data-[state=checked]:bg-emerald-600"
              />
            }
          />
          <Row
            icon={CalendarDays}
            label={d.stGoalAlerts}
            desc={d.stGoalAlertsDesc}
            control={
              <Switch
                checked={prefs?.studyGoalAlerts ?? true}
                onCheckedChange={(v) => update({ studyGoalAlerts: v })}
                aria-label={d.stGoalAlerts}
                className="data-[state=checked]:bg-emerald-600"
              />
            }
          />
          <Row
            icon={MessageSquare}
            label={d.stAiSound}
            desc={d.stAiSoundDesc}
            control={
              <Switch
                checked={prefs?.aiSound ?? false}
                onCheckedChange={(v) => update({ aiSound: v })}
                aria-label={d.stAiSound}
                className="data-[state=checked]:bg-emerald-600"
              />
            }
          />
          <Row
            icon={Mail}
            label={d.stEmailDigest}
            desc={d.stEmailDigestDesc}
            control={
              <Switch
                checked={prefs?.emailDigest ?? false}
                onCheckedChange={(v) => update({ emailDigest: v })}
                aria-label={d.stEmailDigest}
                className="data-[state=checked]:bg-emerald-600"
              />
            }
          />
        </SectionCard>

        {/* ── Privacy & Security ─────────────────────────────────── */}
        <SectionCard
          icon={ShieldCheck}
          chipClass="bg-sky-50 text-sky-600"
          title={d.stPrivacy}
          desc={d.stPrivacyDesc}
        >
          <Row
            icon={ShieldCheck}
            label={d.stSession}
            desc={d.stSessionDesc}
            control={
              <Button
                variant="outline"
                onClick={onLogout}
                className="h-9 w-full rounded-lg border-rose-200 px-4 text-sm font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:w-auto"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {d.stLogout}
              </Button>
            }
          />
        </SectionCard>

        {/* ── About Gyanzo ───────────────────────────────────────── */}
        <SectionCard
          icon={SlidersHorizontal}
          chipClass="bg-emerald-50 text-emerald-600"
          title={d.stAboutGyanzo}
          desc={d.stAboutGyanzoDesc}
        >
          <dl className="py-2">
            {[
              { k: d.stVersionLabel, v: '1.0.0' },
              { k: d.stThemeLabel, v: prefs ? resolvedLabel : '—' },
              { k: d.stAccountLabel, v: d.stAccountStudent },
              { k: d.stEmailLabel, v: email },
            ].map((row) => (
              <div
                key={row.k}
                className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <dt className="text-sm text-slate-500">{row.k}</dt>
                <dd className="break-all text-sm font-semibold text-slate-900">
                  {row.v}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>

        {/* ── Voice Tutor ────────────────────────────────────────── */}
        <SectionCard
          icon={Mic}
          chipClass="bg-emerald-50 text-emerald-600"
          title={d.stVoiceTutor}
          desc={d.stVoiceTutorDesc}
        >
          <div className="py-4">
            <p className="text-sm font-medium text-slate-700">
              {d.stTutorVoice}
            </p>
            <Select
              value={prefs?.tutorVoice ?? 'jam'}
              onValueChange={(v) => update({ tutorVoice: v as TutorVoiceId })}
            >
              <SelectTrigger
                aria-label={d.stTutorVoice}
                className="mt-2 h-10 w-full max-w-xs rounded-lg border-slate-200 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-200">
                {voices.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="mt-6 flex max-w-md items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-700">
                {d.stSpeakingSpeed}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                {speed.toFixed(1)}×
              </span>
            </div>
            <Slider
              value={[speed]}
              min={0.5}
              max={2}
              step={0.1}
              onValueChange={([v]) => setSpeed(v)}
              onValueCommit={([v]) => {
                setSpeed(v);
                update({ tutorSpeed: v });
              }}
              aria-label={d.stSpeakingSpeed}
              className="mt-3 max-w-md"
            />
            <div className="mt-2 flex max-w-md items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span>{d.stSlower}</span>
              <span>{d.stFaster}</span>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
