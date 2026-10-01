'use client';

/**
 * Citation section — turns the user's uploaded PDFs into ready-to-paste
 * citations in the five major styles (APA 7 / MLA 9 / Chicago 17 /
 * Harvard / IEEE). The bibliographic metadata is read from the document
 * by Gyanzo AI, while the final citation string is formatted
 * deterministically in code so every style is punctuated correctly.
 *
 * Citations only need documents — not subjects — so the page stays
 * usable whenever the user has at least one PDF. Every generated
 * citation is persisted in SQLite, listed under "Your citations"
 * (click-to-reopen, per-row delete, copy all) and survives reloads.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  CopyCheck,
  Loader2,
  Quote,
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
import {
  CHIP_STYLES,
  type Subject,
  type SubjectColor,
} from '@/components/dashboard/subject-styles';
import { formatDate, type Pdf } from '@/components/dashboard/pdf-utils';

export type CitationItem = {
  id: string;
  pdfId: string | null;
  pdfName: string;
  style: string;
  text: string;
  createdAt: string;
};

type StyleId = 'apa' | 'mla' | 'chicago' | 'harvard' | 'ieee';

/* Deterministic chip color per citation style (visual variety only). */
const STYLE_CHIP: Record<StyleId, SubjectColor> = {
  apa: 'emerald',
  mla: 'amber',
  chicago: 'violet',
  harvard: 'teal',
  ieee: 'orange',
};

function chipFor(style: string): string {
  const key = (style as StyleId) in STYLE_CHIP ? (style as StyleId) : 'apa';
  return CHIP_STYLES[STYLE_CHIP[key]];
}

