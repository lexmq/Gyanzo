import { NextResponse } from 'next/server';
import {
  NETLIFY_CHUNK_BYTES,
  netlifyBlobsEnabled,
  netlifyPartKey,
  pdfBlobStore,
} from '@/lib/pdf-store';

/**
 * Chunked upload endpoint (Netlify Blobs).
 *
 * PUT /api/pdfs/chunk?uploadId=<uuid>&index=<n>   body: raw bytes
 *
 * Netlify Functions cap request bodies at ~6 MB, so the browser slices the
 * PDF into NETLIFY_CHUNK_BYTES parts and PUTs them one by one. Each part
 * lands at `<uploadId>.pdf/<n>` in the `pdfs` store; POST
 * /api/pdfs/complete then validates the parts and creates the row.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 500 MB / 4 MB parts — mirrors the disk-mode upload cap. */
const MAX_PARTS = 125;

export async function PUT(request: Request) {
  if (!netlifyBlobsEnabled()) {
    return NextResponse.json({ ok: false, error: 'noBlob' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const uploadId = searchParams.get('uploadId') ?? '';
  const index = Number(searchParams.get('index'));
  if (!UUID_RE.test(uploadId) || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (index >= MAX_PARTS) {
    return NextResponse.json({ ok: false, error: 'tooBig' }, { status: 413 });
  }

  try {
    const data = await request.arrayBuffer();
    if (data.byteLength === 0) {
      return NextResponse.json({ ok: false, error: 'noFile' }, { status: 400 });
    }
    if (data.byteLength > NETLIFY_CHUNK_BYTES) {
      return NextResponse.json({ ok: false, error: 'tooBig' }, { status: 413 });
    }
    await pdfBlobStore().set(netlifyPartKey(`${uploadId}.pdf`, index), data, {
      metadata: { size: String(data.byteLength) },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[pdfs/chunk/PUT] store error:', error);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
