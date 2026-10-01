'use client';

/**
 * Vocabulary section — the "Vocabulary" header ("Key terms from your
 * material — definitions and examples included."), a config card
 * (SUBJECT select + WORDS count select + the document-context helper
 * line + the green "Build Vocabulary List" target button) and, once a
 * list is open, the word cards grid with per-word Known / Learning
 * toggles plus the "Your word lists" history.
 *
 * Fully functional: POST /api/vocabulary extracts the key academic
 * terms with the LLM — grounded in the extracted text of the subject's
 * uploaded PDFs (general knowledge fallback). Each word can be flipped
 * between Known and Learning; marks are persisted per word via
 * POST /api/vocabulary/<id>/progress (optimistic, restore on failure)
 * and the mastered count + progress bar update live. Lists survive
 * reloads and can be reopened or deleted from the history.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ListChecks,
  Loader2,
  Target,
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

export type VocabWord = {
  term: string;
  pos: string;
  pronunciation: string;
  definition: string;
  example: string;
};

export type VocabListItem = {
  id: string;
  subjectId: string | null;
  subjectName: string;
  count: number;
  words: VocabWord[];
  /** Sorted 0-based indices marked Known. */
  known: number[];
  createdAt: string;
};

type WordFilter = 'all' | 'learning' | 'known';

const WORD_COUNTS = [8, 12, 16, 20];

