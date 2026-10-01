import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Progress — aggregates the signed-in user's real study activity from
 * SQLite into one payload for the Progress section:
 *
 *   - study material counts (subjects / PDFs)
 *   - quiz performance (count + average score + recent scores)
 *   - flashcard mastery (known / total cards across all decks)
 *   - AI documents generated per feature
 *   - last-7-days daily activity + consecutive-day streak
 *   - per-subject breakdown (PDFs + quizzes)
 *
 * GET /api/progress?email=<email> → { ok, progress }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ProgressPayload = {
  subjects: number;
  pdfs: number;
  quizCount: number;
  quizAvgPct: number;
  recentAttempts: { subjectName: string; scorePct: number; createdAt: string }[];
  decks: number;
  cardsTotal: number;
  cardsKnown: number;
  generated: {
    summaries: number;
    explanations: number;
    notes: number;
    mindMaps: number;
    citations: number;
    vocabLists: number;
    predictions: number;
    formulaSheets: number;
    total: number;
  };
  streakDays: number;
  activityByDay: { date: string; count: number }[];
  perSubject: { name: string; pdfs: number; quizzes: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local YYYY-MM-DD key for a Date (matches the day buckets). */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const [
      subjectRows,
      pdfRows,
      attempts,
      decks,
      knownCount,
      summaries,
      explanations,
      notes,
      mindMaps,
      citations,
      vocabLists,
      predictions,
      formulaSheets,
    ] = await Promise.all([
      db.subject.findMany({
        where: { userEmail: email },
        orderBy: { createdAt: 'asc' },
        select: { name: true },
      }),
      db.pdf.findMany({
        where: { userEmail: email },
        select: { subjectName: true },
      }),
      db.quizAttempt.findMany({
        where: { userEmail: email },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { subjectName: true, scorePct: true, createdAt: true },
      }),
      db.flashcardDeck.findMany({
        where: { userEmail: email },
        take: 1000,
        select: { cards: true, createdAt: true },
      }),
      db.flashcardProgress.count({ where: { userEmail: email, known: true } }),
      db.summary.count({ where: { userEmail: email } }),
      db.explanation.count({ where: { userEmail: email } }),
      db.revisionNote.count({ where: { userEmail: email } }),
      db.mindMap.count({ where: { userEmail: email } }),
      db.citation.count({ where: { userEmail: email } }),
      db.vocabList.count({ where: { userEmail: email } }),
      db.examPrediction.count({ where: { userEmail: email } }),
      db.formulaSheet.count({ where: { userEmail: email } }),
    ]);

    /* Quiz aggregates */
    const quizCount = attempts.length;
    const quizAvgPct =
      quizCount === 0
        ? 0
        : Math.round(
            attempts.reduce((sum, a) => sum + a.scorePct, 0) / quizCount
          );

    /* Flashcard aggregates */
    const cardsTotal = decks.reduce((sum, d) => {
      try {
        const parsed = JSON.parse(d.cards) as unknown;
        return sum + (Array.isArray(parsed) ? parsed.length : 0);
      } catch {
        return sum;
      }
    }, 0);

    /* Daily activity (quizzes + decks + notes + summaries), last 7 days */
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const days: { date: string; count: number }[] = [];
    const countsByDay = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday.getTime() - i * DAY_MS);
      days.push({ date: dayKey(d), count: 0 });
      countsByDay.set(dayKey(d), 0);
    }
    const activityDates: Date[] = [];
    for (const a of attempts) activityDates.push(a.createdAt);
    for (const d of decks) activityDates.push(d.createdAt);
    for (const at of activityDates) {
      const key = dayKey(at);
      const slot = countsByDay.get(key);
      if (slot !== undefined) {
        countsByDay.set(key, slot + 1);
      }
    }
    for (const day of days) {
      day.count = countsByDay.get(day.date) ?? 0;
    }

    /* Streak: consecutive days with ≥1 activity, anchored on today
       (or yesterday if nothing yet today — the streak isn't broken
       until the day actually ends). */
    const activeDays = new Set(activityDates.map((at) => dayKey(at)));
    let streakDays = 0;
    let cursor = new Date(startOfToday);
    if (!activeDays.has(dayKey(cursor))) {
      cursor = new Date(cursor.getTime() - DAY_MS);
    }
    while (activeDays.has(dayKey(cursor))) {
      streakDays += 1;
      cursor = new Date(cursor.getTime() - DAY_MS);
    }

    /* Per-subject breakdown */
    const perSubject = subjectRows.map((s) => ({
      name: s.name,
      pdfs: pdfRows.filter((p) => p.subjectName === s.name).length,
      quizzes: attempts.filter((a) => a.subjectName === s.name).length,
    }));

    const generated = {
      summaries,
      explanations,
      notes,
      mindMaps,
      citations,
      vocabLists,
      predictions,
      formulaSheets,
      total:
        summaries +
        explanations +
        notes +
        mindMaps +
        citations +
        vocabLists +
        predictions +
        formulaSheets,
    };

    const progress: ProgressPayload = {
      subjects: subjectRows.length,
      pdfs: pdfRows.length,
      quizCount,
      quizAvgPct,
      recentAttempts: attempts.slice(0, 5).map((a) => ({
        subjectName: a.subjectName,
        scorePct: a.scorePct,
        createdAt: a.createdAt.toISOString(),
      })),
      decks: decks.length,
      cardsTotal,
      cardsKnown: knownCount,
      generated,
      streakDays,
      activityByDay: days,
      perSubject,
    };

    return NextResponse.json({ ok: true, progress });
  } catch (error) {
    console.error('[progress/GET] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
