import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Study progress for one word of a vocabulary list (Known / Learning).
 *
 * POST /api/vocabulary/<id>/progress { email, idx, known }
 *   → { ok, knownCount }
 *
 * Marks are upserted so re-toggling a word simply overwrites the flag.
 */

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { email?: unknown; idx?: unknown; known?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const idx = Number(body.idx);
  const known = body.known === true;

  if (
    !EMAIL_RE.test(email) ||
    !id ||
    !Number.isInteger(idx) ||
    idx < 0 ||
    idx > 999
  ) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const list = await db.vocabList.findFirst({
      where: { id, userEmail: email },
      select: { id: true, count: true },
    });
    if (!list) {
      return NextResponse.json(
        { ok: false, error: 'notFound' },
        { status: 404 }
      );
    }
    if (idx >= list.count) {
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }

    await db.vocabProgress.upsert({
      where: { listId_wordIdx: { listId: list.id, wordIdx: idx } },
      create: { listId: list.id, userEmail: email, wordIdx: idx, known },
      update: { known },
    });

    const knownCount = await db.vocabProgress.count({
      where: { listId: list.id, userEmail: email, known: true },
    });

    return NextResponse.json({ ok: true, knownCount });
  } catch (error) {
    console.error('[vocabulary/progress] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
