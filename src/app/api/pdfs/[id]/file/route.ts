import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { stat, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
/**
 * Streams the stored PDF binary.
 *
 * GET /api/pdfs/<id>/file?email=<email>[&download=1]
 *   - default: Content-Disposition inline (opens in a new tab / viewer)
 *   - &download=1: Content-Disposition attachment (saves to disk)
 *
 * The file is piped from disk as a stream (never buffered whole), so even
 * a 500 MB PDF serves with constant memory.
 */

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads');

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') ?? '').trim().toLowerCase();
  const download = searchParams.get('download') === '1';

  if (!EMAIL_RE.test(email) || !id) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const pdf = await db.pdf.findFirst({ where: { id, userEmail: email } });
    if (!pdf) {
      return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
    }

    const asciiName = pdf.name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const disposition = `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(pdf.name)}`;
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      'Cache-Control': 'private, no-store',
    };

    /* Vercel Blob backend — fetch the bytes server-side and re-stream them
       so the Blob URL stays hidden and the email check still gates access. */
    if (pdf.blobUrl) {
      const upstream = await fetch(pdf.blobUrl);
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
      }
      const headers = new Headers(baseHeaders);
      const len = upstream.headers.get('content-length');
      if (len) headers.set('Content-Length', len);
      return new Response(upstream.body, { status: 200, headers });
    }

    const filePath = path.join(UPLOAD_DIR, pdf.storedAs);
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      // Row exists but the binary is gone — clean up and report missing.
      await unlink(filePath).catch(() => {});
      return NextResponse.json({ ok: false, error: 'notFound' }, { status: 404 });
    }

    const headers = new Headers(baseHeaders);
    headers.set('Content-Length', String(size));

    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(
      nodeStream
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(webStream, { status: 200, headers });
  } catch (error) {
    console.error('[pdfs/file/GET] error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
