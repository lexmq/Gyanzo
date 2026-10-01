import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/auth/verify-code
 *
 * Checks the 8-character code the user typed against the pending
 * verification record for their email. On success the record is consumed
 * (one-time use). Error codes returned in `error`:
 *   - 'length'   → code is not 8 characters
 *   - 'invalid'  → no record / already used / code mismatch
 *   - 'expired'  → the code is past its 10-minute TTL
 *   - 'tooMany'  → more than MAX_ATTEMPTS wrong tries
 *   - 'server'   → unexpected database failure
 */

const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 6;

export async function POST(request: Request) {
  let email = '';
  let code = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
    code = String(body?.code ?? '')
      .trim()
      .toUpperCase();
  } catch {
    // fall through to validation
  }

  if (!email || code.length !== CODE_LENGTH) {
    return NextResponse.json({ ok: false, error: 'length' }, { status: 400 });
  }

  try {
    const record = await db.emailVerification.findUnique({ where: { email } });

    if (!record || record.consumed) {
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: 'expired' }, { status: 400 });
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      return NextResponse.json({ ok: false, error: 'tooMany' }, { status: 429 });
    }
    if (record.code !== code) {
      await db.emailVerification.update({
        where: { email },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }

    await db.emailVerification.update({
      where: { email },
      data: { consumed: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[auth/verify-code] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
