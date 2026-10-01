'use client';

/**
 * Exam Prediction section — the "Exam Prediction" header ("AI-flagged
 * questions most likely to appear in your exam."), a config card
 * (SUBJECT select + document-context helper + the green "Predict Exam
 * Questions" sparkle button) and, once a run is open, the predictions
 * card with likelihood summary chips and expandable model answers plus
 * the "Recent predictions" history.
 *
 * Fully functional: POST /api/exam-prediction asks the LLM for the 8-10
 * exam questions most likely to appear — grounded in the extracted text
 * of the subject's uploaded PDFs (general-syllabus fallback). Each
 * prediction carries a likelihood (high / medium / low), its topic and
 * an expandable answer outline. Runs survive reloads and can be
 * reopened or deleted from the history.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Loader2,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';
import { CHIP_STYLES, type Subject } from '@/components/dashboard/subject-styles';
import { formatDate, type Pdf } from '@/components/dashboard/pdf-utils';

export type Prediction = {
  question: string;
  likelihood: 'high' | 'medium' | 'low';
  topic: string;
  answerOutline: string;
};

export type ExamPredictionItem = {
  id: string;
  subjectId: string | null;
  subjectName: string;
  title: string;
  predictions: Prediction[];
  createdAt: string;
};

const LIKELIHOOD_ORDER: Record<Prediction['likelihood'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const LIKELIHOOD_BADGE: Record<Prediction['likelihood'], string> = {
  high: 'bg-rose-50 text-rose-600',
  medium: 'bg-amber-50 text-amber-600',
  low: 'bg-emerald-50 text-emerald-600',
};

/* ── One prediction card with an expandable model answer ──────────── */
function PredictionCard({
  prediction,
  modelAnswerLabel,
  likelihoodLabel,
}: {
  prediction: Prediction;
  modelAnswerLabel: string;
  likelihoodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${LIKELIHOOD_BADGE[prediction.likelihood]}`}
        >
          {likelihoodLabel}
        </span>
        {prediction.topic && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
            {prediction.topic}
          </span>
        )}
      </div>
      <p className="mt-2.5 font-medium leading-relaxed text-slate-900">
        {prediction.question}
      </p>
      {prediction.answerOutline && (
        <>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-emerald-700 transition hover:text-emerald-800"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${
                open ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
            {modelAnswerLabel}
          </button>
          {open && (
            <p className="mt-2 rounded-lg bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600">
              {prediction.answerOutline}
            </p>
          )}
        </>
      )}
    </li>
  );
}

export default function ExamPredictionView({
  email,
  subjects,
  subjectsLoading,
  pdfs,
  onNewSubject,
}: {
  email: string;
  subjects: Subject[];
  subjectsLoading: boolean;
  pdfs: Pdf[];
  onNewSubject: () => void;
}) {
  const { toast } = useToast();
  const { t, lang } = useLanguage();
  const d = t.dashboard;

  /* ── Builder state ──────────────────────────────────────────── */
  const [subjectId, setSubjectId] = useState('');
  const [generating, setGenerating] = useState(false);

  /* ── Saved runs + the open one ──────────────────────────────── */
  const [runs, setRuns] = useState<ExamPredictionItem[]>([]);
  const [current, setCurrent] = useState<ExamPredictionItem | null>(null);

  /* ── Derived ────────────────────────────────────────────────── */
  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? null,
    [subjects, subjectId]
  );
  const subjectDocs = useMemo(
    () =>
      subject ? pdfs.filter((p) => p.subjectName === subject.name) : [],
    [pdfs, subject]
  );

  /* Subject color chip for the open run (neutral when the subject
     was deleted meanwhile). */
  const currentChip = useMemo(() => {
    const color = subjects.find(
      (s) => s.id === current?.subjectId
    )?.color;
    return color ? CHIP_STYLES[color] : 'bg-slate-100 text-slate-600';
  }, [subjects, current?.subjectId]);

  /* Predictions sorted high → medium → low. */
  const sortedPredictions = useMemo(() => {
    if (!current) return [];
    return [...current.predictions].sort(
      (a, b) => LIKELIHOOD_ORDER[a.likelihood] - LIKELIHOOD_ORDER[b.likelihood]
    );
  }, [current]);

  /* Likelihood counts for the summary chips. */
  const likelihoodCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const p of current?.predictions ?? []) counts[p.likelihood] += 1;
    return counts;
  }, [current]);

  /* ── Load the saved runs once ───────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/exam-prediction?email=${encodeURIComponent(email)}`)
      .then(async (res) => ({ res, data: await res.json().catch(() => null) }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setRuns(data.predictions as ExamPredictionItem[]);
        } else {
          toast({ title: d.epLoadFailed, variant: 'destructive' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: d.epLoadFailed, variant: 'destructive' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [email, d.epLoadFailed, toast]);

  /* ── Default the subject to the first one once subjects land ── */
  useEffect(() => {
    if (!subjectsLoading && subjects.length > 0) {
      setSubjectId((prev) =>
        prev && subjects.some((s) => s.id === prev) ? prev : subjects[0].id
      );
    }
  }, [subjectsLoading, subjects]);

  /* ── Generate ───────────────────────────────────────────────── */
  const generate = async () => {
    if (!subject || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/exam-prediction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          subjectId: subject.id,
          lang,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const run = data.prediction as ExamPredictionItem;
        setCurrent(run);
        setRuns((prev) => [run, ...prev]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast({ title: d.epGenerateFailed, variant: 'destructive' });
      }
    } catch {
      toast({ title: d.epGenerateFailed, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  /* ── Delete a saved run ─────────────────────────────────────── */
  const deleteRun = async (id: string) => {
    const snapshot = runs;
    setRuns((prev) => prev.filter((r) => r.id !== id));
    if (current?.id === id) setCurrent(null);
    try {
      const res = await fetch(
        `/api/exam-prediction?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error('failed');
      toast({ title: d.epDeleted });
    } catch {
      setRuns(snapshot); // restore on failure
      toast({ title: d.epLoadFailed, variant: 'destructive' });
    }
  };

  /* ── Result card ────────────────────────────────────────────── */
  const ResultCard = current ? (
    <section
      aria-live="polite"
      className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {/* Header: title + meta chip row + likelihood summary chips */}
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-snug text-slate-900">
              {current.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${currentChip}`}
              >
                {current.subjectName}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatDate(current.createdAt)}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600">
                {likelihoodCounts.high} {d.epHigh}
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600">
                {likelihoodCounts.medium} {d.epMedium}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">
                {likelihoodCounts.low} {d.epLow}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteRun(current.id)}
            aria-label={d.epDelete}
            className="h-8 w-8 rounded-lg p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <ul className="space-y-3">
          {sortedPredictions.map((p, i) => (
            <PredictionCard
              key={`${i}-${p.question.slice(0, 24)}`}
              prediction={p}
              modelAnswerLabel={d.epModelAnswer}
              likelihoodLabel={
                p.likelihood === 'high'
                  ? d.epHigh
                  : p.likelihood === 'medium'
                    ? d.epMedium
                    : d.epLow
              }
            />
          ))}
        </ul>
        <p className="mt-6 border-t border-slate-100 pt-3 text-xs text-slate-400">
          {d.sumGeneratedBy}
        </p>
      </div>
    </section>
  ) : null;

  /* ── Page ───────────────────────────────────────────────────── */
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {d.epTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.epSubtitle}</p>

      {subjectsLoading ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : subjects.length === 0 ? (
        /* Empty state — no subject to analyze yet */
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Sparkles className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-base font-semibold text-slate-800">
            {d.epEmptyTitle}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {d.epEmptyDesc}
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
          {/* Config card */}
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
            <div className="space-y-1.5">
              <Label
                htmlFor="ep-subject"
                className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
              >
                {d.sumSubjectLabel}
              </Label>
              <Select
                value={subjectId}
                onValueChange={setSubjectId}
                disabled={generating}
              >
                <SelectTrigger
                  id="ep-subject"
                  aria-label={d.sumSubjectLabel}
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

            {/* Document-context status line */}
            {subject && (
              <p
                className={`mt-3 flex items-center gap-1.5 text-sm ${
                  subjectDocs.length > 0
                    ? 'text-emerald-700'
                    : 'text-orange-600'
                }`}
              >
                {subjectDocs.length > 0 ? (
                  <>
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                    {d.sumContextLine(subject.name, subjectDocs.length)}
                  </>
                ) : (
                  <>
                    <TriangleAlert
                      className="h-4 w-4 shrink-0 text-orange-500"
                      aria-hidden="true"
                    />
                    {d.sumNoPdfsHint(subject.name)}
                  </>
                )}
              </p>
            )}

            <Button
              onClick={() => void generate()}
              disabled={generating}
              className="mt-5 h-10 gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-70"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {generating ? d.sumGenerating : d.epGenerate}
            </Button>
          </section>

          {/* Generating placeholder */}
          {generating && (
            <section
              aria-live="polite"
              className="mt-6 flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
            >
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin text-emerald-600"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">
                  {d.epGeneratingTitle}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {d.epGeneratingDesc}
                </p>
              </div>
            </section>
          )}

          {/* Result */}
          {!generating && ResultCard}

          {/* Recent predictions — hidden entirely while empty */}
          {runs.length > 0 && (
            <section className="mt-8 pb-10" aria-label={d.epHistory}>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <Sparkles
                  className="h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                {d.epHistory}
              </h2>
              <div className="scrollbar-thin mt-3 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <ul className="divide-y divide-slate-100">
                  {runs.map((r) => (
                    <li
                      key={r.id}
                      className={`flex items-center gap-3 px-4 py-3.5 transition ${
                        current?.id === r.id ? 'bg-emerald-50/50' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCurrent(r);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <Sparkles className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {r.subjectName}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {d.epQuestions(r.predictions.length)} ·{' '}
                            {formatDate(r.createdAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteRun(r.id)}
                        aria-label={d.epDelete}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
