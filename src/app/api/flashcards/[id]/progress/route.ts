import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Study progress for one card of a deck (spaced-repetition marking).
 *
 * POST /api/flashcards/<id>/progress { email, cardIdx, known }
 *   → { ok, knownCount, total }
 *
 * Marks are upserted so re-studying a card simply overwrites the flag.
 */

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { email?: unknown; cardIdx?: unknown; known?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const cardIdx = Number(body.cardIdx);
  const known = body.known === true;

  if (
    !EMAIL_RE.test(email) ||
    !id ||
    !Number.isInteger(cardIdx) ||
    cardIdx < 0 ||
    cardIdx > 999
  ) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const deck = await db.flashcardDeck.findFirst({
      where: { id, userEmail: email },
      select: { id: true, cards: true },
    });
    if (!deck) {
      return NextResponse.json(
        { ok: false, error: 'notFound' },
        { status: 404 }
      );
    }

    let total = 0;
    try {
      const parsed = JSON.parse(deck.cards) as unknown;
      if (Array.isArray(parsed)) total = parsed.length;
    } catch {
      total = 0;
    }
    if (cardIdx >= total) {
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }

    await db.flashcardProgress.upsert({
      where: { deckId_cardIdx: { deckId: deck.id, cardIdx } },
      create: { deckId: deck.id, userEmail: email, cardIdx, known },
      update: { known },
    });

    const knownCount = await db.flashcardProgress.count({
      where: { deckId: deck.id, userEmail: email, known: true },
    });

    return NextResponse.json({ ok: true, knownCount, total });
  } catch (error) {
    console.error('[flashcards/progress] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
