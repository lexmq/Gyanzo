import nodemailer from 'nodemailer';

/**
 * Verification-code mailer for Gyanzo — TWO delivery channels, auto-detected:
 *
 *   1. Resend HTTP API  (RESEND_API_KEY env) — simplest option: create a free
 *      account at resend.com → API Keys → copy. Works even where outbound
 *      SMTP is blocked. Free tier covers signup flows easily.
 *   2. Classic SMTP     (SMTP_HOST + SMTP_USER + SMTP_PASS env) — any
 *      provider: Gmail (App Password), Brevo, Outlook, ...
 *
 * Delivery is attempted on whichever channel is configured (Resend wins if
 * both are set). When NOTHING is configured `activeMailChannel()` returns
 * 'none' and the app falls back to the in-app demo hint.
 */

// ── Channel 1: Resend ────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
/** Resend's shared sandbox sender works without domain verification. */
const RESEND_FROM = process.env.RESEND_FROM || 'Gyanzo <onboarding@resend.dev>';

// ── Channel 2: SMTP ──────────────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM =
  process.env.SMTP_FROM || (SMTP_USER ? `Gyanzo <${SMTP_USER}>` : '');

export type MailChannel = 'resend' | 'smtp' | 'none';

/** Which channel a send will attempt on ('none' → demo fallback). */
export function activeMailChannel(): MailChannel {
  if (RESEND_API_KEY) return 'resend';
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) return 'smtp';
  return 'none';
}

/** @deprecated kept for compatibility — true when any real channel exists. */
export function isMailConfigured(): boolean {
  return activeMailChannel() !== 'none';
}

// ── Email templates ──────────────────────────────────────────────────────

function codeEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f2f5f3;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f3;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(2,12,27,0.10);">
            <!-- Header -->
            <tr>
              <td style="background:linear-gradient(135deg,#10b981,#059669);padding:28px;text-align:center;">
                <div style="width:52px;height:52px;margin:0 auto 10px;border-radius:14px;background:rgba(255,255,255,0.18);line-height:52px;font-size:26px;">🎓</div>
                <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">Gyanzo</div>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:32px 28px;text-align:center;">
                <h1 style="margin:0 0 8px;font-size:22px;color:#0d1521;">Verify Your Email</h1>
                <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.5;">
                  Use the verification code below to finish creating your Gyanzo account.
                </p>
                <div style="margin:0 auto 20px;padding:16px 24px;border:2px solid #10b981;border-radius:12px;background:#f0fdf9;display:inline-block;">
                  <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0d1521;">${code}</span>
                </div>
                <p style="margin:0 0 6px;font-size:13px;color:#64748b;">
                  This code expires in <strong style="color:#0d1521;">10 minutes</strong>.
                </p>
                <p style="margin:0;font-size:12px;color:#94a3b8;">
                  Didn't request it? You can safely ignore this email.
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #e2e8f0;text-align:center;">
                <span style="font-size:11px;color:#94a3b8;">© 2026 Gyanzo — Learn smarter, grow faster.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function codeEmailText(code: string): string {
  return [
    'Gyanzo — Verify Your Email',
    '',
    `Your verification code: ${code}`,
    '',
    'This code expires in 10 minutes.',
    "Didn't request it? You can safely ignore this email.",
  ].join('\n');
}

export function verificationEmail(to: string, code: string) {
  return {
    from: RESEND_API_KEY ? RESEND_FROM : SMTP_FROM,
    to,
    subject: `Your Gyanzo verification code: ${code}`,
    text: codeEmailText(code),
    html: codeEmailHtml(code),
  };
}

// ── Channel senders (throw on failure — caller falls back to demo) ───────

async function sendViaResend(to: string, code: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verificationEmail(to, code)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Resend API error ${res.status}: ${detail.slice(0, 300)}`
    );
  }
}

async function sendViaSmtp(to: string, code: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER as string, pass: SMTP_PASS as string },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });

  await transporter.sendMail(verificationEmail(to, code));
}

/** Sends the verification-code email on the active channel. */
export async function sendVerificationCodeEmail(
  to: string,
  code: string
): Promise<MailChannel> {
  const channel = activeMailChannel();
  if (channel === 'none') {
    throw new Error('no mail channel configured');
  }
  if (channel === 'resend') {
    await sendViaResend(to, code);
  } else {
    await sendViaSmtp(to, code);
  }
  return channel;
}
