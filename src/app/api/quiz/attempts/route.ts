import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushNotification } from '@/lib/notify';

/**
 * Quiz attempts — one graded run through a generated quiz, scoped to the
 * signed-in user's email. Grading happens SERVER-SIDE so the correct
 * answers never reach the client before submission.
 *
 * GET    /api/quiz/attempts?email=<email>[&meta=1]
 *          → { ok, attempts } (meta=1 omits the heavy per-question review)
 * POST   /api/quiz/attempts { email, quizId, answers }
 *          → { ok, attempt }  (answers: (number|string|null)[] per question)
 * DELETE /api/quiz/attempts?email=<email>&id=<id> → { ok }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORED_ATTEMPTS = 50;

type QuizQuestion = {
  type: 'mcq' | 'truefalse' | 'fillblank';
  question: string;
  options: string[] | null;
  answer: number | string;
  explanation: string;
};

type ReviewQuestion = {
  type: 'mcq' | 'truefalse' | 'fillblank';
  question: string;
  options: string[] | null;
  given: number | string | null;
  answer: number | string;
  correct: boolean;
  explanation: string;
};

type AttemptDTO = {
  id: string;
  quizId: string;
  subjectName: string;
  difficulty: string;
  total: number;
  correct: number;
  scorePct: number;
  review?: ReviewQuestion[];
  createdAt: string;
};

function serialize(
  row: {
    id: string;
    quizId: string;
    subjectName: string;
    difficulty: string;
    total: number;
    correct: number;
    scorePct: number;
    review: string;
    createdAt: Date;
  },
  withReview: boolean
): AttemptDTO {
  let review: ReviewQuestion[] = [];
  try {
    const parsed = JSON.parse(row.review) as ReviewQuestion[];
    if (Array.isArray(parsed)) {
      review = parsed
        .filter((r) => r && typeof r === 'object' && typeof r.question === 'string')
        .map((r) => ({
          type: r.type,
          question: r.question,
          options: Array.isArray(r.options) ? r.options : null,
          given: (r.given ?? null) as number | string | null,
          answer: r.answer as number | string,
          correct: Boolean(r.correct),
          explanation: typeof r.explanation === 'string' ? r.explanation : '',
        }));
    }
  } catch {
    /* keep the empty fallback */
  }
  const base: AttemptDTO = {
    id: row.id,
    quizId: row.quizId,
    subjectName: row.subjectName,
    difficulty: row.difficulty,
    total: row.total,
    correct: row.correct,
    scorePct: row.scorePct,
    createdAt: row.createdAt.toISOString(),
  };
  return withReview ? { ...base, review } : base;
}

/* Fill-in-the-blank normalization: trim, lowercase, collapse spaces and
   drop trailing punctuation so "The Mitochondria." matches "mitochondria". */
function normText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '');
}

function gradeOne(q: QuizQuestion, given: number | string | null): boolean {
  if (given === null || given === '') return false;
  if (q.type === 'fillblank') {
    if (typeof given !== 'string') return false;
    return String(q.answer)
      .split('|')
      .some((alt) => normText(alt) === normText(given));
  }
  return typeof given === 'number' && given === q.answer;
}

/* ── GET → the user's attempts (newest first) ─────────────────────── */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();
  const withReview = searchParams.get('meta') !== '1';

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const rows = await db.quizAttempt.findMany({
      where: { userEmail: email },
      orderBy: { createdAt: 'desc' },
      take: STORED_ATTEMPTS,
    });
    return NextResponse.json({
      ok: true,
      attempts: rows.map((row) => serialize(row, withReview)),
    });
  } catch (error) {
    console.error('[quiz/attempts/GET] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/* ── POST → grade + persist one attempt (server-side grading) ─────── */
export async function POST(request: Request) {
  let body: {
    email?: unknown;
    quizId?: unknown;
    answers?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const quizId = typeof body.quizId === 'string' ? body.quizId.trim() : '';
  const answers = Array.isArray(body.answers) ? body.answers : [];

  if (!EMAIL_RE.test(email) || !quizId) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const quiz = await db.quiz.findFirst({
      where: { id: quizId, userEmail: email },
    });
    if (!quiz) {
      return NextResponse.json({ ok: false, error: 'notfound' }, { status: 404 });
    }

    let questions: QuizQuestion[] = [];
    try {
      const parsed = JSON.parse(quiz.questions) as QuizQuestion[];
      if (Array.isArray(parsed)) questions = parsed;
    } catch {
      /* questions stays empty */
    }
    if (questions.length === 0) {
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }

    const review: ReviewQuestion[] = questions.map((q, i) => {
      const raw = answers[i];
      const given =
        typeof raw === 'number' || typeof raw === 'string'
          ? raw
          : null;
      return {
        type: q.type,
        question: q.question,
        options: q.options,
        given,
        answer: q.answer,
        correct: gradeOne(q, given),
        explanation: q.explanation,
      };
    });

    const total = review.length;
    const correct = review.filter((r) => r.correct).length;
    const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;

    const row = await db.quizAttempt.create({
      data: {
        userEmail: email,
        quizId: quiz.id,
        subjectName: quiz.subjectName,
        difficulty: quiz.difficulty,
        total,
        correct,
        scorePct,
        review: JSON.stringify(review),
      },
    });

    /* Real-time bell notification (persist + socket fan-out). */
    void pushNotification({
      email,
      type: 'quiz',
      params: {
        subject: quiz.subjectName || '',
        score: scorePct,
        correct,
        total,
      },
      actionNav: 'quiz',
    });

    return NextResponse.json({
      ok: true,
      attempt: serialize(row, true),
    });
  } catch (error) {
    console.error('[quiz/attempts/POST] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

/* ── DELETE → remove one saved attempt ────────────────────────────── */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();
  const id = (searchParams.get('id') ?? '').trim();

  if (!EMAIL_RE.test(email) || !id) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    await db.quizAttempt.deleteMany({ where: { id, userEmail: email } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[quiz/attempts/DELETE] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