export default function CitationView(props: {
  email: string;
  subjects: Subject[];
  subjectsLoading: boolean;
  pdfs: Pdf[];
  onNewSubject: () => void;
}) {
  /* Citations are document-driven — subjects/onNewSubject stay accepted
     for a uniform view signature but the page never gates on them. */
  const { email, pdfs } = props;
  const { toast } = useToast();
  const { t, lang } = useLanguage();
  const d = t.dashboard;

  /* ── State ──────────────────────────────────────────────────── */
  const [pdfId, setPdfId] = useState('');
  const [style, setStyle] = useState<StyleId>('apa');
  const [generating, setGenerating] = useState(false);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [current, setCurrent] = useState<CitationItem | null>(null);

  /* ── Derived ────────────────────────────────────────────────── */
  const selectedPdf = useMemo(
    () => pdfs.find((p) => p.id === pdfId) ?? null,
    [pdfs, pdfId]
  );

  const styleLabel = (id: string): string => {
    const map: Record<string, string> = {
      apa: d.ctStyleApa,
      mla: d.ctStyleMla,
      chicago: d.ctStyleChicago,
      harvard: d.ctStyleHarvard,
      ieee: d.ctStyleIeee,
    };
    return map[id] ?? id.toUpperCase();
  };

  const styleOptions: { id: StyleId; label: string }[] = [
    { id: 'apa', label: d.ctStyleApa },
    { id: 'mla', label: d.ctStyleMla },
    { id: 'chicago', label: d.ctStyleChicago },
    { id: 'harvard', label: d.ctStyleHarvard },
    { id: 'ieee', label: d.ctStyleIeee },
  ];

  /* ── Load the saved citations once ──────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/citations?email=${encodeURIComponent(email)}`)
      .then(async (res) => ({ res, data: await res.json().catch(() => null) }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setCitations(data.citations as CitationItem[]);
        } else {
          toast({ title: d.ctLoadFailed, variant: 'destructive' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: d.ctLoadFailed, variant: 'destructive' });
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, d.ctLoadFailed, toast]);

  /* ── Default the document to the first PDF once they land ───── */
  useEffect(() => {
    if (pdfs.length > 0) {
      setPdfId((prev) =>
        prev && pdfs.some((p) => p.id === prev) ? prev : pdfs[0].id
      );
    }
  }, [pdfs]);

  /* ── Generate ───────────────────────────────────────────────── */
  const generate = async () => {
    if (!selectedPdf || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pdfId: selectedPdf.id, style, lang }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const citation = data.citation as CitationItem;
        setCurrent(citation);
        setCitations([citation, ...citations]);
      } else {
        toast({ title: d.ctGenerateFailed, variant: 'destructive' });
      }
    } catch {
      toast({ title: d.ctGenerateFailed, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  /* ── Copy helpers ───────────────────────────────────────────── */
  const copyText = async (text: string, copiedTitle: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: copiedTitle });
    } catch {
      /* Clipboard API can be unavailable — still confirm optimistically
         the way the other sections do. */
      toast({ title: copiedTitle });
    }
  };

  const copyCurrent = () => {
    if (current) void copyText(current.text, d.ctCopied);
  };

  const copyAll = () => {
    if (citations.length < 2) return;
    void copyText(
      citations.map((c) => c.text).join('\n\n'),
      d.ctCopiedAll
    );
  };

  /* ── Delete a saved citation (restore on failure) ───────────── */
  const deleteCitation = async (id: string) => {
    const snapshot = citations;
    const next = citations.filter((c) => c.id !== id);
    setCitations(next);
    if (current?.id === id) setCurrent(null);
    try {
      const res = await fetch(
        `/api/citations?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error('failed');
      toast({ title: d.ctDeleted });
    } catch {
      setCitations(snapshot); // restore on failure
      toast({ title: d.ctLoadFailed, variant: 'destructive' });
    }
  };

  /* ── Empty state (no citation selected) ─────────────────────── */
  const EmptyCard =
    !current && !generating ? (
      <section
        aria-live="polite"
        className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Quote className="h-7 w-7" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-base font-semibold text-slate-800">
          {d.ctEmptyTitle}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          {d.ctEmptyDesc}
        </p>
      </section>
    ) : null;

  /* ── Result card ────────────────────────────────────────────── */
  const ResultCard = current ? (
    <section
      aria-live="polite"
      className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex items-start gap-3.5 border-b border-slate-100 p-5 sm:p-6">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${chipFor(current.style)}`}
        >
          <Quote className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug text-slate-900">
            {current.pdfName}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
            <span>{styleLabel(current.style)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(current.createdAt)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={copyCurrent}
            className="h-8 gap-1.5 rounded-lg text-xs"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {d.ctCopy}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteCitation(current.id)}
            aria-label={d.ctDelete}
            className="h-8 w-8 rounded-lg p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <blockquote className="font-serif text-base leading-relaxed text-slate-800">
          {current.text}
        </blockquote>
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
        {d.ctTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.ctSubtitle}</p>

      {/* Config card — citations need documents, not subjects */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="ct-document"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
            >
              {d.ctDocumentLabel}
            </Label>
            <Select
              value={pdfId}
              onValueChange={setPdfId}
              disabled={generating || pdfs.length === 0}
            >
              <SelectTrigger
                id="ct-document"
                aria-label={d.ctDocumentLabel}
                className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
              >
                <SelectValue placeholder={d.ctDocumentLabel} />
              </SelectTrigger>
              <SelectContent className="max-h-64 rounded-xl border-slate-200">
                {pdfs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.subjectName ? ` (${p.subjectName})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="ct-style"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
            >
              {d.ctStyleLabel}
            </Label>
            <Select
              value={style}
              onValueChange={(v) => setStyle(v as StyleId)}
              disabled={generating}
            >
              <SelectTrigger
                id="ct-style"
                aria-label={d.ctStyleLabel}
                className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-200">
                {styleOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={() => void generate()}
          disabled={generating || !selectedPdf}
          className="mt-5 h-10 gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-70"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Quote className="h-4 w-4" aria-hidden="true" />
          )}
          {generating ? d.sumGenerating : d.ctGenerate}
        </Button>

        {/* Document-context status line */}
        <p
          className={`mt-4 flex items-center gap-1.5 text-sm ${
            pdfs.length > 0 ? 'text-emerald-700' : 'text-orange-600'
          }`}
        >
          {pdfs.length > 0 ? (
            <>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              {d.sumContextLine(selectedPdf?.name ?? '', pdfs.length)}
            </>
          ) : (
            <>
              <TriangleAlert
                className="h-4 w-4 shrink-0 text-orange-500"
                aria-hidden="true"
              />
              {d.ctNoPdfs}
            </>
          )}
        </p>
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
              {d.ctGeneratingTitle}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              {d.ctGeneratingDesc}
            </p>
          </div>
        </section>
      )}

      {/* Result / empty state */}
      {!generating && (ResultCard ?? EmptyCard)}

      {/* Your citations */}
      {citations.length > 0 && (
        <section className="mt-8 pb-10" aria-label={d.ctHistory}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-800">
              {d.ctHistory}
            </h2>
            {citations.length >= 2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={copyAll}
                className="h-8 shrink-0 gap-1.5 rounded-lg text-xs"
              >
                <CopyCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {d.ctCopyAll}
              </Button>
            )}
          </div>
          {historyLoading ? (
            <div className="mt-3 flex items-center justify-center rounded-xl border border-slate-200 bg-white py-8 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <ul className="scrollbar-thin mt-3 max-h-96 space-y-2.5 overflow-y-auto pr-1">
              {citations.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center gap-2 rounded-xl border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition ${
                    current?.id === c.id
                      ? 'border-emerald-300'
                      : 'border-slate-200 hover:border-emerald-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCurrent(c);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${chipFor(c.style)}`}
                    >
                      <Quote className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {c.pdfName}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {formatDate(c.createdAt)}
                      </span>
                    </span>
                  </button>
                  <span
                    className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline ${chipFor(c.style)}`}
                  >
                    {styleLabel(c.style)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteCitation(c.id)}
                    aria-label={d.ctDelete}
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
    </div>
  );
}
