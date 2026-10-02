import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { db } from '@/lib/db';
import { pushNotification } from '@/lib/notify';
import {
  loadPdfBytes,
  netlifyBlobsEnabled,
  netlifyPartKey,
  netlifyRef,
  pdfBlobStore,
  removePdfFile,
} from '@/lib/pdf-store';
/** 500 MB / 4 MB parts — keep in sync with /api/pdfs/chunk. */
const MAX_PARTS = 125;

/**
 * Finalize a chunked upload (Netlify Blobs) and create the PDF row.
 *
 * Body (JSON): { email, name, subject?, uploadId, parts }
 *
 * Validation chain:
 *   1. email/name/subject sanity limits (same as multipart route)
 *   2. every part `<uploadId>.pdf/<0..parts-1>` exists in our store
 *   3. first bytes are %PDF- (magic header)
 *   4. page count best-effort for files ≤ 50 MB (same as multipart route)
 * Any failure deletes the uploaded parts so nothing is orphaned.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_COUNT_LIMIT = 50 * 1024 * 1024;

export async function POST(request: Request) {
  if (!netlifyBlobsEnabled()) {
    return NextResponse.json({ ok: false, error: 'noBlob' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        email?: unknown;
        name?: unknown;
        subject?: unknown;
        uploadId?: unknown;
        parts?: unknown;
      }
    | null;

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const rawName = typeof body?.name === 'string' ? body.name : '';
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId : '';
  const parts = typeof body?.parts === 'number' ? body.parts : 0;

  if (
    !EMAIL_RE.test(email) ||
    !rawName ||
    !UUID_RE.test(uploadId) ||
    !Number.isInteger(parts) ||
    parts < 1 ||
    parts > MAX_PARTS
  ) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const storedAs = `${uploadId}.pdf`;
  const blobUrl = netlifyRef(storedAs, parts);
  const discard = () => removePdfFile({ storedAs, blobUrl });

  if (!rawName.toLowerCase().endsWith('.pdf')) {
    await discard();
    return NextResponse.json({ ok: false, error: 'notPdf' }, { status: 400 });
  }

  try {
    const store = pdfBlobStore();

    /* 2. All parts present — sizes come from the metadata set per chunk. */
    const metas = await Promise.all(
      Array.from({ length: parts }, (_, i) =>
        store.getMetadata(netlifyPartKey(storedAs, i))
      )
    );
    if (metas.some((m) => !m)) {
      await discard();
      return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
    }
    const size = metas.reduce(
      (sum, m) => sum + (Number(m!.metadata.size) || 0),
      0
    );

    /* 3. Magic header check on the first part. */
    const first = await store.get(netlifyPartKey(storedAs, 0), {
      type: 'arrayBuffer',
    });
    if (!first || Buffer.from(first.slice(0, 5)).toString('latin1') !== '%PDF-') {
      await discard();
      return NextResponse.json({ ok: false, error: 'notPdf' }, { status: 400 });
    }

    /* 4. Best-effort page count — a missing count never blocks the upload. */
    let pages = 0;
    if (size <= PAGE_COUNT_LIMIT) {
      try {
        const buf = await loadPdfBytes({ storedAs, blobUrl });
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        pages = doc.getPageCount();
      } catch (error) {
        console.warn('[pdfs/complete] page count failed for', rawName, error);
      }
    }

    const pdf = await db.pdf.create({
      data: {
        userEmail: email,
        name: rawName.slice(0, 120),
        subjectName: subject ? subject.slice(0, 80) : null,
        size,
        pages,
        status: 'ready',
        storedAs,
        blobUrl,
      },
    });

    void pushNotification({
      email,
      type: 'pdf',
      params: {
        name: pdf.name,
        subject: pdf.subjectName ?? '',
        pages: pdf.pages,
      },
      actionNav: 'pdf-library',
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
    await discard();
    console.error('[pdfs/complete] error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
