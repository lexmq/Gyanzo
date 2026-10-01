import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { removePdfFile } from '@/lib/pdf-store';

/**
 * Single PDF — rename or delete.
 *
 * PATCH  /api/pdfs/<id> { email, name }  → { ok, pdf }
 * DELETE /api/pdfs/<id>?email=<email>    → { ok }
 *
 * Both remove the on-disk binary on delete; renaming only touches the
 * metadata (the stored file keeps its uuid name).
 */

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let email = '';
  let name = '';
  try {
    const body = await request.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    name = String(body?.name ?? '').trim();
  } catch {
    // fall through to validation
  }

  if (!EMAIL_RE.test(email) || !id) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const existing = await db.pdf.findFirst({ where: { id, userEmail: email } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
    }

    const pdf = await db.pdf.update({
      where: { id: existing.id },
      data: { name },
    });

    return NextResponse.json({
      ok: true,
      pdf: {
        id: pdf.id,
        name: pdf.name,
        subjectName: pdf.subjectName,
        size: pdf.size,
        pages: pdf.pages,
        status: pdf.status,
        createdAt: pdf.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[pdfs/PATCH] database error:', error);
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
    const existing = await db.pdf.findFirst({ where: { id, userEmail: email } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
    }

    await db.pdf.delete({ where: { id: existing.id } });
    // Remove the cached AI page-summary (if one was generated).
    await db.pdfSummary
      .deleteMany({ where: { pdfId: existing.id } })
      .catch(() => null);

    // Remove the binary (Blob or disk) — a failure here shouldn't fail the request.
    await removePdfFile(existing);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[pdfs/DELETE] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
