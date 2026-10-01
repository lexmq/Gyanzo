'use client';

/**
 * Mind Map section — the "Mind Map" header with the subtitle, a config
 * card holding the SUBJECT select, the optional TOPIC input and the
 * emerald "Generate Mind Map" button.
 *
 * Fully functional: POST /api/mind-maps generates a real AI mind map —
 * the text of the subject's uploaded PDFs is extracted server-side and
 * used as the primary source, falling back to general syllabus knowledge
 * when the subject has no readable documents. The hierarchical result
 * ({ root: { title, children } }) is persisted in SQLite, rendered as an
 * interactive collapsible tree (expand/collapse per branch, expand/collapse
 * all, copy as indented text), and every past map is listed under
 * "Recent mind maps" and survives reloads.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Network,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';
import { CHIP_STYLES, type Subject } from '@/components/dashboard/subject-styles';
import { formatDate, type Pdf } from '@/components/dashboard/pdf-utils';

export type MMNode = { title: string; children: MMNode[] };

export type MindMapItem = {
  id: string;
  subjectId: string | null;
  subjectName: string;
  topic: string;
  title: string;
  content: { root: MMNode };
  createdAt: string;
};

/* ── One collapsible node of the tree (pure CSS, no canvas) ─────────── */
function MapNode({
  node,
  path,
  expanded,
  onToggle,
}: {
  node: MMNode;
  path: string; // index path from the root's children, e.g. "0.2.1"
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(path);

  return (
    <li>
      <div className="flex items-center gap-1.5">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(path)}
            aria-expanded={isOpen}
            aria-label={node.title}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
          </span>
        )}
        <span className="min-w-0 break-words rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium leading-snug text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {node.title}
        </span>
      </div>
      {hasChildren && isOpen && (
        <ul className="ml-3 mt-1.5 space-y-1.5 border-l border-emerald-200 pl-4">
          {node.children.map((child, i) => (
            <MapNode
              key={`${path}.${i}`}
              node={child}
              path={`${path}.${i}`}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function MindMapView({
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
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [maps, setMaps] = useState<MindMapItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [current, setCurrent] = useState<MindMapItem | null>(null);
  /** Paths of expanded branches ("0", "0.2", "0.2.1", ...). */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
  const currentSubject = useMemo(
    () => subjects.find((s) => s.id === current?.subjectId) ?? null,
    [subjects, current]
  );
  const currentChip =
    currentSubject && currentSubject.color in CHIP_STYLES
      ? CHIP_STYLES[currentSubject.color]
      : CHIP_STYLES['emerald'];

  /* Total node count (root included) for the d.mmNodes chip */
  const nodeCount = useMemo(() => {
    if (!current) return 0;
    let n = 0;
    const walk = (node: MMNode) => {
      n += 1;
      node.children.forEach(walk);
    };
    walk(current.content.root);
    return n;
  }, [current]);

  /* ── Load the saved maps once ───────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mind-maps?email=${encodeURIComponent(email)}`)
      .then(async (res) => ({ res, data: await res.json().catch(() => null) }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setMaps(data.maps as MindMapItem[]);
        } else {
          toast({ title: d.mmLoadFailed, variant: 'destructive' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: d.mmLoadFailed, variant: 'destructive' });
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, d.mmLoadFailed, toast]);

  /* ── Default expansion whenever a map is opened: the root's
        children (depth 1) start expanded, deeper levels collapsed ── */
  useEffect(() => {
    if (current) {
      setExpanded(
        new Set(current.content.root.children.map((_, i) => String(i)))
      );
    } else {
      setExpanded(new Set());
    }
  }, [current]);

  const toggleBranch = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    if (!current) return;
    const set = new Set<string>();
    const walk = (node: MMNode, path: string) => {
      if (node.children.length > 0) set.add(path);
      node.children.forEach((c, i) => walk(c, `${path}.${i}`));
    };
    current.content.root.children.forEach((c, i) => walk(c, String(i)));
    setExpanded(set);
  };

  const collapseAll = () => setExpanded(new Set());

  /* ── Generate ───────────────────────────────────────────────── */
  const generate = async () => {
    if (!subject || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/mind-maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          subjectId: subject.id,
          topic: topic.trim(),
          lang,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const map = data.map as MindMapItem;
        setCurrent(map);
        setMaps((prev) => [map, ...prev]);
      } else {
        toast({ title: d.mmGenerateFailed, variant: 'destructive' });
      }
    } catch {
      toast({ title: d.mmGenerateFailed, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  /* ── Copy the displayed map as indented plain text ──────────── */
  const copyCurrent = async () => {
    if (!current) return;
    const lines: string[] = [current.title, '', current.content.root.title];
    const walk = (node: MMNode, depth: number) => {
      node.children.forEach((c) => {
        lines.push(`${'  '.repeat(depth)}- ${c.title}`);
        walk(c, depth + 1);
      });
    };
    walk(current.content.root, 1);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast({ title: d.mmCopied });
    } catch {
      toast({ title: d.mmCopied });
    }
  };

  /* ── Delete a saved map (optimistic, restore on failure) ────── */
  const deleteMap = async (id: string) => {
    const snapshot = maps;
    const currentSnapshot = current;
    const next = maps.filter((m) => m.id !== id);
    setMaps(next);
    if (current?.id === id) setCurrent(null);
    try {
      const res = await fetch(
        `/api/mind-maps?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error('failed');
      toast({ title: d.mmDeleted });
    } catch {
      setMaps(snapshot); // restore on failure
      setCurrent(currentSnapshot);
      toast({ title: d.mmLoadFailed, variant: 'destructive' });
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
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${CHIP_STYLES['emerald']}`}
        >
          <Network className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug text-slate-900">
            {current.title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-400">
            <span
              className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${currentChip}`}
            >
              <span className="truncate">{current.subjectName}</span>
            </span>
            {current.topic && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{current.topic}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{formatDate(current.createdAt)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyCurrent()}
            className="h-8 gap-1.5 rounded-lg text-xs"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {d.mmCopy}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteMap(current.id)}
            aria-label={d.mmDelete}
            className="h-8 w-8 rounded-lg p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {/* Toolbar: node count + expand/collapse controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            {d.mmNodes(nodeCount)}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={expandAll}
              className="h-7 rounded-lg px-2.5 text-xs text-slate-600"
            >
              {d.mmExpandAll}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={collapseAll}
              className="h-7 rounded-lg px-2.5 text-xs text-slate-600"
            >
              {d.mmCollapseAll}
            </Button>
          </div>
        </div>

        {/* The tree */}
        <div className="mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm">
            <Network className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="min-w-0 break-words">
              {current.content.root.title}
            </span>
          </span>
          {current.content.root.children.length > 0 && (
            <ul className="ml-4 mt-2.5 space-y-2 border-l border-emerald-200 pl-4">
              {current.content.root.children.map((child, i) => (
                <MapNode
                  key={String(i)}
                  node={child}
                  path={String(i)}
                  expanded={expanded}
                  onToggle={toggleBranch}
                />
              ))}
            </ul>
          )}
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
        {d.mmTitle}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">{d.mmSubtitle}</p>

      {subjectsLoading ? (
        <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : subjects.length === 0 ? (
        /* Empty state — no subject to map yet */
        <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-14 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Network className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-base font-semibold text-slate-800">
            {d.sumEmptyTitle}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {d.sumEmptyDesc}
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
                  htmlFor="mm-subject"
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
                    id="mm-subject"
                    aria-label={d.sumSubjectLabel}
                    className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
                  >
                    <SelectValue placeholder="…" />
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
                  htmlFor="mm-topic"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                >
                  {d.mmTopicLabel}
                </Label>
                <Input
                  id="mm-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && subjectId && !generating) {
                      void generate();
                    }
                  }}
                  maxLength={120}
                  placeholder={d.mmTopicPlaceholder}
                  disabled={generating}
                  className="h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700 placeholder:text-slate-400"
                />
              </div>
            </div>

            <Button
              onClick={() => void generate()}
              disabled={generating || !subjectId}
              className="mt-5 h-10 gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-70"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Network className="h-4 w-4" aria-hidden="true" />
              )}
              {generating ? d.sumGenerating : d.mmGenerate}
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
                  {d.mmGeneratingTitle}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {d.mmGeneratingDesc}
                </p>
              </div>
            </section>
          )}

          {/* Result */}
          {!generating && ResultCard}

          {/* Recent mind maps */}
          {maps.length > 0 && (
            <section className="mt-8 pb-10" aria-label={d.mmHistory}>
              <h2 className="text-base font-semibold text-slate-800">
                {d.mmHistory}
              </h2>
              {historyLoading ? (
                <div className="mt-3 flex items-center justify-center rounded-xl border border-slate-200 bg-white py-8 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <div className="scrollbar-thin mt-3 max-h-96 overflow-y-auto pr-1">
                  <ul className="space-y-2.5">
                    {maps.map((m) => (
                      <li
                        key={m.id}
                        className={`flex items-center gap-2 rounded-xl border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition ${
                          current?.id === m.id
                            ? 'border-emerald-300'
                            : 'border-slate-200 hover:border-emerald-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setCurrent(m);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CHIP_STYLES['emerald']}`}
                          >
                            <Network className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {m.title}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              {[
                                m.subjectName,
                                m.topic,
                                formatDate(m.createdAt),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteMap(m.id)}
                          aria-label={d.mmDelete}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
