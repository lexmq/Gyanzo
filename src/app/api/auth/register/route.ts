import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';

/**
 * POST /api/auth/register
 *
 * Creates (or completes) the account right after the email code has been
 * verified. Stores the name, a scrypt password hash and the verification
 * timestamp. Idempotent: re-registering the same email updates the record.
 *
 * Body: { email, name, password? }
 *   - password optional (≥ 8 chars enforced client-side for sign-up)
 * Returns: { ok: true, user: { name, email } }
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email = '';
  let name = '';
  let password = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    name = String(body?.name ?? '').trim();
    password = String(body?.password ?? '');
  } catch {
    // fall through to validation
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (name.length < 2) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (password && password.length < 8) {
    return NextResponse.json({ ok: false, error: 'weakPassword' }, { status: 400 });
  }

  try {
    const passwordHash = password ? hashPassword(password) : undefined;
    const user = await db.user.upsert({
      where: { email },
      update: {
        name,
        ...(passwordHash ? { passwordHash } : {}),
        emailVerified: new Date(),
      },
      create: {
        email,
        name,
        ...(passwordHash ? { passwordHash } : {}),
        emailVerified: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      user: { name: user.name ?? name, email: user.email },
    });
  } catch (error) {
    console.error('[auth/register] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
