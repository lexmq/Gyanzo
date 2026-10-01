'use client';

/**
 * Study Planner section — 1:1 with the design screenshot: the "Study
 * Planner" header with the subtitle, a config card holding the SUBJECT
 * select, the EXAM DATE picker, the HOURS PER DAY select, the CHAPTERS
 * TO COVER input and the green "Generate Study Plan" button, and the
 * "No study plan yet" empty state with the on-device note.
 *
 * Fully functional: generating a plan paces the chosen number of chapters
 * across every day between today and the exam date (extra days become
 * revision-and-practice days) and marks the exam day as its own task.
 * Each daily task can be ticked off, progress is shown per plan, and
 * plans persist in localStorage under a per-user key — matching the
 * design's promise "Plans are saved on this device automatically".
 */

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CalendarDays,
  Check,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';
import {
  CHIP_STYLES,
  type Subject,
  type SubjectColor,
} from '@/components/dashboard/subject-styles';

/* ── Plan types ───────────────────────────────────────────────── */

type TaskKind = 'study' | 'revision' | 'exam';

type PlanTask = {
  /** Local yyyy-mm-dd */
  date: string;
  kind: TaskKind;
  /** First chapter of a study day (1-based) */
  from: number;
  /** Last chapter of a study day (inclusive) */
  to: number;
  done: boolean;
};

export type StudyPlan = {
  id: string;
  subjectId: string;
  subjectName: string;
  color: SubjectColor;
  /** Local yyyy-mm-dd */
  examDate: string;
  hoursPerDay: number;
  chapters: number;
  tasks: PlanTask[];
  createdAt: string;
};

/* ── Local-timezone-safe date helpers ─────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISODate(new Date());
const parseISODate = (iso: string) => new Date(`${iso}T00:00:00`);
const addDays = (iso: string, n: number) => {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};
const diffDays = (fromISO: string, toISO: string) =>
  Math.round(
    (parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) /
      86400000
  );
/** "Mon, Sep 15" */
const fmtDay = (iso: string) =>
  parseISODate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
/** "Sep 28, 2026" */
const fmtExamDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/* ── On-device storage (per user) ─────────────────────────────── */

const plansKey = (email: string) => `gyanzo.studyplans.${encodeURIComponent(email)}`;

function loadPlans(email: string): StudyPlan[] {
  try {
    const raw = localStorage.getItem(plansKey(email));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StudyPlan[]) : [];
  } catch {
    return [];
  }
}

function persistPlans(email: string, list: StudyPlan[]) {
  try {
    localStorage.setItem(plansKey(email), JSON.stringify(list));
  } catch {
    /* storage unavailable — plans simply stay for this session */
  }
}

const HOURS_OPTIONS = [1, 2, 3, 4, 5, 6];

/* ── View ─────────────────────────────────────────────────────── */

