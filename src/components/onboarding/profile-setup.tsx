'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Camera,
  Check,
  Clock,
  GraduationCap,
  Landmark,
  Medal,
  Rocket,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';

/**
 * Profile setup onboarding — shown right after a new user verifies their
 * email (Sign Up → Verify Your Email → this flow). Matches the attached
 * design exactly:
 *
 *   Step 1  Photo     — "Upload Your Photo" (optional, ≤2MB image)
 *   Step 2  Academic  — college/university + semester
 *   Step 3  Goals     — pick at least one of six study goals
 *   Step 4  Ready     — "You're All Set!" summary → Go to Dashboard
 *
 * Light page, centered 4-dot stepper (green current/completed, navy
 * upcoming) and a dark navy card with a Back / Next footer strip.
 * Fully localized via useLanguage().
 */

export type ProfileUser = { name: string; email: string };

/** Study-goal ids (must match GOALS below and the /api/profile allow-list). */
export type GoalId = 'exams' | 'learn' | 'grades' | 'research' | 'competitive' | 'revision';

/** Everything collected during the onboarding, handed to the host when the
 *  user taps "Go to Dashboard" (persisted via PATCH /api/profile). */
export type ProfileSetupResult = {
  /** Center-cropped 256×256 JPEG data URL — null when no photo was picked. */
  avatar: string | null;
  college: string;
  /** Resolved, localized semester label (e.g. "Semester 3"). */
  semester: string;
  goals: GoalId[];
};

const EASE: [number, number, number, number] = [0.25, 0.6, 0.3, 1];

const slideVariants = {
  enter: (d: number) => ({ opacity: 0, x: d * 56 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * -56 }),
};

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2MB
const PHOTO_TYPES = /^image\/(jpeg|png|gif|webp)$/;

type GoalNameKey =
  | 'goalExams'
  | 'goalLearn'
  | 'goalGrades'
  | 'goalResearch'
  | 'goalCompetitive'
  | 'goalRevision';

const GOALS: { id: GoalId; nameKey: GoalNameKey; icon: LucideIcon; color: string; light: string }[] = [
  { id: 'exams', nameKey: 'goalExams', icon: Target, color: '#f43f5e', light: '#fff1f2' },
  { id: 'learn', nameKey: 'goalLearn', icon: Brain, color: '#3b82f6', light: '#eff6ff' },
  { id: 'grades', nameKey: 'goalGrades', icon: TrendingUp, color: '#10b981', light: '#ecfdf5' },
  { id: 'research', nameKey: 'goalResearch', icon: BookOpen, color: '#a855f7', light: '#faf5ff' },
  { id: 'competitive', nameKey: 'goalCompetitive', icon: Medal, color: '#f59e0b', light: '#fffbeb' },
  { id: 'revision', nameKey: 'goalRevision', icon: Clock, color: '#06b6d4', light: '#ecfeff' },
];

/* Summary-card pastel tints (step 4) */
const SUMMARY_TINTS = {
  college: '#e7efe9',
  goals: '#e9e9f4',
  ai: '#efe9dc',
};

