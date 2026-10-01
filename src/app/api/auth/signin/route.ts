import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';

/**
 * POST /api/auth/signin
 *
 * Real credential check against the Users table (the hash was stored when
 * the account verified its email). Error codes returned in `error`:
 *   - 'notFound'      → no account for this email
 *   - 'wrongPassword' → password doesn't match
 *   - 'server'        → unexpected database failure
 *
 * Returns: { ok: true, profileComplete, user: { name, email } }
 *   profileComplete = false when the account never finished the
 *   Profile-Setup onboarding (the client then shows it after sign-in).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email = '';
  let password = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    password = String(body?.password ?? '');
  } catch {
    // fall through to validation
  }

  if (!EMAIL_RE.test(email) || !password) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
    }

    // Accounts created before passwords were stored have no hash — let
    // them in (demo-friendly) rather than dead-ending the user.
    if (user.passwordHash && !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ ok: false, error: 'wrongPassword' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      profileComplete: Boolean(user.profileCompletedAt),
      user: {
        name: user.name ?? email.split('@')[0],
        email: user.email,
      },
    });
  } catch (error) {
    console.error('[auth/signin] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
