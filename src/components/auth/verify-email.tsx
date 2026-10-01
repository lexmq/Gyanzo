'use client';

/**
 * "Verify Your Email" page — shown right after a successful Sign Up.
 *
 * A one-time 8-character code is generated server-side (POST
 * /api/auth/send-code) with a 10-minute TTL.
 *
 * Delivery states (surfaced PERSISTENTLY on the card — never only in a
 * toast):
 *   · delivered=true  → green banner: the code was emailed to the inbox.
 *   · delivered=false → amber DEMO banner showing the code right on the
 *     card (with a copy button) — email delivery isn't configured on the
 *     server, so this is the only place the code exists. The typed code
 *     is checked by POST /api/auth/verify-code (max 6 wrong attempts,
 *     one-time use).
 */

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  LogIn,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n';

const CODE_LENGTH = 8;
const RESEND_SECONDS = 60;

export default function VerifyEmailView({
  email,
  initialDelivered = false,
  initialDemoCode = null,
  onVerified,
  onDifferentAccount,
}: {
  email: string;
  /** Whether the FIRST code was really emailed (SMTP configured). */
  initialDelivered?: boolean;
  /** Demo code from the first send when email delivery isn't configured. */
  initialDemoCode?: string | null;
  onVerified: () => void;
  onDifferentAccount: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(initialDelivered);
  const [demoCode, setDemoCode] = useState<string | null>(initialDemoCode);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // One-second countdown for the resend link (stops at 0 → "Resend code").
  useEffect(() => {
    const id = window.setInterval(() => {
      setResendIn((seconds) => (seconds > 0 ? seconds - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const requestSend = async () => {
    if (resending) return;
    setResending(true);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && (data.delivered || data.demoCode)) {
        // Keep the delivery state on the card in sync with this resend.
        setDelivered(Boolean(data.delivered));
        setDemoCode(data.delivered ? null : String(data.demoCode));
        setCopied(false);
        toast(
          data.delivered
            ? {
                title: t.auth.codeEmailedToastTitle,
                description: t.auth.codeEmailedToastDesc(email),
                duration: 15000,
              }
            : {
                title: t.auth.codeSentToastTitle,
                description: t.auth.codeResentToastDesc(data.demoCode),
                duration: 15000,
              }
        );
        setCode('');
        setError(null);
        setResendIn(RESEND_SECONDS);
        inputRef.current?.focus();
      } else {
        toast({ title: t.auth.verifyErrNetwork, variant: 'destructive' });
      }
    } catch {
      toast({ title: t.auth.verifyErrNetwork, variant: 'destructive' });
    } finally {
      setResending(false);
    }
  };

  const copyDemoCode = async () => {
    if (!demoCode) return;
    try {
      await navigator.clipboard.writeText(demoCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the code stays visible to type manually.
    }
  };

  const submitCode = async (raw: string) => {
    if (verifying) return;
    const normalized = raw.trim().toUpperCase();
    if (normalized.length !== CODE_LENGTH) {
      setError(t.auth.verifyErrLength);
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: normalized }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        onVerified();
        return;
      }
      if (data?.error === 'expired') setError(t.auth.verifyErrExpired);
      else if (data?.error === 'tooMany') setError(t.auth.verifyErrTooMany);
      else if (data?.error === 'length') setError(t.auth.verifyErrLength);
      else setError(t.auth.verifyErrInvalid);
      setCode('');
      inputRef.current?.focus();
    } catch {
      setError(t.auth.verifyErrNetwork);
    } finally {
      setVerifying(false);
    }
  };

  const handleCodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH);
    setCode(next);
    if (error) setError(null);
    // Auto-verify as soon as the 8th character is typed.
    if (next.length === CODE_LENGTH) void submitCode(next);
  };

  return (
    <div className="w-full rounded-2xl bg-white p-6 shadow-[0_24px_70px_-24px_rgba(2,12,27,0.25)] sm:p-8">
      {/* Envelope badge */}
      <div className="flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 shadow-[0_0_44px_rgba(16,185,129,0.18)]">
          <Mail className="h-7 w-7 text-emerald-600" aria-hidden="true" />
        </div>
      </div>

      <h1 className="mt-5 text-center text-[26px] font-bold tracking-tight text-slate-900 sm:text-[28px]">
        {t.auth.verifyTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        {t.auth.verifySubtitle}
      </p>
      <p className="mt-1 break-all text-center text-sm font-bold text-slate-900">
        {email}
      </p>

      {/* ── Persistent delivery banner (never toast-only) ─────── */}
      {delivered ? (
        <div
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3"
          role="status"
        >
          <MailCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed text-emerald-800">
            {t.auth.verifyEmailedNotice(email)}
          </p>
        </div>
      ) : demoCode ? (
        <div
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3"
          role="status"
        >
          <p className="text-xs font-semibold text-amber-700">
            {t.auth.verifyDemoTitle}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-amber-700/80">
                {t.auth.verifyDemoCodeLabel}
              </p>
              <p className="font-mono text-2xl font-bold tracking-[0.3em] text-slate-900">
                {demoCode}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyDemoCode()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
              aria-label={t.auth.verifyCopyCode}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? t.auth.verifyCopied : t.auth.verifyCopyCode}
            </button>
          </div>
        </div>
      ) : null}

      {/* Code input */}
      <div className="mt-6 space-y-1.5">
        <label
          htmlFor="verify-code"
          className="text-sm font-semibold text-slate-800"
        >
          {t.auth.verifyLabel}
        </label>
        <Input
          id="verify-code"
          value={code}
          onChange={handleCodeChange}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submitCode(code);
            }
          }}
          placeholder={t.auth.verifyPh}
          maxLength={CODE_LENGTH}
          autoCapitalize="characters"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          disabled={verifying}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'verify-code-error' : undefined}
          className={`h-12 rounded-xl border-2 bg-white font-mono text-[15px] uppercase tracking-[0.18em] text-slate-900 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 ${
            error
              ? 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/20'
              : 'border-emerald-300'
          }`}
        />
        {error && (
          <p
            id="verify-code-error"
            role="alert"
            className="text-xs font-medium text-red-500"
          >
            {error}
          </p>
        )}
      </div>

      {/* Verify button */}
      <Button
        type="button"
        onClick={() => void submitCode(code)}
        disabled={verifying || resending}
        className="mt-4 h-12 w-full rounded-xl bg-emerald-500 text-[15px] font-semibold text-white shadow-[0_10px_26px_rgba(16,185,129,0.35)] transition hover:bg-emerald-400 disabled:pointer-events-none disabled:opacity-70"
      >
        {verifying ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        )}
        {verifying ? t.auth.verifyLoading : t.auth.verifySubmit}
      </Button>

      {/* Resend */}
      <div className="mt-4 flex items-center justify-center gap-1.5 text-sm">
        <span className="text-slate-400">{t.auth.resendPrompt}</span>
        {resendIn > 0 ? (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t.auth.resendIn(resendIn)}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void requestSend()}
            disabled={resending}
            className="inline-flex items-center gap-1 font-semibold text-emerald-600 transition hover:text-emerald-500 disabled:pointer-events-none disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {resending ? t.auth.resendLoading : t.auth.resendNow}
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] text-slate-400">{t.auth.verifyOr}</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Different account */}
      <button
        type="button"
        onClick={onDifferentAccount}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {t.auth.differentAccount}
      </button>
    </div>
  );
}
