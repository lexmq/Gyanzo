import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Profile — the signed-in user's account data.
 *
 * GET   /api/profile?email=<email>
 *   → { ok, profile: { id, name, email, createdAt, emailVerified, avatar,
 *       college, semester, googleLinked, googleEmail, authProvider } }
 *
 * PATCH /api/profile { email, ...patch } → { ok, profile }
 *   patch (all fields optional, at least one required):
 *     name?         string 1..80
 *     college?      string ≤120 ('' clears it)
 *     semester?     string ≤40  ('' clears it)
 *     avatar?       string|null  data:image/(jpeg|png|gif|webp);base64,… ≤700k
 *                   chars (~512 KB binary; the client resizes to 256×256
 *                   before uploading) — null removes the photo
 *     googleUnlink? boolean  true clears the Google link (googleId/email)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVATAR_RE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_CHARS = 700_000;
/** Goal ids accepted from the Profile-Setup onboarding. */
const GOAL_IDS = ['exams', 'learn', 'grades', 'research', 'competitive', 'revision'];

/** Stored goals JSON (array of ids) → safe string[] for API consumers
 *  (Profile Setup prefills from this after a returning Google sign-in). */
function parseGoals(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((g): g is string => typeof g === 'string');
    }
  } catch {
    // malformed legacy value → treat as no goals
  }
  return null;
}

function serialize(row: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  emailVerified: Date | null;
  avatar: string | null;
  college: string | null;
  semester: string | null;
  goals?: string | null;
  googleId: string | null;
  googleEmail: string | null;
  profileCompletedAt: Date | null;
}) {
  return {
    id: row.id,
    name: row.name?.trim() || row.email.split('@')[0],
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    emailVerified: row.emailVerified?.toISOString() ?? null,
    avatar: row.avatar ?? null,
    college: row.college ?? null,
    semester: row.semester ?? null,
    goals: parseGoals(row.goals),
    googleLinked: Boolean(row.googleId),
    googleEmail: row.googleEmail ?? null,
    authProvider: row.googleId ? 'google' : 'email',
    profileComplete: Boolean(row.profileCompletedAt),
  };
}

/** string → trimmed (empty → null); anything else → undefined (= invalid). */
function cleanText(value: unknown, max: number): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length === 0 ? null : v.slice(0, max);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const row = await db.user.findUnique({ where: { email } });
    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'notFound' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, profile: serialize(row) });
  } catch (error) {
    console.error('[profile/GET] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const data: Record<string, string | null | Date> = {};
  let invalid = false;

  if ('name' in body) {
    const v = typeof body.name === 'string' ? body.name.trim() : '';
    if (!v || v.length > 80) invalid = true;
    else data.name = v;
  }
  if ('college' in body && !invalid) {
    const v = cleanText(body.college, 120);
    if (v === undefined) invalid = true;
    else data.college = v;
  }
  if ('semester' in body && !invalid) {
    const v = cleanText(body.semester, 40);
    if (v === undefined) invalid = true;
    else data.semester = v;
  }
  if ('avatar' in body && !invalid) {
    if (body.avatar === null) {
      data.avatar = null;
    } else if (
      typeof body.avatar === 'string' &&
      AVATAR_RE.test(body.avatar) &&
      body.avatar.length <= AVATAR_MAX_CHARS
    ) {
      data.avatar = body.avatar;
    } else {
      invalid = true;
    }
  }
  if ('goals' in body && !invalid) {
    const raw = body.goals;
    if (
      Array.isArray(raw) &&
      raw.every((g) => typeof g === 'string' && GOAL_IDS.includes(g)) &&
      raw.length <= GOAL_IDS.length
    ) {
      data.goals = raw.length === 0 ? null : JSON.stringify([...new Set(raw)]);
    } else {
      invalid = true;
    }
  }
  if ('profileComplete' in body && !invalid) {
    if (body.profileComplete === true) {
      data.profileCompletedAt = new Date();
    } else {
      invalid = true; // completion can only be stamped, never revoked here
    }
  }
  if ('googleUnlink' in body && !invalid) {
    if (body.googleUnlink === true) {
      data.googleId = null;
      data.googleEmail = null;
    } else {
      invalid = true;
    }
  }

  if (invalid || Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const row = await db.user.update({ where: { email }, data });
    return NextResponse.json({ ok: true, profile: serialize(row) });
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    if (code === 'P2025') {
      // No User row for this email (e.g. session-only demo identity).
      return NextResponse.json(
        { ok: false, error: 'notFound' },
        { status: 404 }
      );
    }
    console.error('[profile/PATCH] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
