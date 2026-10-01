'use client';

/**
 * Formula Sheet section — AI-extracted formula sheets for one subject:
 * each formula arrives with its variables (symbol + meaning), one worked
 * numeric example and a topic tag, rendered as a card grid with a
 * centered monospace formula box and a per-formula copy button.
 *
 * The subject's uploaded PDFs are extracted server-side (unpdf) as the
 * primary source, falling back to the subject's typical syllabus. Every
 * sheet is persisted in SQLite, listed under "Your formula sheets"
 * (click-to-reopen, per-row delete) and survives reloads.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Loader2,
  Sigma,
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

export type FormulaItem = {
  name: string;
  formula: string;
  variables: { symbol: string; meaning: string }[];
  example: string;
  topic: string;
};

export type FormulaSheetItem = {
  id: string;
  subjectId: string | null;
  subjectName: string;
  title: string;
  formulas: FormulaItem[];
  createdAt: string;
};

export default function FormulaSheetView({
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

  /* ── State ──────────────────────────────────────────────────── */
  const [subjectId, setSubjectId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sheets, setSheets] = useState<FormulaSheetItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [current, setCurrent] = useState<FormulaSheetItem | null>(null);

  /* ── Derived ────────────────────────────────────────────────── */
  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? null,
    [subjects, subjectId]
  );
  const subjectDocs = useMemo(
    () =>
      subject
        ? pdfs.filter((p) => p.subjectName === subject.name)
        : [],
    [pdfs, subject]
  );

  /** Chip classes for the sheet's subject (fallback emerald). */
  const subjectChip = useMemo(() => {
    const color = subjects.find(
      (s) => s.id === current?.subjectId
    )?.color;
    return CHIP_STYLES[color ?? 'emerald'];
  }, [subjects, current]);

  /* ── Load the saved sheets once ─────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/formula-sheet?email=${encodeURIComponent(email)}`)
      .then(async (res) => ({ res, data: await res.json().catch(() => null) }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setSheets(data.sheets as FormulaSheetItem[]);
        } else {
          toast({ title: d.fsLoadFailed, variant: 'destructive' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: d.fsLoadFailed, variant: 'destructive' });
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, d.fsLoadFailed, toast]);

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
      const res = await fetch('/api/formula-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, subjectId: subject.id, lang }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const sheet = data.sheet as FormulaSheetItem;
        setCurrent(sheet);
        setSheets([sheet, ...sheets]);
      } else {
        toast({ title: d.fsGenerateFailed, variant: 'destructive' });
      }
    } catch {
      toast({ title: d.fsGenerateFailed, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  /* ── Copy one formula ───────────────────────────────────────── */
  const copyFormula = async (f: FormulaItem) => {
    const plain = [f.formula, f.example].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(plain);
      toast({ title: d.fsCopied });
    } catch {
      toast({ title: d.fsCopied });
    }
  };

  /* ── Delete a saved sheet (restore on failure) ──────────────── */
  const deleteSheet = async (id: string) => {
    const snapshot = sheets;
    const next = sheets.filter((s) => s.id !== id);
    setSheets(next);
    if (current?.id === id) setCurrent(null);
    try {
      const res = await fetch(
        `/api/formula-sheet?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error('failed');
      toast({ title: d.fsDeleted });
    } catch {
      setSheets(snapshot); // restore on failure
      toast({ title: d.fsLoadFailed, variant: 'destructive' });
    }
  };

  /* ── Result card ────────────────────────────────────────────── */
  const ResultCard = current ? (
    <section
      aria-live="polite"
      className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex items-start gap-3.5 border-b border-slate-100 p-5 sm:p-6">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${subjectChip}`}
        >
          <Sigma className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug text-slate-900">
            {current.title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
            <span className="truncate">{current.subjectName}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(current.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{d.fsFormulas(current.formulas.length)}</span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void deleteSheet(current.id)}
          aria-label={d.fsDelete}
          className="h-8 w-8 shrink-0 rounded-lg p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {current.formulas.map((f, i) => (
            <article
              key={i}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-semibold leading-snug text-slate-900">
                  {f.name}
                </h3>
                {f.topic && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {f.topic}
                  </span>
                )}
              </div>

              {/* Centered monospace formula box */}
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center">
                <code className="font-mono text-lg text-slate-800">
                  {f.formula || '—'}
                </code>
              </div>

              {f.variables.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    {d.fsVariables}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {f.variables.map((v, j) => (
                      <li
                        key={j}
                        className="text-sm leading-relaxed text-slate-600"
                      >
                        <span className="font-mono font-medium text-slate-800">
                          {v.symbol}
                        </span>{' '}
                        = {v.meaning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {f.example && (
                <p className="mt-3 text-sm italic leading-relaxed text-slate-600">
                  <span className="font-semibold not-italic text-slate-700">
                    {d.fsExample}:{' '}
                  </span>
                  {f.example}
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyFormula(f)}
                className="mt-4 h-8 gap-1.5 self-start rounded-lg text-xs"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {d.fsCopy}
              </Button>
            </article>
          ))}
        </div>
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
        {d.fsTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.fsSubtitle}</p>

      {subjectsLoading ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : subjects.length === 0 ? (
        /* Empty state — no subject to extract formulas from yet */
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Sigma className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-base font-semibold text-slate-800">
            {d.fsEmptyTitle}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {d.fsEmptyDesc}
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
                htmlFor="fs-subject"
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
                  id="fs-subject"
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

            <Button
              onClick={() => void generate()}
              disabled={generating}
              className="mt-5 h-10 gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-70"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sigma className="h-4 w-4" aria-hidden="true" />
              )}
              {generating ? d.sumGenerating : d.fsGenerate}
            </Button>

            {/* Document-context status line */}
            {subject && (
              <p
                className={`mt-4 flex items-center gap-1.5 text-sm ${
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
                  {d.fsGeneratingTitle}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {d.fsGeneratingDesc}
                </p>
              </div>
            </section>
          )}

          {/* Result */}
          {!generating && ResultCard}

          {/* Your formula sheets */}
          {sheets.length > 0 && (
            <section className="mt-8 pb-10" aria-label={d.fsHistory}>
              <h2 className="text-base font-semibold text-slate-800">
                {d.fsHistory}
              </h2>
              {historyLoading ? (
                <div className="mt-3 flex items-center justify-center rounded-xl border border-slate-200 bg-white py-8 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <ul className="scrollbar-thin mt-3 max-h-96 space-y-2.5 overflow-y-auto pr-1">
                  {sheets.map((s) => (
                    <li
                      key={s.id}
                      className={`flex items-center gap-2 rounded-xl border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition ${
                        current?.id === s.id
                          ? 'border-emerald-300'
                          : 'border-slate-200 hover:border-emerald-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCurrent(s);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            CHIP_STYLES[
                              subjects.find((x) => x.id === s.subjectId)
                                ?.color ?? 'emerald'
                            ]
                          }`}
                        >
                          <Sigma className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {s.title}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {s.subjectName} · {d.fsFormulas(s.formulas.length)}{' '}
                            · {formatDate(s.createdAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSheet(s.id)}
                        aria-label={d.fsDelete}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
