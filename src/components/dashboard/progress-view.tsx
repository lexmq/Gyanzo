'use client';

/**
 * Progress section — the user's study journey at a glance, built entirely
 * from real data aggregated by GET /api/progress: study materials, quiz
 * performance, flashcard mastery, AI documents generated, a 7-day activity
 * chart, the study streak, a per-subject breakdown and recent quiz scores.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  FileText,
  Flame,
  HelpCircle,
  Layers,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';
import { loadPrefs, PREFS_EVENT } from '@/lib/prefs';
import {
  BORDER_STYLES,
  CHIP_STYLES,
  type Subject,
  type SubjectColor,
} from '@/components/dashboard/subject-styles';
import { formatDate, type Pdf } from '@/components/dashboard/pdf-utils';

export type ProgressData = {
  subjects: number;
  pdfs: number;
  quizCount: number;
  quizAvgPct: number;
  recentAttempts: { subjectName: string; scorePct: number; createdAt: string }[];
  decks: number;
  cardsTotal: number;
  cardsKnown: number;
  generated: {
    summaries: number;
    explanations: number;
    notes: number;
    mindMaps: number;
    citations: number;
    vocabLists: number;
    predictions: number;
    formulaSheets: number;
    total: number;
  };
  streakDays: number;
  activityByDay: { date: string; count: number }[];
  perSubject: { name: string; pdfs: number; quizzes: number }[];
};

export default function ProgressView({
  email,
  subjects,
  subjectsLoading,
}: {
  email: string;
  subjects: Subject[];
  subjectsLoading: boolean;
  pdfs: Pdf[];
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const d = t.dashboard;

  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  // Settings → Notifications → Study Goal Alerts (real "at risk" signal:
  // prior study activity exists but today's streak is broken).
  const [goalAlerts, setGoalAlerts] = useState(true);

  useEffect(() => {
    const sync = () => setGoalAlerts(loadPrefs(email).studyGoalAlerts);
    sync();
    window.addEventListener(PREFS_EVENT, sync);
    return () => window.removeEventListener(PREFS_EVENT, sync);
  }, [email]);

  const goalAtRisk =
    goalAlerts &&
    data !== null &&
    data.streakDays === 0 &&
    data.quizCount + data.decks + data.generated.total > 0;

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/progress?email=${encodeURIComponent(email)}`
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        progress?: ProgressData;
      } | null;
      if (res.ok && json?.ok && json.progress) {
        setData(json.progress);
      } else {
        toast({ title: d.pgLoadFailed, variant: 'destructive' });
      }
    } catch {
      toast({ title: d.pgLoadFailed, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, d.pgLoadFailed, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = loading || subjectsLoading;

  const OVERVIEW: {
    label: string;
    value: string;
    hint: string;
    icon: typeof BookOpen;
    color: SubjectColor;
  }[] =
    data === null
      ? []
      : [
          {
            label: d.pgMaterials,
            value: `${data.subjects}`,
            hint: d.pgMaterialsValue(data.subjects, data.pdfs),
            icon: BookOpen,
            color: 'emerald',
          },
          {
            label: d.pgQuizAvg,
            value: `${data.quizAvgPct}%`,
            hint: d.pgQuizCount(data.quizCount),
            icon: HelpCircle,
            color: 'teal',
          },
          {
            label: d.pgFcMastery,
            value:
              data.cardsTotal > 0
                ? `${Math.round((data.cardsKnown / data.cardsTotal) * 100)}%`
                : '—',
            hint: d.pgFcValue(data.cardsKnown, data.cardsTotal),
            icon: Layers,
            color: 'orange',
          },
          {
            label: d.pgAiDocs,
            value: `${data.generated.total}`,
            hint: d.pgAiDocsValue(data.generated.total),
            icon: Sparkles,
            color: 'violet',
          },
        ];

  const maxDay = data
    ? Math.max(1, ...data.activityByDay.map((a) => a.count))
    : 1;
  const hasAnyActivity =
    data !== null &&
    (data.quizCount > 0 ||
      data.decks > 0 ||
      data.generated.total > 0 ||
      data.pdfs > 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {d.pgTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.pgSubtitle}</p>

      {goalAtRisk && (
        <div
          role="status"
          className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70 text-amber-600">
            <Flame className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {d.stGoalRiskTitle}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
              {d.stGoalRiskDesc}
            </p>
          </div>
        </div>
      )}

      {busy ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !hasAnyActivity ? (
        /* Nothing to show yet */
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Sparkles className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-500">
            {d.pgEmpty}
          </p>
        </div>
      ) : (
        data && (
          <>
            {/* Streak banner */}
            <section
              aria-label={d.pgStreak}
              className={`mt-6 flex items-center gap-3 rounded-2xl border p-4 sm:p-5 ${BORDER_STYLES.amber} bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${CHIP_STYLES.amber}`}
              >
                <Flame className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {d.pgStreak}
                  {': '}
                  {data.streakDays > 0
                    ? d.pgStreakDays(data.streakDays)
                    : d.pgNoStreak}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {d.pgWeeklyDesc}
                </p>
              </div>
            </section>

            {/* Overview cards */}
            <section
              aria-label={d.pgOverview}
              className="mt-4 grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
            >
              {OVERVIEW.map((o) => (
                <div
                  key={o.label}
                  className={`rounded-xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5 ${BORDER_STYLES[o.color]}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-slate-600 sm:text-sm">
                      {o.label}
                    </p>
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CHIP_STYLES[o.color]}`}
                    >
                      <o.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mt-2.5 text-2xl font-bold tabular-nums sm:text-3xl">
                    {o.value}
                  </p>
                  <p className="mt-1.5 truncate text-[11px] text-slate-400 sm:text-xs">
                    {o.hint}
                  </p>
                </div>
              ))}
            </section>

            {/* Weekly activity chart */}
            <section
              aria-label={d.pgWeeklyActivity}
              className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
            >
              <h2 className="text-base font-semibold text-slate-800">
                {d.pgWeeklyActivity}
              </h2>
              <p className="mt-1 text-xs text-slate-500">{d.pgWeeklyDesc}</p>
              {data.activityByDay.every((a) => a.count === 0) ? (
                <p className="mt-6 text-sm text-slate-400">
                  {d.pgNoActivityWeek}
                </p>
              ) : (
                <div className="mt-6 flex h-40 items-end gap-2 sm:gap-4">
                  {data.activityByDay.map((day) => {
                    const pct = Math.round((day.count / maxDay) * 100);
                    const dt = new Date(`${day.date}T12:00:00`);
                    return (
                      <div
                        key={day.date}
                        className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                      >
                        <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                          {day.count}
                        </span>
                        <div
                          className={`w-full max-w-10 rounded-t-md transition-all ${
                            day.count > 0
                              ? 'bg-emerald-500'
                              : 'bg-slate-100'
                          }`}
                          style={{ height: `${Math.max(day.count > 0 ? 8 : 4, pct)}%` }}
                          role="img"
                          aria-label={`${day.date}: ${day.count}`}
                        />
                        <span className="truncate text-[10px] text-slate-400 sm:text-[11px]">
                          {dt.toLocaleDateString(undefined, {
                            weekday: 'short',
                          })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {/* Subject breakdown */}
              <section
                aria-label={d.pgSubjectBreakdown}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
              >
                <h2 className="text-base font-semibold text-slate-800">
                  {d.pgSubjectBreakdown}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {data.perSubject.map((s, i) => {
                    const color =
                      subjects.find((x) => x.name === s.name)?.color ??
                      'emerald';
                    return (
                      <li
                        key={`${s.name}-${i}`}
                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5"
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CHIP_STYLES[color]}`}
                        >
                          <BookOpen className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                          {s.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">
                          {d.pgPerSubject(s.pdfs, s.quizzes)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Recent quiz scores */}
              <section
                aria-label={d.pgRecentScores}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
              >
                <h2 className="text-base font-semibold text-slate-800">
                  {d.pgRecentScores}
                </h2>
                {data.recentAttempts.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-400">
                    {d.pgNoQuizzes}
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2.5">
                    {data.recentAttempts.map((a, i) => (
                      <li
                        key={`${a.createdAt}-${i}`}
                        className="flex items-center gap-3"
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CHIP_STYLES.teal}`}
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-700">
                            {a.subjectName || d.quizGeneralQuiz}
                          </span>
                          <span className="block text-xs text-slate-400">
                            {formatDate(a.createdAt)}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                            a.scorePct >= 60
                              ? 'bg-emerald-50 text-emerald-600'
                              : a.scorePct >= 40
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-rose-50 text-rose-600'
                          }`}
                        >
                          {a.scorePct}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
