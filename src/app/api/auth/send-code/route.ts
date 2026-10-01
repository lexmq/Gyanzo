import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { db } from '@/lib/db';
import { activeMailChannel, sendVerificationCodeEmail } from '@/lib/mailer';

/**
 * POST /api/auth/send-code
 *
 * Generates an 8-character verification code for the given email and
 * stores it (upsert — a new request always replaces any previous pending
 * code). The code is valid for 10 minutes.
 *
 * Delivery (auto-detected channel, see src/lib/mailer.ts):
 *  - RESEND_API_KEY set   → sent via the Resend HTTP API
 *  - SMTP_HOST/USER/PASS  → sent via SMTP (Gmail App Password, Brevo, …)
 *  - Either success       → returns { ok, delivered: true, channel }
 *  - Nothing configured or delivery fails → returns { ok, delivered:
 *    false, demoCode } so the flow can continue (the code is also logged
 *    server-side). Fill in credentials in .env to email for real.
 */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 confusion
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export async function POST(request: Request) {
  let email = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
  } catch {
    // fall through to validation
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalidEmail' }, { status: 400 });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  try {
    await db.emailVerification.upsert({
      where: { email },
      update: { code, expiresAt, attempts: 0, consumed: false },
      create: { email, code, expiresAt },
    });
  } catch (error) {
    console.error('[auth/send-code] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }

  // ── Real email delivery when a channel is configured ──
  const channel = activeMailChannel();
  if (channel !== 'none') {
    try {
      await sendVerificationCodeEmail(email, code);
      console.log(
        `[auth/send-code] verification code EMAILED to ${email} via ${channel}`
      );
      return NextResponse.json({ ok: true, delivered: true, channel });
    } catch (error) {
      // Never block the flow on provider problems — fall back to demo mode.
      console.error(
        `[auth/send-code] ${channel} delivery to ${email} failed, falling back to demo code:`,
        error
      );
    }
  }

  // ── Demo fallback (no SMTP configured, or delivery failed) ──
  console.log(`[auth/send-code] verification code for ${email}: ${code}`);
  return NextResponse.json({ ok: true, delivered: false, demoCode: code });
}
