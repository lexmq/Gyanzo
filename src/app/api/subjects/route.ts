import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushNotification } from '@/lib/notify';

/**
 * Subjects — scoped to the signed-in user's email.
 *
 * GET  /api/subjects?email=<email>  → { ok, subjects: [...] }
 * POST /api/subjects { email, name, color? } → { ok, subject }
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_COLORS = new Set(['emerald', 'orange', 'teal', 'amber', 'violet', 'rose']);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const subjects = await db.subject.findMany({
      where: { userEmail: email },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({
      ok: true,
      subjects: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        color: ALLOWED_COLORS.has(s.color) ? s.color : 'emerald',
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[subjects/GET] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let email = '';
  let name = '';
  let color = 'emerald';
  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    name = String(body?.name ?? '').trim();
    color = String(body?.color ?? 'emerald').trim();
  } catch {
    // fall through to validation
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (!ALLOWED_COLORS.has(color)) color = 'emerald';

  try {
    const subject = await db.subject.create({
      data: { userEmail: email, name, color },
    });

    /* Real-time bell notification (persist + socket fan-out). */
    void pushNotification({
      email,
      type: 'subject',
      params: { name: subject.name },
      actionNav: 'subjects',
    });

    return NextResponse.json({
      ok: true,
      subject: {
        id: subject.id,
        name: subject.name,
        color: subject.color,
        createdAt: subject.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[subjects/POST] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
