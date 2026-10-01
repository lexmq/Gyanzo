'use client';

/**
 * Voice Tutor section — talk to the AI tutor: tap the big emerald mic,
 * ask out loud (Web Speech API, matched to the active UI language), and
 * the tutor answers in a strictly speakable style which the browser
 * reads aloud (speechSynthesis, honoring the user's auto-speak
 * preference from Settings).
 *
 * Fully functional but stateless client-side: the conversation lives in
 * component state only (cleared on unmount / "Clear conversation"), and
 * the recent turns are passed along to POST /api/voice-tutor so the
 * tutor keeps context without any DB persistence. Every browser gets the
 * section: a text fallback input is always available, and when speech
 * recognition is unsupported an info banner switches the section to
 * text-only mode.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser,
  Info,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { loadPrefs, PREFS_EVENT, savePrefs, type TutorVoiceId } from '@/lib/prefs';
import { VOICE_PROFILES, clampSpeed, pickSynthVoice } from '@/lib/tts';
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
import { cn } from '@/lib/utils';
import {
  CHIP_STYLES,
  type Subject,
} from '@/components/dashboard/subject-styles';
import { type Pdf } from '@/components/dashboard/pdf-utils';

/* ── Web Speech API — minimal local typings (no package install) ── */
type SpeechAlternativeLike = { transcript: string };
type SpeechResultLike = {
  0: SpeechAlternativeLike;
  isFinal: boolean;
};
type SpeechResultListLike = {
  length: number;
  [index: number]: SpeechResultLike;
};
type SpeechEventLike = { resultIndex: number; results: SpeechResultListLike };
type SpeechErrorEventLike = { error: string };

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === 'function'
    ? (ctor as SpeechRecognitionCtor)
    : null;
}

/** Active UI language → BCP-47 tag for recognition + synthesis. */
const BCP47: Record<string, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  mr: 'mr-IN',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
};

/* ── Local shapes ───────────────────────────────────────────────── */
type VtMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  failed?: boolean;
};
type VtPhase = 'idle' | 'listening' | 'thinking';

const NO_CONTEXT = 'none';
const MIC_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture'];