export default function ProfileSetup({
  user,
  onClose,
  onComplete,
}: {
  user: ProfileUser;
  onClose: () => void;
  /** Called with everything collected once the user finishes the flow. */
  onComplete: (result: ProfileSetupResult) => void;
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const ps = t.profileSetup;

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  // Step 1 — photo (optional)
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Step 2 — academic
  const [college, setCollege] = useState('');
  const [semester, setSemester] = useState('none'); // Select value; 'none' = not specified

  // Step 3 — goals
  const [goals, setGoals] = useState<Set<GoalId>>(new Set());

  // Lock page scroll while the flow is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Prefill from the stored profile. After EVERY Google sign-in the user
  // re-walks this flow (product requirement: auth → Profile Completion →
  // Dashboard), so returning users get a quick pre-filled confirm instead
  // of re-typing everything; brand-new users have no stored profile and
  // simply see the empty defaults. Best-effort: any failure keeps defaults.
  useEffect(() => {
    let cancelled = false;
    const q = encodeURIComponent(user.email);
    (async () => {
      try {
        const res = await fetch(`/api/profile?email=${q}`);
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          profile?: {
            avatar?: string | null;
            college?: string | null;
            semester?: string | null;
            goals?: string[] | null;
          };
        } | null;
        if (cancelled || !res.ok || !json?.ok || !json.profile) return;
        const saved = json.profile;
        if (saved.avatar) setPhoto(saved.avatar);
        if (saved.college) setCollege(saved.college);
        if (saved.semester) {
          // Stored value is a localized label from a previous visit —
          // match it against the current language's labels.
          const idx = ps.semesters.findIndex((label) => label === saved.semester);
          if (idx >= 0) setSemester(String(idx));
        }
        if (saved.goals && saved.goals.length > 0) {
          const valid = saved.goals.filter((g): g is GoalId =>
            GOALS.some((goal) => goal.id === g)
          );
          if (valid.length > 0) setGoals(new Set(valid));
        }
      } catch {
        // Network hiccup → keep the empty defaults; the wizard still works.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deps match the established fetch-on-mount idiom (identity only).
  }, [user.email]);

  // Escape exits the flow — but only when the press belongs to THIS dialog.
  // Radix portals (e.g. the semester Select dropdown) render outside this
  // dialog's DOM subtree and consume their own Escape presses; without this
  // guard, closing the dropdown would close the whole onboarding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && !target.closest('[role="dialog"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep focus inside the dialog — on mount AND after every step change.
  // This is a plain overlay (not a Radix Dialog), so nothing captures focus
  // for us: on arrival from Google sign-in focus sits on <body>, and when
  // the clicked "Next"/"Back" button unmounts during a step transition
  // focus falls back to <body> too. Without this, the guarded Escape
  // handler would ignore the press and the user would be stuck.
  useEffect(() => {
    dialogRef.current?.focus();
  }, [step]);

  const firstName =
    user.name.trim().split(/\s+/)[0] || user.email.split('@')[0] || 'there';

  const goNext = () => {
    if (step < 3) {
      setDir(1);
      setStep((s) => s + 1);
    } else {
      toast({ title: ps.doneToastTitle, description: ps.doneToastDesc });
      finishSetup();
    }
  };

  /** Hand the collected profile to the host. The photo is center-cropped
   *  to 256×256 JPEG first (same treatment as the Profile section) so it
   *  always fits the avatar storage limit. */
  const finishSetup = () => {
    const shrinkPhoto = (): Promise<string | null> =>
      new Promise((resolve) => {
        if (!photo) {
          resolve(null);
          return;
        }
        const img = new window.Image();
        img.onload = () => {
          const S = 256;
          const canvas = document.createElement('canvas');
          canvas.width = S;
          canvas.height = S;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(photo.length <= 600_000 ? photo : null);
            return;
          }
          const scale = Math.max(S / img.naturalWidth, S / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(null);
        img.src = photo;
      });
    void shrinkPhoto().then((avatar) => {
      onComplete({
        avatar,
        college: college.trim(),
        semester: semesterName,
        goals: Array.from(goals),
      });
    });
  };

  const goBack = () => {
    if (step > 0) {
      setDir(-1);
      setStep((s) => s - 1);
    }
  };

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!PHOTO_TYPES.test(file.type)) {
      toast({ title: ps.photoBadType, variant: 'destructive' });
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast({ title: ps.photoTooLarge, variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  const toggleGoal = (id: GoalId) => {
    setGoals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Next is disabled on Academic (college required) and Goals (≥1 required). */
  const nextDisabled =
    (step === 1 && college.trim().length === 0) ||
    (step === 2 && goals.size === 0);

  const selectedGoalNames = GOALS.filter((g) => goals.has(g.id)).map(
    (g) => ps[g.nameKey]
  );
  const semesterName =
    semester === 'none' ? ps.semesterNone : ps.semesters[Number(semester)];

  return (
    <motion.div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={ps.ariaLabel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="font-brand fixed inset-0 z-[70] overflow-y-auto bg-gradient-to-b from-[#f2f5f3] to-[#eaeeea] outline-none"
    >
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 sm:py-14">
        {/* ── Stepper ──────────────────────────────────────────── */}
        <ol className="flex items-start" aria-label={ps.ariaLabel}>
          {ps.steps.map((label, i) => (
            <li key={label} className="flex items-start" aria-current={i === step ? 'step' : undefined}>
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`mt-[17px] h-[2px] w-8 rounded transition-colors duration-300 sm:w-12 ${
                    i <= step ? 'bg-emerald-500' : 'bg-[#22304a]'
                  }`}
                />
              )}
              <div className="flex w-14 flex-col items-center gap-2 sm:w-16">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold shadow-sm transition-colors duration-300 ${
                    i <= step
                      ? 'bg-emerald-500 text-white'
                      : 'bg-[#22304a] text-slate-300'
                  }`}
                >
                  {i < step ? (
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`text-xs font-semibold transition-colors duration-300 ${
                    i <= step ? 'text-emerald-600' : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
              </div>
            </li>
          ))}
        </ol>

        {/* ── Card ─────────────────────────────────────────────── */}
        <div className="mt-8 w-full max-w-[440px] overflow-hidden rounded-2xl bg-[#0d1521] shadow-[0_24px_70px_rgba(2,12,27,0.22)] sm:mt-10">
          <div className="relative overflow-hidden px-6 pb-8 pt-9 text-center sm:px-9">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={step}
                custom={dir}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.32, ease: EASE }}
              >
                {/* ── Step 1 · Photo ── */}
                {step === 0 && (
                  <div className="flex flex-col items-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500 shadow-lg shadow-purple-500/35">
                      <Camera className="h-7 w-7 text-white" aria-hidden="true" />
                    </div>
                    <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
                      {ps.photoTitle}
                    </h1>
                    <p className="mt-2 text-sm text-slate-400">{ps.photoSub}</p>

                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="sr-only"
                      aria-hidden="true"
                      tabIndex={-1}
                      onChange={(e) => {
                        handleFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      aria-label={photo ? ps.a11yChangePhoto : ps.a11yUpload}
                      className={`group mt-8 flex h-[120px] w-[120px] items-center justify-center rounded-full transition-colors ${
                        photo
                          ? 'overflow-hidden border-2 border-solid border-emerald-500/60'
                          : 'border-2 border-dashed border-slate-600 hover:border-emerald-500/70'
                      }`}
                    >
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${firstName} — ${ps.photoTitle}`}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex flex-col items-center gap-1 text-slate-400 transition-colors group-hover:text-emerald-400">
                          <Upload className="h-5 w-5" aria-hidden="true" />
                          <span className="text-xs font-medium">{ps.upload}</span>
                        </span>
                      )}
                    </button>

                    <p className="mt-6 text-base font-bold text-white">
                      {user.name.trim() || user.email}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{ps.fileHint}</p>
                  </div>
                )}

                {/* ── Step 2 · Academic ── */}
                {step === 1 && (
                  <div className="flex flex-col items-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/35">
                      <Landmark className="h-7 w-7 text-white" aria-hidden="true" />
                    </div>
                    <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
                      {ps.academicTitle}
                    </h1>
                    <p className="mt-2 text-sm text-slate-400">{ps.academicSub}</p>

                    <div className="mt-7 w-full text-left">
                      <label
                        htmlFor="profile-college"
                        className="text-sm font-semibold text-white"
                      >
                        {ps.collegeLabel}
                      </label>
                      <input
                        id="profile-college"
                        type="text"
                        value={college}
                        maxLength={80}
                        onChange={(e) => setCollege(e.target.value)}
                        placeholder={ps.collegePh}
                        autoComplete="organization"
                        className="mt-2 h-12 w-full rounded-lg border border-slate-700 bg-[#101a2b] px-4 text-[15px] text-white placeholder:text-slate-500 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                      />
                    </div>

                    <div className="mt-5 w-full text-left">
                      <span className="text-sm font-semibold text-white" id="semester-label">
                        {ps.semesterLabel}
                      </span>
                      {/* Always-visible tappable options (no dropdown portal):
                          works identically on desktop and touch, and matches
                          the Goals-step chip design language. */}
                      <div
                        className="mt-2.5 flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-labelledby="semester-label"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={semester === 'none'}
                          onClick={() => setSemester('none')}
                          className={`rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold transition-all duration-200 ${
                            semester === 'none'
                              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                              : 'border-slate-700 bg-[#101a2b] text-slate-200 hover:border-slate-500'
                          }`}
                        >
                          {ps.semesterNone}
                        </button>
                        {ps.semesters.map((name, idx) => {
                          const selected = semester === String(idx);
                          return (
                            <button
                              key={name}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setSemester(String(idx))}
                              className={`rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold transition-all duration-200 ${
                                selected
                                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                                  : 'border-slate-700 bg-[#101a2b] text-slate-200 hover:border-slate-500'
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Step 3 · Goals ── */}
                {step === 2 && (
                  <div className="flex flex-col items-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500 shadow-lg shadow-blue-500/35">
                      <Rocket className="h-7 w-7 text-white" aria-hidden="true" />
                    </div>
                    <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
                      {ps.goalsTitle}
                    </h1>
                    <p className="mt-2 text-sm text-slate-400">{ps.goalsSub}</p>

                    <div
                      className="mt-6 grid w-full grid-cols-2 gap-3"
                      role="group"
                      aria-label={ps.goalsTitle}
                    >
                      {GOALS.map((goal) => {
                        const selected = goals.has(goal.id);
                        const Icon = goal.icon;
                        return (
                          <button
                            key={goal.id}
                            type="button"
                            onClick={() => toggleGoal(goal.id)}
                            aria-pressed={selected}
                            style={{
                              backgroundColor: selected
                                ? `${goal.color}26`
                                : goal.light,
                              borderColor: selected ? goal.color : 'transparent',
                              color: goal.color,
                            }}
                            className="flex flex-col items-center gap-2.5 rounded-xl border-2 px-3 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                          >
                            <Icon className="h-6 w-6" strokeWidth={2.1} aria-hidden="true" />
                            <span className="text-[13px] font-semibold leading-tight">
                              {ps[goal.nameKey]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Step 4 · Ready ── */}
                {step === 3 && (
                  <div className="flex flex-col items-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/35">
                      <UserRound className="h-8 w-8 text-white" aria-hidden="true" />
                    </div>
                    <h1 className="mt-5 text-[26px] font-bold tracking-tight text-white">
                      {ps.readyTitle}
                    </h1>
                    <p className="mt-1.5 text-sm text-slate-400">
                      {ps.readyWelcome(firstName)}
                    </p>

                    <div className="mt-7 w-full space-y-3 text-left">
                      {/* College + semester */}
                      <div
                        className="flex items-center gap-3 rounded-xl px-4 py-3.5"
                        style={{ backgroundColor: SUMMARY_TINTS.college }}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/85 text-emerald-600">
                          <Landmark className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#12203a]">
                            {college.trim()}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {semesterName}
                          </p>
                        </div>
                      </div>

                      {/* Goals */}
                      <div
                        className="flex items-center gap-3 rounded-xl px-4 py-3.5"
                        style={{ backgroundColor: SUMMARY_TINTS.goals }}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/85 text-blue-600">
                          <Rocket className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#12203a]">
                            {ps.goalsSelected(goals.size)}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {selectedGoalNames.join(', ')}
                          </p>
                        </div>
                      </div>

                      {/* AI assistant */}
                      <div
                        className="flex items-center gap-3 rounded-xl px-4 py-3.5"
                        style={{ backgroundColor: SUMMARY_TINTS.ai }}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/85 text-orange-500">
                          <GraduationCap className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#12203a]">
                            {ps.aiTitle}
                          </p>
                          <p className="truncate text-xs text-slate-500">{ps.aiDesc}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Footer strip ─────────────────────────────────────── */}
          <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#0b111c] px-5 py-4 sm:px-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {ps.back}
              </button>
            ) : (
              <span aria-hidden="true" />
            )}

            <button
              type="button"
              onClick={goNext}
              disabled={nextDisabled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/25 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {step === 3 ? (
                <>
                  {ps.goToDashboard}
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </>
              ) : (
                <>
                  {ps.next}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
