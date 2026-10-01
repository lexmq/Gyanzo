import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/auth/google/demo        Body: { email, name? }
 *
 * Local demo Google sign-in — used ONLY when the server has no Google
 * OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET), mirroring
 * how send-code degrades to a visible demo code when SMTP is absent.
 * The auth dialog labels it clearly as a demo.
 *
 * Links (or creates) the account exactly like the real callback would:
 *   - existing account → googleId kept as-is when already linked,
 *     otherwise set to "demo:<email>"; email marked verified (a Google
 *     identity is a verified identity).
 *   - new account → created with name, googleId, googleEmail, verified.
 *
 * Returns: { ok: true, created, needsProfileSetup, user: { name, email } }
 *   needsProfileSetup = brand-new account OR one that never finished the
 *   Profile-Setup onboarding (mirrors the real OAuth callback).
 * Errors:  { ok: false, error: 'invalidEmail' | 'server' }
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email = '';
  let name = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
    name = String(body?.name ?? '').trim();
  } catch {
    // fall through to validation
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: 'invalidEmail' },
      { status: 400 }
    );
  }

  try {
    const now = new Date();
    const existing = await db.user.findUnique({ where: { email } });
    const user = existing
      ? await db.user.update({
          where: { email },
          data: {
            googleId: existing.googleId ?? `demo:${email}`,
            googleEmail: email,
            ...(existing.emailVerified ? {} : { emailVerified: now }),
          },
        })
      : await db.user.create({
          data: {
            email,
            name: name || email.split('@')[0],
            googleId: `demo:${email}`,
            googleEmail: email,
            emailVerified: now,
          },
        });

    return NextResponse.json({
      ok: true,
      // true when this demo sign-in CREATED a brand-new account.
      created: !existing,
      // true when the Profile-Setup onboarding should run (new account
      // OR one that never completed it) — same rule as the real callback.
      needsProfileSetup: !existing || !existing.profileCompletedAt,
      user: {
        name: user.name ?? email.split('@')[0],
        email: user.email,
      },
    });
  } catch (error) {
    console.error('[auth/google/demo] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
