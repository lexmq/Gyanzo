import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushNotification } from '@/lib/notify';
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PDFDocument } from 'pdf-lib';
import busboy from 'busboy';

/**
 * PDF Library — scoped to the signed-in user's email.
 *
 * GET  /api/pdfs?email=<email>              → { ok, pdfs: [...] }
 * POST /api/pdfs (multipart/form-data)      → { ok, pdf }
 *      fields: email, file (.pdf), subject? (display label)
 *
 * The binary is stored on disk at db/uploads/<uuid>.pdf; the row carries
 * the metadata (name, subject, size, page count, status).
 *
 * Uploads support files up to 500 MB. The request body is NEVER buffered
 * in memory: it is streamed through busboy (multipart parser) straight to
 * a temp file on disk, so even a 500 MB upload costs only a fixed few MB
 * of RAM. Page counting with pdf-lib is a best-effort full parse that is
 * only attempted below PAGE_COUNT_LIMIT bytes — huge PDFs upload fine and
 * simply report 0 pages.
 */

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
/** Below this size pdf-lib parses the file for an exact page count. */
const PAGE_COUNT_LIMIT = 50 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const pdfs = await db.pdf.findMany({
      where: { userEmail: email },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return NextResponse.json({
      ok: true,
      pdfs: pdfs.map((p) => ({
        id: p.id,
        name: p.name,
        subjectName: p.subjectName,
        size: p.size,
        pages: p.pages,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[pdfs/GET] database error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  // Everything lands in a temp file first; it is renamed to its final
  // <uuid>.pdf name only after every validation passed.
  const tempPath = path.join(UPLOAD_DIR, `tmp-${randomUUID()}.part`);

  /** Best-effort delete that never masks the real outcome. */
  const remove = async (p: string) => {
    try {
      await unlink(p);
    } catch {
      /* file already gone */
    }
  };

  try {
    const bb = busboy({
      headers: { 'content-type': contentType },
      // busboy truncates a part whose byte count EQUALS limits.fileSize
      // (inclusive `===` check), so +1 lets a file of exactly MAX_BYTES
      // through while anything larger still trips the limit → 413.
      limits: { fileSize: MAX_BYTES + 1, files: 1 },
    });

    const state = {
      email: '',
      subject: '',
      fileName: '',
      gotFile: false,
      tooBig: false,
    };
    // Resolves once the uploaded part is fully flushed to disk.
    let savePromise: Promise<void> = Promise.resolve();

    bb.on('field', (name, val) => {
      if (name === 'email') state.email = String(val).trim().toLowerCase();
      if (name === 'subject') state.subject = String(val).trim();
    }).on('file', (_name, stream, info) => {
      // limits.files = 1 → busboy only emits the first file part.
      state.gotFile = true;
      state.fileName = info.filename ?? '';
      const out = createWriteStream(tempPath);
      stream.on('limit', () => {
        state.tooBig = true;
      });
      savePromise = pipeline(stream, out);
    });

    if (request.body) {
      await pipeline(
        Readable.fromWeb(
          request.body as unknown as import('stream/web').ReadableStream
        ),
        bb
      );
    } else {
      bb.end();
    }
    // The request stream ended; now wait for the tail of the file to be
    // flushed to disk before validating/renaming it.
    await savePromise;

    // ── Validation (fields and file may arrive in any order) ────────
    if (!EMAIL_RE.test(state.email)) {
      await remove(tempPath);
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }
    if (!state.gotFile) {
      await remove(tempPath);
      return NextResponse.json({ ok: false, error: 'noFile' }, { status: 400 });
    }
    if (state.tooBig) {
      await remove(tempPath);
      return NextResponse.json({ ok: false, error: 'tooBig' }, { status: 413 });
    }
    if (!state.fileName.toLowerCase().endsWith('.pdf')) {
      await remove(tempPath);
      return NextResponse.json({ ok: false, error: 'notPdf' }, { status: 400 });
    }

    let size = 0;
    try {
      size = (await stat(tempPath)).size;
    } catch {
      await remove(tempPath);
      return NextResponse.json({ ok: false, error: 'noFile' }, { status: 400 });
    }

    // Sanity check the PDF magic header — guard against mislabeled files.
    const head = await open(tempPath, 'r');
    try {
      const { buffer } = await head.read(Buffer.alloc(5), 0, 5, 0);
      if (buffer.toString('latin1') !== '%PDF-') {
        await head.close();
        await remove(tempPath);
        return NextResponse.json({ ok: false, error: 'notPdf' }, { status: 400 });
      }
    } catch (error) {
      await head.close().catch(() => {});
      await remove(tempPath);
      throw error;
    }
    await head.close();

    // Count pages (best effort — only for files small enough for pdf-lib
    // to parse comfortably; a rare/encrypted PDF still uploads).
    let pages = 0;
    if (size <= PAGE_COUNT_LIMIT) {
      try {
        const buf = await readFile(tempPath);
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        pages = doc.getPageCount();
      } catch (error) {
        console.warn('[pdfs/POST] page count failed for', state.fileName, error);
      }
    }

    const storedAs = `${randomUUID()}.pdf`;
    const finalPath = path.join(UPLOAD_DIR, storedAs);
    await rename(tempPath, finalPath);

    try {
      const pdf = await db.pdf.create({
        data: {
          userEmail: state.email,
          name: state.fileName.slice(0, 120),
          subjectName: state.subject ? state.subject.slice(0, 80) : null,
          size,
          pages,
          status: 'ready',
          storedAs,
        },
      });

      /* Real-time bell notification (persist + socket fan-out). */
      void pushNotification({
        email: state.email,
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
      // Row failed — don't leave an orphaned binary behind.
      await remove(finalPath);
      throw error;
    }
  } catch (error) {
    await remove(tempPath);
    console.error('[pdfs/POST] upload error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