export default function VoiceTutorView({
  email,
  subjects,
  pdfs,
}: {
  email: string;
  subjects: Subject[];
  pdfs: Pdf[];
}) {
  const { toast } = useToast();
  const { t, lang } = useLanguage();
  const d = t.dashboard;

  /* ── State ──────────────────────────────────────────────────── */
  const [subjectId, setSubjectId] = useState(NO_CONTEXT);
  const [messages, setMessages] = useState<VtMsg[]>([]);
  const [phase, setPhase] = useState<VtPhase>('idle');
  const [input, setInput] = useState('');
  const [interim, setInterim] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [autoSpeak, setAutoSpeak] = useState(true); // SSR-safe default; synced from prefs at mount

  const messagesRef = useRef<VtMsg[]>([]); // kept in sync manually (instant reads)
  const phaseRef = useRef<VtPhase>('idle');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const autoSpeakRef = useRef(true); // read at mount from the user's prefs
  const voicePrefsRef = useRef<{ tutorVoice: TutorVoiceId; tutorSpeed: number }>({
    tutorVoice: 'jam',
    tutorSpeed: 1,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const setPhaseSafe = (next: VtPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const appendMessages = (next: VtMsg[]) => {
    messagesRef.current = next;
    setMessages(next);
  };

  /* ── Mount: read prefs + detect speech-recognition support ──── */
  useEffect(() => {
    const sync = () => {
      const prefs = loadPrefs(email);
      autoSpeakRef.current = prefs.autoSpeak;
      setAutoSpeak(prefs.autoSpeak);
      voicePrefsRef.current = {
        tutorVoice: prefs.tutorVoice,
        tutorSpeed: prefs.tutorSpeed,
      };
    };
    sync();
    setSpeechSupported(getSpeechRecognition() !== null);
    // Settings → Voice Tutor changes apply live (no reload needed).
    window.addEventListener(PREFS_EVENT, sync);
    return () => window.removeEventListener(PREFS_EVENT, sync);
  }, [email]);

  /* ── Unmount: release mic + speech ──────────────────────────── */
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* already stopped */
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* nothing playing */
        }
      }
    };
  }, []);

  /* ── Keep the newest message in view ────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, interim, phase]);

  /* ── Derived: subject context ───────────────────────────────── */
  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? null,
    [subjects, subjectId]
  );
  const docCount = useMemo(
    () =>
      subject ? pdfs.filter((p) => p.subjectName === subject.name).length : 0,
    [pdfs, subject]
  );

  /* ── Speak a reply aloud (honors the Voice Tutor settings) ──── */
  const speak = (text: string) => {
    if (!autoSpeakRef.current) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = BCP47[lang] ?? 'en-US';
      // Settings → Voice Tutor → Tutor voice + Speaking speed
      const profile =
        VOICE_PROFILES[voicePrefsRef.current.tutorVoice] ?? VOICE_PROFILES.jam;
      utterance.rate = clampSpeed(voicePrefsRef.current.tutorSpeed);
      utterance.pitch = profile.pitch;
      const voice = pickSynthVoice(profile.prefer, utterance.lang);
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    } catch {
      /* synthesis unavailable — the text reply still shows */
    }
  };

  /* ── Stop an in-flight recognition (safe if already stopped) ── */
  const stopListening = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };

  /* ── Send a question (typed or spoken) ──────────────────────── */
  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || phaseRef.current === 'thinking') return; // guard double-send

    stopListening();
    setInput('');
    setInterim('');
    setPhaseSafe('thinking');

    /* History = the turns BEFORE this question (last 8). */
    const history = messagesRef.current
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    const optimistic: VtMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };
    appendMessages([...messagesRef.current, optimistic]);

    try {
      const res = await fetch('/api/voice-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          subjectId: subjectId === NO_CONTEXT ? undefined : subjectId,
          message: text,
          history,
          lang,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reply?: unknown;
      } | null;

      const reply =
        res.ok && data?.ok && typeof data.reply === 'string'
          ? data.reply.trim()
          : '';
      if (reply) {
        appendMessages([
          ...messagesRef.current,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: reply,
          },
        ]);
        speak(reply);
      } else {
        /* Keep the user bubble and mark it with a small retry hint. */
        appendMessages(
          messagesRef.current.map((m) =>
            m.id === optimistic.id ? { ...m, failed: true } : m
          )
        );
        toast({ title: d.vtSendFailed, variant: 'destructive' });
      }
    } catch {
      appendMessages(
        messagesRef.current.map((m) =>
          m.id === optimistic.id ? { ...m, failed: true } : m
        )
      );
      toast({ title: d.vtSendFailed, variant: 'destructive' });
    } finally {
      setPhaseSafe('idle');
    }
  };

  /* ── Speech recognition ─────────────────────────────────────── */
  const startListening = () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor || recognitionRef.current || phaseRef.current !== 'idle') return;

    let finalized = false;
    let errored = false;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = BCP47[lang] ?? 'en-US';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (event) => {
      let interimText = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText) setInterim(interimText);
      if (finalText.trim()) {
        finalized = true;
        setInterim('');
        try {
          rec.stop();
        } catch {
          /* ending anyway */
        }
        void send(finalText);
      }
    };

    rec.onerror = (event) => {
      if (errored || finalized) return;
      errored = true;
      recognitionRef.current = null;
      setInterim('');
      if (MIC_ERRORS.includes(event.error)) {
        toast({ title: d.vtMicError, variant: 'destructive' });
      }
      if (phaseRef.current === 'listening') setPhaseSafe('idle');
    };

    /* Fires after stop()/natural end — ignore when already handled. */
    rec.onend = () => {
      recognitionRef.current = null;
      setInterim('');
      if (finalized || errored) return;
      if (phaseRef.current === 'listening') setPhaseSafe('idle');
    };

    setInterim('');
    try {
      rec.start();
      setPhaseSafe('listening');
    } catch {
      recognitionRef.current = null;
      setPhaseSafe('idle');
    }
  };

  const handleMicClick = () => {
    if (phase === 'thinking') return;
    if (phase === 'listening') {
      stopListening();
      return;
    }
    startListening();
  };

  /* ── Auto-speak toggle (persists via the user's prefs) ──────── */
  const toggleAutoSpeak = () => {
    const next = !autoSpeak;
    setAutoSpeak(next);
    autoSpeakRef.current = next;
    savePrefs(email, { ...loadPrefs(email), autoSpeak: next });
    if (!next && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* nothing playing */
      }
    }
  };

  /* ── Clear the conversation (client-side memory only) ───────── */
  const clearConversation = () => {
    appendMessages([]);
    setInterim('');
    setInput('');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* nothing playing */
      }
    }
  };

  const suggestions = [d.aiChatSug1, d.aiChatSug2, d.aiChatSug3, d.aiChatSug4];
  const firstUserIdx = messages.findIndex((m) => m.role === 'user');

  /* ── Empty state ────────────────────────────────────────────── */
  const emptyState = (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <Mic className="h-7 w-7" aria-hidden="true" />
      </span>
      <h3 className="mt-5 text-lg font-semibold text-slate-800">
        {d.vtStartTitle}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        {d.vtStartDesc}
      </p>
      <div className="mt-6 flex max-w-md flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void send(s)}
            disabled={phase === 'thinking'}
            className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-emerald-300 hover:bg-emerald-50/60 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="flex items-center gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <Mic className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {d.vtTitle}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{d.vtSubtitle}</p>
        </div>
      </div>

      {/* Controls card */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
        {/* Subject context + voice/clear actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full min-w-0 sm:max-w-xs">
            <Label className="text-xs font-medium text-slate-500">
              {d.vtContextLabel}
            </Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger
                aria-label={d.sumSubjectLabel}
                className="mt-1.5 h-10 w-full rounded-lg border-slate-200 text-sm text-slate-700"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64 rounded-xl border-slate-200">
                <SelectItem value={NO_CONTEXT}>{d.exNoContext}</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleAutoSpeak}
              aria-pressed={autoSpeak}
              className={cn(
                'h-9 rounded-lg border-slate-200 text-xs font-medium sm:text-sm',
                autoSpeak
                  ? 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800'
                  : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              {autoSpeak ? (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              )}
              {autoSpeak ? d.vtSpeakOn : d.vtSpeakOff}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearConversation}
              disabled={messages.length === 0 && !interim}
              aria-label={d.vtClear}
              className="h-9 rounded-lg border-slate-200 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 sm:text-sm"
            >
              <Eraser className="h-4 w-4" aria-hidden="true" />
              {d.vtClear}
            </Button>
          </div>
        </div>

        {/* Context status line */}
        {subject &&
          (docCount > 0 ? (
            <p className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-emerald-700">
              <span
                className={cn(
                  'inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  CHIP_STYLES[subject.color]
                )}
              >
                <span className="truncate">{subject.name}</span>
              </span>
              <span className="min-w-0">
                {d.sumContextLine(subject.name, docCount)}
              </span>
            </p>
          ) : (
            <p className="mt-2.5 flex min-w-0 items-start gap-1.5 text-sm text-orange-600">
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-orange-500"
                aria-hidden="true"
              />
              <span className="min-w-0">
                {d.sumNoPdfsHint(subject.name)}
              </span>
            </p>
          ))}

        {/* Conversation */}
        <div
          ref={scrollRef}
          className="scrollbar-thin mt-5 max-h-96 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/40"
          aria-live="polite"
          aria-label={d.vtTitle}
        >
          {messages.length === 0 ? (
            emptyState
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-5 sm:px-4">
              {messages.map((m, idx) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex flex-col items-end gap-1">
                    {idx === firstUserIdx && (
                      <span className="pr-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {d.vtYouSaid}
                      </span>
                    )}
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-slate-800 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm sm:max-w-[75%]">
                      {m.content}
                    </div>
                    {m.failed && (
                      <button
                        type="button"
                        onClick={() => void send(m.content)}
                        className="flex items-center gap-1.5 pr-1 text-xs font-medium text-emerald-600 transition hover:text-emerald-700"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        {d.vtSendFailed}
                      </button>
                    )}
                  </div>
                ) : (
                  <div key={m.id} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"
                      aria-hidden="true"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </span>
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-2.5 text-sm leading-relaxed text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:max-w-[75%]">
                      {m.content}
                    </div>
                  </div>
                )
              )}

              {/* Tutor "speaking..." indicator */}
              {phase === 'thinking' && (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <span className="flex gap-1" role="status" aria-label={d.vtThinking}>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live interim transcript while listening */}
        {phase === 'listening' && interim && (
          <p className="mx-auto mt-3 max-w-xl px-2 text-center text-sm italic leading-relaxed text-slate-500">
            {interim}
          </p>
        )}

        {/* Mic button (hidden in text-only mode) */}
        {speechSupported ? (
          <div className="mt-6 flex flex-col items-center">
            <button
              type="button"
              onClick={handleMicClick}
              disabled={phase === 'thinking'}
              aria-label={
                phase === 'listening' ? d.vtListening : d.vtTapToTalk
              }
              className={cn(
                'flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70',
                phase === 'listening' && 'animate-pulse ring-4 ring-emerald-300/60'
              )}
            >
              {phase === 'thinking' ? (
                <Loader2 className="h-9 w-9 animate-spin" aria-hidden="true" />
              ) : (
                <Mic className="h-9 w-9" aria-hidden="true" />
              )}
            </button>
            <p className="mt-2.5 text-sm font-medium text-slate-600">
              {phase === 'listening'
                ? d.vtListening
                : phase === 'thinking'
                  ? d.vtThinking
                  : d.vtTapToTalk}
            </p>
          </div>
        ) : (
          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <span>{d.vtUnsupported}</span>
          </div>
        )}

        {/* Text fallback input (always available) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="mt-6 flex items-center gap-2.5"
        >
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={d.vtPlaceholder}
            aria-label={d.vtPlaceholder}
            maxLength={2000}
            autoComplete="off"
            disabled={phase === 'thinking'}
            className="h-11 flex-1 rounded-xl border-slate-200 bg-white text-sm text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] placeholder:text-slate-400 focus-visible:ring-emerald-500/20"
          />
          <Button
            type="submit"
            aria-label={d.aiChatSend}
            disabled={!input.trim() || phase === 'thinking'}
            className="h-11 w-11 shrink-0 rounded-full bg-emerald-500 p-0 text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50"
          >
            <Send className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
        </form>

        {/* Disclaimer */}
        <p className="mt-4 text-center text-xs text-slate-400">
          {d.vtDisclaimer}
        </p>
      </div>
    </div>
  );
}
