import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Finishes the Google OAuth 2.0 authorization-code flow:
 *   1. Validates `state` against the HttpOnly cookie set by /url (CSRF).
 *   2. Exchanges the code for tokens at oauth2.googleapis.com/token
 *      (redirect_uri rebuilt from the origin carried in the cookie —
 *      or the GOOGLE_REDIRECT_URI env override, mirroring /url exactly).
 *   3. Reads the profile via the userinfo endpoint (sub, email, name).
 *   4. Links or creates the local account (googleId/googleEmail — the
 *      same fields the Profile section reads) and marks the email
 *      verified (Google already verified it).
 *   5. Responds with a tiny brand-styled bridge page that writes the
 *      client session (localStorage "gyanzo-session") and redirects to
 *      "/" — the reader lands on the Dashboard. EVERY Google sign-in
 *      also gets the "gyanzo-profile-setup" flag (product requirement:
 *      auth → Profile Completion → Dashboard), which makes the app open
 *      the Profile Completion pages right on top of the Dashboard; the
 *      wizard prefills any previously saved profile so returning users
 *      just confirm and continue.
 *
 * Any failure renders the same page in an error state with a way back.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** JSON made safe for inline <script> embedding. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const PAGE_STYLE =
  'margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#edfdf4;font-family:Poppins,system-ui,-apple-system,sans-serif;color:#04102e';

const LOGO_SVG =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>';

const LOGO_BOX = `width:56px;height:56px;margin:0 auto 1.25rem;border-radius:50%;background:#04b87a;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(4,184,122,.35)`;

/** Brand-styled error page with a way back. */
function fail(message: string): NextResponse {
  console.error('[auth/google/callback]', message);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in failed — Gyanzo</title></head>
<body style="${PAGE_STYLE}"><div style="text-align:center;padding:2rem">
<div style="${LOGO_BOX}">${LOGO_SVG}</div>
<p style="font-size:1.05rem;font-weight:600">${safeJson(message).slice(1, -1)}</p>
<a href="/" style="display:inline-block;margin-top:1.25rem;padding:.65rem 1.4rem;border-radius:.75rem;background:#029966;color:#fff;font-size:.875rem;font-weight:600;text-decoration:none">Back to Gyanzo</a>
</div></body></html>`;
  const res = new NextResponse(html, {
    status: 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
  // One-time state — always clear it.
  res.cookies.set('g_oauth_state', '', { path: '/', maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get('g_oauth_state')?.value ?? '';
  const [cookieState, originB64] = cookie.split('~');
  let origin = '';
  try {
    origin = Buffer.from(originB64 ?? '', 'base64url').toString('utf8');
  } catch {
    origin = '';
  }

  const code = request.nextUrl.searchParams.get('code') ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';

  if (!cookieState || !origin || !state || state !== cookieState) {
    return fail(
      'We could not verify this sign-in attempt. Please go back and try again.'
    );
  }
  if (!code) {
    return fail(
      'Google did not return an authorization code. Please try signing in again.'
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('Google sign-in is not configured on this server.');
  }

  try {
    /* ── 1. Code → tokens ─────────────────────────────────────── */
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri:
          process.env.GOOGLE_REDIRECT_URI?.trim() ||
          `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      return fail(
        'Google refused the token exchange. Please try signing in again.'
      );
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      return fail(
        'Google did not return an access token. Please try signing in again.'
      );
    }

    /* ── 2. Access token → profile ────────────────────────────── */
    const infoRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!infoRes.ok) {
      return fail('Could not read your Google profile. Please try again.');
    }
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    const email = (info.email ?? '').trim().toLowerCase();
    if (!info.sub || !EMAIL_RE.test(email)) {
      return fail(
        'Your Google account did not share an email address with Gyanzo.'
      );
    }

    /* ── 3. Link or create the local account ──────────────────── */
    const now = new Date();
    const name = (info.name ?? '').trim() || email.split('@')[0];
    const existing = await db.user.findUnique({ where: { email } });
    const user = existing
      ? await db.user.update({
          where: { email },
          data: {
            googleId: info.sub,
            googleEmail: email,
            ...(existing.emailVerified ? {} : { emailVerified: now }),
          },
        })
      : await db.user.create({
          data: {
            email,
            name,
            googleId: info.sub,
            googleEmail: email,
            emailVerified: now,
          },
        });

    /* ── 4. Bridge the client session → Dashboard ─────────────── */
    // Product requirement: EVERY Google sign-in routes through Profile
    // Completion before the Dashboard. The wizard prefills whatever the
    // user saved previously (avatar/college/semester/goals), so returning
    // users just confirm and continue; brand-new users fill it fresh.
    const needsProfileSetup = true;
    const session = {
      name: user.name ?? email.split('@')[0],
      email: user.email,
    };
    // Pending → show the onboarding; already completed → make sure no
    // stale flag from an earlier visit can pop it up again.
    const flagJs = needsProfileSetup
      ? "localStorage.setItem('gyanzo-profile-setup','1');"
      : "localStorage.removeItem('gyanzo-profile-setup');";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing you in — Gyanzo</title></head>
<body style="${PAGE_STYLE}"><div style="text-align:center">
<div style="${LOGO_BOX}">${LOGO_SVG}</div>
<p style="font-size:1.05rem;font-weight:600">Signing you in&#8230;</p>
</div>
<script>
try{localStorage.setItem('gyanzo-session',JSON.stringify(${safeJson(session)}));${flagJs}}catch(e){}
setTimeout(function(){location.replace('/');},250);
</script></body></html>`;
    const res = new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
    res.cookies.set('g_oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch (error) {
    console.error('[auth/google/callback] unexpected error:', error);
    return fail('Unexpected server error. Please try signing in again.');
  }
}