export default function StudyPlannerView({
  email,
  subjects,
  subjectsLoading,
  onNewSubject,
}: {
  email: string;
  subjects: Subject[];
  subjectsLoading: boolean;
  onNewSubject: () => void;
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const d = t.dashboard;

  /* ── State ──────────────────────────────────────────────────── */
  const [subjectId, setSubjectId] = useState('');
  const [examDate, setExamDate] = useState('');
  const [hours, setHours] = useState(2);
  const [chapters, setChapters] = useState('5');
  const [plans, setPlans] = useState<StudyPlan[] | null>(null); // null = not loaded yet

  /* ── Load saved plans once (client-only) ────────────────────── */
  useEffect(() => {
    setPlans(loadPlans(email));
  }, [email]);

  /* ── Default the subject to the first one once subjects land ── */
  useEffect(() => {
    if (!subjectsLoading && subjects.length > 0) {
      setSubjectId((prev) =>
        prev && subjects.some((s) => s.id === prev) ? prev : subjects[0].id
      );
    }
  }, [subjectsLoading, subjects]);

  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? null,
    [subjects, subjectId]
  );

  /* ── Generate ───────────────────────────────────────────────── */
  const generate = () => {
    if (!subject || !plans) return;
    if (!examDate) {
      toast({ title: d.spErrDate, variant: 'destructive' });
      return;
    }
    const start = todayISO();
    const days = diffDays(start, examDate);
    if (days < 1) {
      toast({ title: d.spErrPast, variant: 'destructive' });
      return;
    }
    const parsed = parseInt(chapters, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast({ title: d.spErrChapters, variant: 'destructive' });
      return;
    }
    const total = Math.min(parsed, 99);
    const base = Math.floor(total / days);
    const extra = total % days;
    const tasks: PlanTask[] = [];
    let ch = 1;
    for (let i = 0; i < days; i++) {
      const count = base + (i < extra ? 1 : 0);
      if (count > 0) {
        tasks.push({
          date: addDays(start, i),
          kind: 'study',
          from: ch,
          to: ch + count - 1,
          done: false,
        });
        ch += count;
      } else {
        tasks.push({
          date: addDays(start, i),
          kind: 'revision',
          from: 0,
          to: 0,
          done: false,
        });
      }
    }
    tasks.push({ date: examDate, kind: 'exam', from: 0, to: 0, done: false });

    const plan: StudyPlan = {
      id: `plan-${Date.now()}`,
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      examDate,
      hoursPerDay: hours,
      chapters: total,
      tasks,
      createdAt: new Date().toISOString(),
    };
    // One live plan per subject — regenerating replaces the old one.
    const next = [plan, ...plans.filter((p) => p.subjectId !== subject.id)];
    setPlans(next);
    persistPlans(email, next);
    toast({
      title: d.spCreatedTitle,
      description: d.spCreatedDesc(subject.name, days),
    });
  };

  /* ── Tick a daily task ──────────────────────────────────────── */
  const toggleTask = (planId: string, taskDate: string) => {
    if (!plans) return;
    const next = plans.map((p) =>
      p.id !== planId
        ? p
        : {
            ...p,
            tasks: p.tasks.map((tk) =>
              tk.date === taskDate ? { ...tk, done: !tk.done } : tk
            ),
          }
    );
    setPlans(next);
    persistPlans(email, next);
  };

  /* ── Delete a plan ──────────────────────────────────────────── */
  const deletePlan = (planId: string) => {
    if (!plans) return;
    const next = plans.filter((p) => p.id !== planId);
    setPlans(next);
    persistPlans(email, next);
    toast({ title: d.spDeleted });
  };

  /* ── Task label (computed at render so language switches apply) ── */
  const taskLabel = (tk: PlanTask): string => {
    if (tk.kind === 'exam') return d.spTaskExam;
    if (tk.kind === 'revision') return d.spTaskRevision;
    return d.spChapterRange(tk.from, tk.to);
  };

  const dayBadge = (iso: string) => {
    const delta = diffDays(todayISO(), iso);
    if (delta < 0)
      return { text: d.spExamPassed, cls: 'text-slate-400' } as const;
    if (delta === 0)
      return {
        text: d.spExamToday,
        cls: 'font-medium text-emerald-700',
      } as const;
    return {
      text: d.spDaysLeft(delta),
      cls:
        delta <= 7
          ? 'font-medium text-orange-600'
          : 'text-slate-500',
    } as const;
  };

  const hourOptions = HOURS_OPTIONS.map((n) => (
    <SelectItem key={n} value={String(n)}>
      {d.spHourOption(n)}
    </SelectItem>
  ));

  /* ── Page ───────────────────────────────────────────────────── */
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {d.spTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.spSubtitle}</p>

      {subjectsLoading ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : subjects.length === 0 ? (
        /* Empty state — no subject to plan for yet */
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <CalendarDays className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-base font-semibold text-slate-800">
            {d.spNoSubjectsTitle}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {d.spNoSubjectsDesc}
          </p>
          <Button
            onClick={onNewSubject}
            className="mt-6 h-9 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {d.createSubject}
          </Button>
        </div>
      ) : (
        <>
          {/* Config card — 1:1 with the screenshot */}
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="sp-subject"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                >
                  {d.spSubjectLabel}
                </Label>
                <Select
                  value={subjectId}
                  onValueChange={setSubjectId}
                >
                  <SelectTrigger
                    id="sp-subject"
                    aria-label={d.spSubjectLabel}
                    className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 rounded-xl border-slate-200">
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="sp-exam-date"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                >
                  {d.spExamDateLabel}
                </Label>
                <Input
                  id="sp-exam-date"
                  type="date"
                  value={examDate}
                  min={todayISO()}
                  onChange={(e) => setExamDate(e.target.value)}
                  aria-label={d.spExamDateLabel}
                  className="h-10 rounded-lg border-slate-200 text-sm text-slate-700"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="sp-hours"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                >
                  {d.spHoursLabel}
                </Label>
                <Select
                  value={String(hours)}
                  onValueChange={(v) => setHours(Number(v))}
                >
                  <SelectTrigger
                    id="sp-hours"
                    aria-label={d.spHoursLabel}
                    className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 rounded-xl border-slate-200">
                    {hourOptions}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="sp-chapters"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                >
                  {d.spChaptersLabel}
                </Label>
                <Input
                  id="sp-chapters"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={chapters}
                  onChange={(e) => setChapters(e.target.value)}
                  aria-label={d.spChaptersLabel}
                  className="h-10 rounded-lg border-slate-200 text-sm text-slate-700"
                />
              </div>
            </div>

            <Button
              onClick={generate}
              className="mt-5 h-10 gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              <Calendar className="h-4 w-4" aria-hidden="true" />
              {d.spGenerate}
            </Button>
          </section>

          {/* Plans area */}
          {plans === null ? (
            <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : plans.length === 0 ? (
            /* Empty state — 1:1 with the screenshot */
            <section
              className="mt-6 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:py-16"
              aria-live="polite"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CalendarDays className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-5 text-base font-semibold text-slate-800">
                {d.spEmptyTitle}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                {d.spEmptyDesc}
              </p>
              <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400">
                <Sparkles
                  className="h-3.5 w-3.5 text-emerald-500"
                  aria-hidden="true"
                />
                {d.spSavedNote}
              </p>
            </section>
          ) : (
            <section className="mt-8 pb-10" aria-label={d.spPlansHeading}>
              <h2 className="text-base font-semibold text-slate-800">
                {d.spPlansHeading}
              </h2>
              <div className="mt-3 space-y-4">
                {plans.map((plan) => {
                  const done = plan.tasks.filter((tk) => tk.done).length;
                  const totalTasks = plan.tasks.length;
                  const pct = Math.round((done / totalTasks) * 100);
                  const badge = dayBadge(plan.examDate);
                  const today = todayISO();
                  return (
                    <article
                      key={plan.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    >
                      {/* Card header */}
                      <div className="flex items-start gap-3.5 border-b border-slate-100 p-5 sm:p-6">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${CHIP_STYLES[plan.color]}`}
                        >
                          <BookOpen className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-semibold text-slate-900">
                            {plan.subjectName}
                          </h3>
                          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                            <span className="text-slate-400">
                              {d.spExamOn(fmtExamDate(plan.examDate))}
                            </span>
                            <span
                              className="text-slate-300"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span className={badge.cls}>{badge.text}</span>
                            <span
                              className="text-slate-300"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span className="text-slate-400">
                              {d.spHoursShort(plan.hoursPerDay)}
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => deletePlan(plan.id)}
                          aria-label={d.spDelete}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      {/* Progress */}
                      <div className="px-5 pt-4 sm:px-6">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">
                            {d.spTaskDoneOf(done, totalTasks)}
                          </span>
                          <span className="font-medium tabular-nums text-slate-400">
                            {pct}%
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                        >
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Daily tasks */}
                      <ul className="scrollbar-thin mt-3 max-h-96 space-y-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
                        {plan.tasks.map((tk) => {
                          const label = taskLabel(tk);
                          const isExam = tk.kind === 'exam';
                          const isToday = tk.date === today;
                          return (
                            <li
                              key={tk.date}
                              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${
                                isExam ? 'bg-emerald-50/70' : ''
                              }`}
                            >
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={tk.done}
                                aria-label={label}
                                onClick={() => toggleTask(plan.id, tk.date)}
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                                  tk.done
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-slate-300 bg-white hover:border-emerald-400'
                                }`}
                              >
                                {tk.done && (
                                  <Check
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                    strokeWidth={3}
                                  />
                                )}
                              </button>
                              <span className="w-24 shrink-0 text-xs tabular-nums text-slate-400">
                                {fmtDay(tk.date)}
                              </span>
                              <span
                                className={`min-w-0 flex-1 truncate text-sm ${
                                  tk.done
                                    ? 'text-slate-400 line-through'
                                    : isExam
                                      ? 'font-semibold text-emerald-700'
                                      : 'text-slate-700'
                                }`}
                              >
                                {label}
                              </span>
                              {isToday && !tk.done && (
                                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                                  {d.spToday}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