export default function VocabularyView({
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
  const [count, setCount] = useState(12);
  const [generating, setGenerating] = useState(false);

  /* ── Saved lists + the open one ─────────────────────────────── */
  const [lists, setLists] = useState<VocabListItem[]>([]);
  const [current, setCurrent] = useState<VocabListItem | null>(null);
  const [filter, setFilter] = useState<WordFilter>('all');

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

  /* Subject color chip for the open list (neutral when the subject
     was deleted meanwhile). */
  const currentChip = useMemo(() => {
    const color = subjects.find(
      (s) => s.id === current?.subjectId
    )?.color;
    return color ? CHIP_STYLES[color] : 'bg-slate-100 text-slate-600';
  }, [subjects, current?.subjectId]);

  /* Words visible under the active filter (original indices kept for
     the progress endpoint). */
  const visibleWords = useMemo(() => {
    if (!current) return [];
    return current.words
      .map((word, idx) => ({ word, idx }))
      .filter(({ idx }) => {
        const known = current.known.includes(idx);
        if (filter === 'known') return known;
        if (filter === 'learning') return !known;
        return true;
      });
  }, [current, filter]);

  /* ── Load the saved lists once ──────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/vocabulary?email=${encodeURIComponent(email)}`)
      .then(async (res) => ({ res, data: await res.json().catch(() => null) }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setLists(data.lists as VocabListItem[]);
        } else {
          toast({ title: d.vbLoadFailed, variant: 'destructive' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: d.vbLoadFailed, variant: 'destructive' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [email, d.vbLoadFailed, toast]);

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
      const res = await fetch('/api/vocabulary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          subjectId: subject.id,
          count,
          lang,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const list = data.list as VocabListItem;
        setCurrent(list);
        setFilter('all');
        setLists((prev) => [list, ...prev]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        toast({ title: d.vbGenerateFailed, variant: 'destructive' });
      }
    } catch {
      toast({ title: d.vbGenerateFailed, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  /* ── Toggle one word Known/Learning (optimistic, DB-persisted
     without blocking; restored on failure) ─────────────────────── */
  const toggleWord = (idx: number) => {
    if (!current) return;
    const listId = current.id;
    const wasKnown = current.known.includes(idx);
    const nextKnown = wasKnown
      ? current.known.filter((i) => i !== idx)
      : [...current.known, idx].sort((a, b) => a - b);

    setCurrent((prev) =>
      prev && prev.id === listId ? { ...prev, known: nextKnown } : prev
    );
    setLists((prev) =>
      prev.map((l) => (l.id === listId ? { ...l, known: nextKnown } : l))
    );

    void (async () => {
      try {
        const res = await fetch(
          `/api/vocabulary/${encodeURIComponent(listId)}/progress`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, idx, known: !wasKnown }),
          }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error('failed');
      } catch {
        /* Restore the previous marks on failure. */
        setCurrent((prev) =>
          prev && prev.id === listId ? { ...prev, known: current.known } : prev
        );
        setLists((prev) =>
          prev.map((l) => (l.id === listId ? { ...l, known: current.known } : l))
        );
      }
    })();
  };

  /* ── Delete a word list ─────────────────────────────────────── */
  const deleteList = async (id: string) => {
    const snapshot = lists;
    setLists((prev) => prev.filter((l) => l.id !== id));
    if (current?.id === id) setCurrent(null);
    try {
      const res = await fetch(
        `/api/vocabulary?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error('failed');
      toast({ title: d.vbDeleted });
    } catch {
      setLists(snapshot); // restore on failure
      toast({ title: d.vbLoadFailed, variant: 'destructive' });
    }
  };

  /* ── Result card ────────────────────────────────────────────── */
  const ResultCard = current ? (
    <section
      aria-live="polite"
      className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {/* Header: subject chip · date · mastered counter + bar */}
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${currentChip}`}
          >
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${currentChip}`}
              >
                {current.subjectName}
              </span>
              <span className="text-xs text-slate-400">
                {formatDate(current.createdAt)}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-medium text-slate-500">
              {d.vbMasteredOf(current.known.length, current.count)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteList(current.id)}
            aria-label={d.vbDelete}
            className="h-8 w-8 rounded-lg p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{
              width: `${
                current.count > 0
                  ? Math.round((current.known.length / current.count) * 100)
                  : 0
              }%`,
            }}
          />
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {/* Filter chips */}
        <div
          role="group"
          aria-label={d.vbFilterAll}
          className="flex flex-wrap gap-2"
        >
          {(
            [
              ['all', d.vbFilterAll, current.words.length],
              ['learning', d.vbFilterLearning, current.words.length - current.known.length],
              ['known', d.vbFilterKnown, current.known.length],
            ] as [WordFilter, string, number][]
          ).map(([id, label, n]) => {
            const active = filter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                {label} · {n}
              </button>
            );
          })}
        </div>

        {/* Word cards grid */}
        {visibleWords.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {visibleWords.map(({ word, idx }) => {
              const known = current.known.includes(idx);
              return (
                <article
                  key={idx}
                  className="flex flex-col rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="text-base font-semibold text-slate-900">
                      {word.term}
                    </h3>
                    {word.pos && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs italic text-slate-500">
                        {word.pos}
                      </span>
                    )}
                  </div>
                  {word.pronunciation && (
                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      {word.pronunciation}
                    </p>
                  )}
                  {word.definition && (
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {word.definition}
                    </p>
                  )}
                  {word.example && (
                    <p className="mt-2 text-xs italic leading-relaxed text-slate-500">
                      {'\u201C'}
                      {word.example}
                      {'\u201D'}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleWord(idx)}
                    aria-pressed={known}
                    className={`mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition ${
                      known
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    {known ? (
                      <>
                        <Check
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {d.vbKnown}
                      </>
                    ) : (
                      <>
                        <span
                          className="h-2 w-2 rounded-full bg-amber-500"
                          aria-hidden="true"
                        />
                        {d.vbLearning}
                      </>
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            {filter === 'known' ? d.vbFilterKnown : d.vbFilterLearning}
          </p>
        )}

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
        {d.vbTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.vbSubtitle}</p>

      {subjectsLoading ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : subjects.length === 0 ? (
        /* Empty state — no subject to build a list from yet */
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Target className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-base font-semibold text-slate-800">
            {d.vbEmptyTitle}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {d.vbEmptyDesc}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="vb-subject"
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
                    id="vb-subject"
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

              <div className="space-y-1.5">
                <Label
                  htmlFor="vb-count"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                >
                  {d.vbWordsLabel}
                </Label>
                <Select
                  value={String(count)}
                  onValueChange={(v) => setCount(Number(v))}
                  disabled={generating}
                >
                  <SelectTrigger
                    id="vb-count"
                    aria-label={d.vbWordsLabel}
                    className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 rounded-xl border-slate-200">
                    {WORD_COUNTS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                <Target className="h-4 w-4" aria-hidden="true" />
              )}
              {generating ? d.sumGenerating : d.vbGenerate}
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
                  {d.vbGeneratingTitle}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {d.vbGeneratingDesc}
                </p>
              </div>
            </section>
          )}

          {/* Result */}
          {!generating && ResultCard}

          {/* Your word lists — hidden entirely while empty */}
          {lists.length > 0 && (
            <section className="mt-8 pb-10" aria-label={d.vbHistory}>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
                <ListChecks
                  className="h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                {d.vbHistory}
              </h2>
              <div className="scrollbar-thin mt-3 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <ul className="divide-y divide-slate-100">
                  {lists.map((l) => (
                    <li
                      key={l.id}
                      className={`flex items-center gap-3 px-4 py-3.5 transition ${
                        current?.id === l.id ? 'bg-emerald-50/50' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCurrent(l);
                          setFilter('all');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <Target className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {l.subjectName}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {l.count} {d.vbWordsLabel} ·{' '}
                            {d.vbMasteredOf(l.known.length, l.count)} ·{' '}
                            {formatDate(l.createdAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteList(l.id)}
                        aria-label={d.vbDelete}
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
