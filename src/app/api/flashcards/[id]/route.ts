import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Single flashcard deck — open (with per-card mastery flags) or delete.
 *
 * GET    /api/flashcards/<id>?email=<email> → { ok, deck: DeckFull }
 * DELETE /api/flashcards/<id>?email=<email> → { ok }
 */

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email) || !id) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const row = await db.flashcardDeck.findFirst({
      where: { id, userEmail: email },
    });
    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'notFound' },
        { status: 404 }
      );
    }

    let cards: { front: string; back: string }[] = [];
    try {
      const parsed = JSON.parse(row.cards) as unknown;
      if (Array.isArray(parsed)) {
        cards = parsed
          .filter(
            (c): c is { front: string; back: string } =>
              !!c &&
              typeof c === 'object' &&
              typeof (c as { front?: unknown }).front === 'string' &&
              typeof (c as { back?: unknown }).back === 'string'
          )
          .map((c) => ({ front: c.front, back: c.back }));
      }
    } catch {
      cards = [];
    }

    const progress = await db.flashcardProgress.findMany({
      where: { deckId: row.id, userEmail: email, known: true },
      select: { cardIdx: true },
    });
    const known = progress
      .map((p) => p.cardIdx)
      .filter((idx) => idx >= 0 && idx < cards.length)
      .sort((a, b) => a - b);

    return NextResponse.json({
      ok: true,
      deck: {
        id: row.id,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        title: row.title,
        total: cards.length,
        knownCount: known.length,
        cards,
        known,
        createdAt: row.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[flashcards/GET one] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email) || !id) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const existing = await db.flashcardDeck.findFirst({
      where: { id, userEmail: email },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: 'notFound' },
        { status: 404 }
      );
    }

    await db.flashcardProgress.deleteMany({ where: { deckId: existing.id } });
    await db.flashcardDeck.delete({ where: { id: existing.id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[flashcards/DELETE] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
